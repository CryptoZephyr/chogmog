import type { Collider, RigidBody, World } from '@dimforge/rapier2d-compat';
import type { Action, Connection, Endpoint, PartResolver, Prop, Scene, SourceResolver } from '../domain/documents';
import { validateMachine } from '../domain/documents';
import { FIXED_STEP, MAX_TICKS } from '../domain/fallingScene';
import { loadEngine } from './physics';

type Engine = Awaited<ReturnType<typeof loadEngine>>;
type Body = { id: string; body: RigidBody; collider: Collider; radius: number; cooldown: number };
type Node = Prop | Action;
type Signal = { to: Endpoint; bodies: string[] };
export interface MachineSnapshot {
  tick: number;
  bodies: { id: string; x: number; y: number; vx: number; vy: number; radius: number }[];
  events: { tick: number; text: string }[];
  rays: { x: number; y: number; toX: number; toY: number }[];
  popped: string[];
  bannerOpen: boolean;
  bodyCount: number;
}

export class MachinePreview {
  private world!: World;
  private bodies: Body[] = [];
  private balloons = new Map<string, Collider>();
  private triggers = new Map<string, Collider>();
  private floor!: Collider;
  private tick = 0;
  private events: MachineSnapshot['events'] = [];
  private rays: MachineSnapshot['rays'] = [];
  private popped = new Set<string>();
  private hitByRay = new Set<string>();
  private fired = new Set<string>();
  private entered = new Set<string>();
  private lifted = new Set<string>();
  private allowed = new Map<string, Set<string>>();
  private queue: Signal[] = [];
  private signals = 0;
  private bannerOpen = false;
  private disposed = false;
  private gated = new Set<string>();
  readonly nodes: ReadonlyMap<string, Node>;
  readonly wires: readonly Connection[];

  private constructor(private R: Engine, readonly machine: Awaited<ReturnType<typeof validateMachine>>) {
    const nodes = new Map<string, Node>(machine.scene.props.map((p) => [p.id, p]));
    const wires: Connection[] = [];
    const remap = (partId: string, endpoint: Endpoint) => ({ objectId: `${partId}/${endpoint.objectId}`, socket: endpoint.socket });
    const external = (endpoint: Endpoint): Endpoint => {
      const part = machine.expanded.find((p) => p.instanceId === endpoint.objectId);
      if (!part) return endpoint;
      const socket = part.configured.sockets.find((s) => s.id === endpoint.socket)!;
      return remap(part.instanceId, socket.target);
    };
    for (const part of machine.expanded) {
      const placement = machine.scene.parts.find((p) => p.id === part.instanceId)!;
      for (const obj of [...part.configured.props, ...part.configured.actions]) {
        const moved = { ...obj, id: `${part.instanceId}/${obj.id}`, x: obj.x + placement.x, y: obj.y + placement.y } as Node;
        if (moved.type === 'release') moved.propId = `${part.instanceId}/${moved.propId}`;
        if (moved.type === 'portal') { moved.exitX += placement.x; moved.exitY += placement.y; }
        nodes.set(moved.id, moved);
      }
      for (const wire of part.configured.connections) wires.push({ from: remap(part.instanceId, wire.from), to: remap(part.instanceId, wire.to) });
    }
    for (const wire of machine.scene.connections) wires.push({ from: external(wire.from), to: external(wire.to) });
    this.nodes = nodes;
    this.wires = wires;
    for (const wire of wires) if (wire.to.socket === 'body') this.gated.add(wire.to.objectId);
    this.reset();
  }

  static async create(scene: Scene, resolvePart: PartResolver, resolveSource: SourceResolver) {
    const machine = await validateMachine(scene, resolvePart, resolveSource);
    return new MachinePreview(await loadEngine(), machine);
  }

