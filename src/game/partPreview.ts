import type { Collider, RigidBody, World } from '@dimforge/rapier2d-compat';
import { contentId } from '../domain/canonical';
import type { PartVersion } from '../domain/documents';
import { FIXED_STEP, MAX_TICKS } from '../domain/fallingScene';
import { loadEngine } from './physics';

type R = Awaited<ReturnType<typeof loadEngine>>;
type Body = { id: string; body: RigidBody; collider: Collider; radius: number; cooldown: number };
export interface PartSnapshot {
  tick: number; bodies: { id: string; x: number; y: number; radius: number; vx: number; vy: number }[];
  events: { tick: number; text: string }[]; balloonPopped: boolean;
  ray: { x: number; y: number } | null; bodyCount: number;
}

// Single-action authoring sandbox. This does not execute general machine graphs.
export class PartPreview {
  private world!: World;
  private bodies: Body[] = [];
  private balloon: Collider | undefined;
  private tick = 0;
  private events: PartSnapshot['events'] = [];
  private popped = false;
  private ray: PartSnapshot['ray'] = null;
  private disposed = false;
  private lifted = new Set<string>();

  private constructor(private R: R, readonly version: PartVersion) { this.reset(); }
  static async create(version: PartVersion) {
    if (await contentId(version.content) !== version.id || version.content.actions.length !== 1 ||
        version.content.props.some((p) => !['ball', 'balloon', 'ramp'].includes(p.type))) throw new Error('Unsupported sandbox part');
    return new PartPreview(await loadEngine(), version);
  }
  reset() {
    this.active();
    const R = this.R, b = this.version.content.bounds;
    this.world?.free();
    this.world = new R.World({ x: 0, y: -9.81 });
    this.world.timestep = FIXED_STEP;
    this.world.integrationParameters.maxCcdSubsteps = 4;
    this.world.createCollider(R.ColliderDesc.cuboid(b.width / 2, 0.1).setTranslation(b.width / 2, 0.1));
    for (const x of [0, b.width]) this.world.createCollider(R.ColliderDesc.cuboid(0.05, b.height / 2).setTranslation(x, b.height / 2));
    this.world.createCollider(R.ColliderDesc.cuboid(b.width / 2, 0.05).setTranslation(b.width / 2, b.height));
    this.bodies = []; this.balloon = undefined; this.tick = 0; this.events = []; this.popped = false; this.ray = null; this.lifted.clear();
    const action = this.version.content.actions[0];
    for (const prop of this.version.content.props) {
      if (prop.type === 'ball') {
        const held = action.type === 'release' && action.propId === prop.id;
        const body = this.world.createRigidBody((held ? R.RigidBodyDesc.fixed() : R.RigidBodyDesc.dynamic()).setTranslation(prop.x, prop.y).setCcdEnabled(true));
        const collider = this.world.createCollider(R.ColliderDesc.ball(prop.radius).setDensity(10).setRestitution(prop.restitution), body);
        this.bodies.push({ id: prop.id, body, collider, radius: prop.radius, cooldown: 0 });
      } else if (prop.type === 'balloon') {
        this.balloon = this.world.createCollider(R.ColliderDesc.ball(prop.radius).setTranslation(prop.x, prop.y).setSensor(true));
      } else if (prop.type === 'ramp') {
        this.world.createCollider(R.ColliderDesc.cuboid(prop.width / 2, prop.height / 2).setTranslation(prop.x, prop.y).setRotation(prop.angle));
      }
    }
  }
  private emit(text: string) {
    if (this.events.length < 200) this.events.push({ tick: this.tick, text });
  }
  private trigger() {
    const a = this.version.content.actions[0];
    if (a.type === 'release') {
      this.bodies.find((b) => b.id === a.propId)!.body.setBodyType(this.R.RigidBodyType.Dynamic, true);
      this.emit('Chog released the prepared ball. Output: released body.');
    } else if (a.type === 'push') {
      for (const { body } of this.bodies) {
        const p = body.translation();
        if (Math.hypot(p.x - a.x, p.y - a.y) > a.range) continue;
        body.applyImpulse({ x: Math.cos(a.angle) * a.impulse, y: Math.sin(a.angle) * a.impulse }, true);
        this.emit('Chog pushed a nearby physical ball. Output: pushed body.');
      }
    }
  }
  private laser() {
    const a = this.version.content.actions[0];
    if (a.type !== 'laser') return;
    const direction = { x: Math.cos(a.angle), y: Math.sin(a.angle) };
    const hit = this.world.castRay(new this.R.Ray(a, direction), a.length, true);
    const distance = hit?.timeOfImpact ?? a.length;
    this.ray = { x: a.x + distance * direction.x, y: a.y + distance * direction.y };
    this.emit('Chog fired a physical ray. Output: fired event.');
    if (!hit || hit.collider.handle !== this.balloon?.handle) return;
    const p = this.balloon.translation();
    this.world.removeCollider(this.balloon, false); this.balloon = undefined; this.popped = true;
    this.emit('The ray hit the balloon and released 12 physical confetti bodies.');
    for (let i = 0; i < 12; i++) {
      const body = this.world.createRigidBody(this.R.RigidBodyDesc.dynamic().setTranslation(p.x + ((i % 4) - 1.5) * 0.12, p.y + Math.floor(i / 4) * 0.12).setCcdEnabled(true));
      const collider = this.world.createCollider(this.R.ColliderDesc.ball(0.04), body);
      this.bodies.push({ id: `confetti-${i}`, body, collider, radius: 0.04, cooldown: 0 });
    }
  }
  step(ticks = 1): PartSnapshot {
    this.active();
    if (!Number.isInteger(ticks) || ticks < 0 || ticks > MAX_TICKS) throw new Error('Invalid tick count');
    const a = this.version.content.actions[0];
    for (let n = 0; n < ticks && this.tick < MAX_TICKS; n++) {
      if (this.tick === 0) this.trigger();
      for (const item of this.bodies) {
        const { body } = item, p = body.translation();
        if (a.type === 'lift' && Math.abs(p.x - a.x) < a.width / 2 && Math.abs(p.y - a.y) < a.height / 2) {
          const speed = body.linvel().y;
          body.applyImpulse({ x: 0, y: body.mass() * Math.min(a.acceleration * FIXED_STEP, Math.max(0, a.maxSpeed - speed)) }, true);
          if (!this.lifted.has(item.id)) { this.lifted.add(item.id); this.emit('Fire lift applied an upward impulse. Output: lifted body.'); }
        }
        const v = body.linvel();
        body.setLinvel({ x: Math.max(-8, Math.min(8, v.x)), y: Math.max(-8, Math.min(8, v.y)) }, false);
      }
      this.world.step(); this.tick++;
      if (this.tick === 1) this.laser();
      if (a.type === 'portal') for (const item of this.bodies) {
        const p = item.body.translation();
        if (this.tick < item.cooldown || Math.hypot(p.x - a.x, p.y - a.y) > a.radius) continue;
        item.cooldown = this.tick + a.cooldownTicks;
        const destination = { x: a.exitX + a.radius + item.radius, y: a.exitY };
        if (this.world.intersectionWithShape(destination, 0, new this.R.Ball(item.radius), undefined, undefined, item.collider, item.body)) {
          this.emit('Portal exit blocked. Ball retained.'); continue;
        }
        const v = item.body.linvel();
        item.body.setTranslation(destination, true);
        item.body.setLinvel(v, true);
        this.emit('Wizard portal moved the physical ball. Output: teleported body.');
      }
    }
    return this.snapshot();
  }
  snapshot(): PartSnapshot {
    this.active();
    return { tick: this.tick, bodies: this.bodies.map(({ id, body, radius }) => ({ id, radius, ...body.translation(), vx: body.linvel().x, vy: body.linvel().y })),
      bodyCount: this.world.bodies.len(), events: this.events.map((e) => ({ ...e })), balloonPopped: this.popped, ray: this.ray ? { ...this.ray } : null };
  }
  dispose() { if (!this.disposed) { this.world.free(); this.disposed = true; } }
  private active() { if (this.disposed) throw new Error('Sandbox disposed'); }
}