  reset() {
    this.active();
    this.world?.free();
    const R = this.R, b = this.machine.scene.bounds;
    this.world = new R.World({ x: 0, y: -9.81 });
    this.world.timestep = FIXED_STEP;
    this.world.integrationParameters.maxCcdSubsteps = 4;
    this.floor = this.world.createCollider(R.ColliderDesc.cuboid(b.width / 2, 0.1).setTranslation(b.width / 2, 0.1));
    for (const x of [0, b.width]) this.world.createCollider(R.ColliderDesc.cuboid(0.05, b.height / 2).setTranslation(x, b.height / 2));
    this.world.createCollider(R.ColliderDesc.cuboid(b.width / 2, 0.05).setTranslation(b.width / 2, b.height));
    this.bodies = []; this.balloons.clear(); this.triggers.clear(); this.tick = 0; this.events = []; this.rays = []; this.popped.clear();
    this.hitByRay.clear(); this.fired.clear(); this.entered.clear(); this.lifted.clear(); this.allowed.clear();
    this.queue = []; this.signals = 0; this.bannerOpen = false;
    for (const node of this.nodes.values()) {
      if (node.type === 'ball') {
        const held = [...this.nodes.values()].some((a) => a.type === 'release' && a.propId === node.id);
        const body = this.world.createRigidBody((held ? R.RigidBodyDesc.fixed() : R.RigidBodyDesc.dynamic())
          .setTranslation(node.x, node.y).setCcdEnabled(true));
        const collider = this.world.createCollider(R.ColliderDesc.ball(node.radius).setDensity(10).setRestitution(node.restitution), body);
        this.bodies.push({ id: node.id, body, collider, radius: node.radius, cooldown: 0 });
      } else if (node.type === 'balloon') {
        this.balloons.set(node.id, this.world.createCollider(R.ColliderDesc.ball(node.radius).setTranslation(node.x, node.y).setSensor(true)));
      } else if (node.type === 'ramp') {
        this.world.createCollider(R.ColliderDesc.cuboid(node.width / 2, node.height / 2).setTranslation(node.x, node.y).setRotation(node.angle));
      } else if (node.type === 'sensor' || node.type === 'lever') {
        this.triggers.set(node.id, this.world.createCollider(R.ColliderDesc.cuboid(node.width / 2, node.height / 2)
          .setTranslation(node.x, node.y).setSensor(true)));
      }
    }
  }

  private log(text: string) { if (this.events.length < 200) this.events.push({ tick: this.tick, text }); }
  private route(from: Endpoint, bodies: string[] = []) {
    for (const wire of this.wires) if (wire.from.objectId === from.objectId && wire.from.socket === from.socket && this.signals < 200) {
      this.signals++;
      this.queue.push({ to: wire.to, bodies });
    }
  }
  private emit(id: string, socket: string, text: string, bodies: string[] = []) {
    this.log(`${id}: ${text}`);
    this.route({ objectId: id, socket }, bodies);
  }
  private deliver(to: Endpoint, bodies: string[]) {
    const node = this.nodes.get(to.objectId);
    if (!node) return;
    if (node.type === 'ball' && to.socket === 'release') {
      const b = this.bodies.find((b) => b.id === node.id);
      if (b && !this.fired.has(`ball:${b.id}`)) {
        this.fired.add(`ball:${b.id}`); b.body.setBodyType(this.R.RigidBodyType.Dynamic, true);
        this.emit(node.id, 'body', 'physical ball released', [b.id]);
      }
    } else if (node.type === 'release' && to.socket === 'trigger' && !this.fired.has(node.id)) {
      this.fired.add(node.id);
      this.deliver({ objectId: node.propId, socket: 'release' }, []);
      this.route({ objectId: node.id, socket: 'released' }, [node.propId]);
    } else if (node.type === 'push' && to.socket === 'trigger' && !this.fired.has(node.id)) {
      this.fired.add(node.id);
      for (const item of this.bodies) {
        const p = item.body.translation();
        if (!item.body.isDynamic() || Math.hypot(p.x - node.x, p.y - node.y) > node.range) continue;
        item.body.applyImpulse({ x: Math.cos(node.angle) * node.impulse, y: Math.sin(node.angle) * node.impulse }, true);
        this.emit(node.id, 'pushed', 'pushed a physical body', [item.id]);
      }
    } else if (node.type === 'laser' && to.socket === 'trigger' && !this.fired.has(node.id)) {
      this.fired.add(node.id);
      const direction = { x: Math.cos(node.angle), y: Math.sin(node.angle) };
      const ray = new this.R.Ray(node, direction);
      const hits: { collider: Collider; timeOfImpact: number }[] = [];
      // Shape queries also work before the world's first physics step.
      this.world.propagateModifiedBodyPositionsToColliders();
      this.world.forEachCollider((collider) => {
        if ([...this.triggers.values()].some((trigger) => trigger.handle === collider.handle)) return;
        const timeOfImpact = collider.castRay(ray, node.length, true);
        if (timeOfImpact >= 0) hits.push({ collider, timeOfImpact });
      });
      const hit = hits.sort((a, b) => a.timeOfImpact - b.timeOfImpact || a.collider.handle - b.collider.handle)[0];
      const distance = hit?.timeOfImpact ?? node.length;
      this.rays.push({ x: node.x, y: node.y, toX: node.x + distance * direction.x, toY: node.y + distance * direction.y });
      const hitBalloon = [...this.balloons].find(([, collider]) => hit?.collider.handle === collider.handle);
      if (hitBalloon) this.hitByRay.add(hitBalloon[0]);
      this.emit(node.id, 'fired', hitBalloon ? 'ray hit a balloon' : 'ray missed');
    } else if (node.type === 'balloon' && to.socket === 'hit' && this.hitByRay.has(node.id) && !this.popped.has(node.id)) {
      const collider = this.balloons.get(node.id)!;
      const p = collider.translation();
      this.world.removeCollider(collider, false); this.balloons.delete(node.id); this.popped.add(node.id); this.hitByRay.delete(node.id);
      const confetti: string[] = [];
      for (let i = 0; i < 12; i++) {
        const id = `${node.id}/confetti-${i}`;
        const body = this.world.createRigidBody(this.R.RigidBodyDesc.dynamic()
          .setTranslation(p.x + ((i % 4) - 1.5) * 0.12, p.y + Math.floor(i / 4) * 0.12).setCcdEnabled(true));
        const piece = this.world.createCollider(this.R.ColliderDesc.ball(0.04), body);
        this.bodies.push({ id, body, collider: piece, radius: 0.04, cooldown: 0 });
        confetti.push(id);
      }
      this.emit(node.id, 'popped', 'balloon popped into twelve physical confetti bodies');
      this.route({ objectId: node.id, socket: 'confetti' }, confetti);
    } else if (node.type === 'lever' && to.socket === 'hit' && !this.fired.has(node.id)) {
      this.fired.add(node.id); this.emit(node.id, 'activated', 'lever activated');
    } else if (node.type === 'banner' && to.socket === 'open') {
      this.bannerOpen = true; this.log(`${node.id}: message opened`);
    } else if ((node.type === 'portal' || node.type === 'lift' || node.type === 'sensor') && to.socket === 'body') {
      const allowed = this.allowed.get(node.id) ?? new Set<string>();
      for (const id of bodies) allowed.add(id);
      this.allowed.set(node.id, allowed);
    }
  }
  private flush() {
    while (this.queue.length) {
      const next = this.queue.shift()!;
      this.deliver(next.to, next.bodies);
    }
  }
  private physical() {
    for (const item of this.bodies) {
      if (!item.body.isDynamic()) continue;
      for (const node of this.nodes.values()) {
        if ((node.type === 'sensor' || node.type === 'lever') &&
          (!this.gated.has(node.id) || this.allowed.get(node.id)?.has(item.id)) &&
          this.world.intersectionPair(item.collider, this.triggers.get(node.id)!)) {
          const key = `${node.id}:${item.id}`;
          if (this.entered.has(key)) continue;
          this.entered.add(key);
          if (node.type === 'sensor') this.emit(node.id, 'triggered', `physical body ${item.id} crossed sensor`);
          else this.deliver({ objectId: node.id, socket: 'hit' }, []);
        }
        if (node.type === 'ball' && node.id === item.id && !this.fired.has(`contact:${item.id}`)) {
          this.world.contactPair(item.collider, this.floor, (manifold) => {
            if (manifold.numContacts() === 0) return;
            this.fired.add(`contact:${item.id}`);
            this.emit(item.id, 'contact', 'physical ball contacted the floor');
          });
        }
      }
    }
    this.flush();
  }

  step(ticks = 1): MachineSnapshot {
    this.active();
    if (!Number.isInteger(ticks) || ticks < 0 || ticks > MAX_TICKS) throw new Error('Invalid tick count');
    for (let n = 0; n < ticks && this.tick < MAX_TICKS; n++) {
      for (const input of this.machine.scene.inputs) if (input.tick === this.tick) {
        const part = this.machine.expanded.find((p) => p.instanceId === input.target.objectId);
        const target = part ? part.configured.sockets.find((s) => s.id === input.target.socket)!.target : input.target;
        this.deliver(part ? { objectId: `${part.instanceId}/${target.objectId}`, socket: target.socket } : target, []);
      }
      if (this.tick === 0) for (const item of this.bodies) if (item.body.isDynamic() && !this.fired.has(`ball:${item.id}`)) {
        this.route({ objectId: item.id, socket: 'body' }, [item.id]);
      }
      this.flush();
      for (const item of this.bodies) {
        if (!item.body.isDynamic()) continue;
        const p = item.body.translation();
        for (const node of this.nodes.values()) if (node.type === 'lift' &&
          Math.abs(p.x - node.x) < node.width / 2 && Math.abs(p.y - node.y) < node.height / 2 &&
          (!this.gated.has(node.id) || this.allowed.get(node.id)?.has(item.id))) {
          const speed = item.body.linvel().y;
          item.body.applyImpulse({ x: 0, y: item.body.mass() * Math.min(node.acceleration * FIXED_STEP, Math.max(0, node.maxSpeed - speed)) }, true);
          if (!this.lifted.has(`${node.id}:${item.id}`)) {
            this.lifted.add(`${node.id}:${item.id}`);
            this.emit(node.id, 'lifted', 'Fire lifted a physical body', [item.id]);
          }
        }
        const velocity = item.body.linvel();
        item.body.setLinvel({ x: Math.max(-8, Math.min(8, velocity.x)), y: Math.max(-8, Math.min(8, velocity.y)) }, false);
      }
      this.world.step(); this.tick++;
      for (const item of this.bodies) {
        if (!item.body.isDynamic()) continue;
        const p = item.body.translation();
        for (const node of this.nodes.values()) if (node.type === 'portal' && this.tick >= item.cooldown &&
          Math.hypot(p.x - node.x, p.y - node.y) <= node.radius &&
          (!this.gated.has(node.id) || this.allowed.get(node.id)?.has(item.id))) {
          item.cooldown = this.tick + node.cooldownTicks;
          const destination = { x: node.exitX + node.radius + item.radius, y: node.exitY };
          if (this.world.intersectionWithShape(destination, 0, new this.R.Ball(item.radius), undefined, undefined, item.collider, item.body)) {
            this.log(`${node.id}: portal exit blocked`); continue;
          }
          let velocity = item.body.linvel();
          for (let i = 0; i < node.quarterTurns; i++) velocity = { x: -velocity.y, y: velocity.x };
          item.body.setTranslation(destination, true); item.body.setLinvel(velocity, true);
          this.emit(node.id, 'teleported', 'Wizard portal moved a physical body', [item.id]);
        }
      }
      this.physical();
      this.flush();
    }
    return this.snapshot();
  }
  snapshot(): MachineSnapshot {
    this.active();
    return { tick: this.tick, bodies: this.bodies.map(({ id, body, radius }) => ({ id, radius, ...body.translation(), vx: body.linvel().x, vy: body.linvel().y })),
      events: this.events.map((event) => ({ ...event })), rays: this.rays.map((ray) => ({ ...ray })),
      popped: [...this.popped], bannerOpen: this.bannerOpen, bodyCount: this.world.bodies.len() };
  }
  dispose() { if (!this.disposed) { this.world.free(); this.disposed = true; } }
  private active() { if (this.disposed) throw new Error('Machine sandbox disposed'); }
}
