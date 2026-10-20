import type { Collider, RigidBody, World } from '@dimforge/rapier2d-compat';
import { getPreview } from '../domain/chog';
import { parseChainScene, type ChainScene } from '../domain/chainScene';
import { FIXED_STEP, FLOOR_HEIGHT, MAX_TICKS, WORLD_WIDTH } from '../domain/fallingScene';
import { loadEngine } from './physics';

export const GEOMETRY = {
  sensor: { x: 2, y: 2.5, halfWidth: 0.45, halfHeight: 0.15 },
  laser: { x: 2.6, y: 3, length: 6 },
  balloon: { x: 5, y: 3, radius: 0.35 },
  lift: { x: 5, y: 4.5, halfWidth: 0.65, halfHeight: 1.9 },
  entrance: { x: 5, y: 5.8, radius: 0.32 },
  exitX: 8.4,
  lever: { x: 10, y: 2.5, halfWidth: 0.5, halfHeight: 0.1 },
} as const;
export type EventType = 'released' | 'sensor' | 'laser' | 'popped' | 'lifted' | 'teleported' | 'portal-blocked' | 'lever' | 'banner';
export interface ChainEvent { tick: number; type: EventType; actor: string; target: string; sourceToken?: string }
export interface BodyView { id: string; x: number; y: number; vx: number; vy: number }
export interface ChainSnapshot {
  tick: number;
  bodies: BodyView[];
  bodyCount: number;
  colliderCount: number;
  balloonPopped: boolean;
  bannerOpen: boolean;
  laserEnd: { x: number; y: number } | null;
  events: ChainEvent[];
}
type Dynamic = { id: string; body: RigidBody; collider: Collider; cooldownUntil: number; lifted: boolean };
type Rapier = Awaited<ReturnType<typeof loadEngine>>;

export class ChainSimulation {
  private world!: World;
  private scene: ChainScene;
  private dynamic: Dynamic[] = [];
  private sensor!: Collider;
  private balloon!: Collider;
  private lever!: Collider;
  private tick = 0;
  private events: ChainEvent[] = [];
  private balloonPopped = false;
  private bannerOpen = false;
  private sensorTriggered = false;
  private laserEnd: { x: number; y: number } | null = null;
  private disposed = false;

  private constructor(private readonly R: Rapier, scene: ChainScene) {
    this.scene = parseChainScene(scene);
    this.reset();
  }
  static async create(scene: ChainScene): Promise<ChainSimulation> {
    const valid = parseChainScene(scene);
    return new ChainSimulation(await loadEngine(), valid);
  }
  reset(scene = this.scene): void {
    this.assertActive();
    const valid = parseChainScene(scene);
    const R = this.R;
    const world = new R.World({ x: 0, y: -9.81 });
    world.timestep = FIXED_STEP;
    world.integrationParameters.maxCcdSubsteps = 4;
    world.createCollider(R.ColliderDesc.cuboid(WORLD_WIDTH / 2, FLOOR_HEIGHT / 2).setTranslation(WORLD_WIDTH / 2, FLOOR_HEIGHT / 2));
    const sensor = world.createCollider(R.ColliderDesc.cuboid(GEOMETRY.sensor.halfWidth, GEOMETRY.sensor.halfHeight).setTranslation(GEOMETRY.sensor.x, GEOMETRY.sensor.y).setSensor(true));
    const balloon = world.createCollider(R.ColliderDesc.ball(GEOMETRY.balloon.radius).setTranslation(GEOMETRY.balloon.x, GEOMETRY.balloon.y).setSensor(true));
    const lever = world.createCollider(R.ColliderDesc.cuboid(GEOMETRY.lever.halfWidth, GEOMETRY.lever.halfHeight).setTranslation(GEOMETRY.lever.x, GEOMETRY.lever.y));
    const body = world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(valid.ballX, 6.5).setCcdEnabled(true));
    const collider = world.createCollider(R.ColliderDesc.ball(0.2).setRestitution(0.2), body);
    this.world?.free();
    this.world = world;
    this.scene = valid;
    this.sensor = sensor;
    this.balloon = balloon;
    this.lever = lever;
    this.dynamic = [{ id: 'ball', body, collider, cooldownUntil: 0, lifted: false }];
    this.tick = 0;
    this.events = [];
    this.balloonPopped = false;
    this.bannerOpen = false;
    this.sensorTriggered = false;
    this.laserEnd = null;
  }
  private emit(type: EventType, actor: string, target: string, sourceToken?: string): void {
    if (this.events.length >= 200) throw new Error('Chain event limit reached');
    this.events.push({ tick: this.tick, type, actor, target, ...(sourceToken ? { sourceToken } : {}) });
  }
  private supports(tokenId: string, ability: 'laser' | 'lift' | 'portal'): boolean {
    return getPreview(tokenId).kit.includes(ability);
  }
  private popBalloon(): void {
    this.balloonPopped = true;
    this.world.removeCollider(this.balloon, false);
    this.emit('popped', 'balloon', 'confetti');
    for (let i = 0; i < 12; i++) {
      const x = GEOMETRY.balloon.x + ((i % 4) - 1.5) * 0.16;
      const y = GEOMETRY.balloon.y + Math.floor(i / 4) * 0.17;
      const body = this.world.createRigidBody(this.R.RigidBodyDesc.dynamic().setTranslation(x, y).setCcdEnabled(true));
      body.setLinvel({ x: 0, y: 0.5 }, true);
      const collider = this.world.createCollider(this.R.ColliderDesc.ball(0.06).setRestitution(0), body);
      this.dynamic.push({ id: `confetti-${i}`, body, collider, cooldownUntil: 0, lifted: false });
    }
  }
  private applyLift(): void {
    if (!this.supports(this.scene.liftToken, 'lift')) return;
    const region = GEOMETRY.lift;
    for (const item of this.dynamic) {
      if (item.id === 'ball') continue;
      const p = item.body.translation();
      if (Math.abs(p.x - region.x) > region.halfWidth || Math.abs(p.y - region.y) > region.halfHeight) continue;
      const v = item.body.linvel();
      const acceleration = Math.max(0, Math.min(24, (3 - v.y) * 10));
      item.body.applyImpulse({ x: 0, y: item.body.mass() * acceleration * FIXED_STEP }, true);
      if (!item.lifted) {
        item.lifted = true;
        this.emit('lifted', 'lift', item.id, this.scene.liftToken);
      }
    }
  }
  private portals(): void {
    if (!this.supports(this.scene.portalToken, 'portal')) return;
    for (const item of this.dynamic) {
      if (item.id === 'ball' || this.tick < item.cooldownUntil) continue;
      const p = item.body.translation();
      const entry = GEOMETRY.entrance;
      if ((p.x - entry.x) ** 2 + (p.y - entry.y) ** 2 > entry.radius ** 2) continue;
      const destination = { x: GEOMETRY.exitX + GEOMETRY.entrance.radius + 0.07, y: this.scene.portalExitY };
      const occupied = this.world.intersectionWithShape(destination, 0, new this.R.Ball(0.09), undefined, undefined, item.collider, item.body);
      item.cooldownUntil = this.tick + 30;
      if (occupied) { this.emit('portal-blocked', item.id, 'portal-exit', this.scene.portalToken); continue; }
      const v = item.body.linvel();
      item.body.setTranslation(destination, true);
      item.body.setLinvel({ x: v.y, y: -v.x }, true);
      this.emit('teleported', 'portal', item.id, this.scene.portalToken);
    }
  }
  private interactions(): void {
    if (!this.sensorTriggered && this.world.intersectionPair(this.dynamic[0].collider, this.sensor)) {
      this.sensorTriggered = true;
      this.emit('sensor', 'ball', 'laser-input');
      if (this.supports(this.scene.laserToken, 'laser')) {
        this.emit('laser', 'laser', 'ray', this.scene.laserToken);
        const hit = this.world.castRay(new this.R.Ray(GEOMETRY.laser, { x: 1, y: this.scene.laserAim }), GEOMETRY.laser.length, true, undefined, undefined, this.sensor, this.dynamic[0].body);
        const distance = hit?.timeOfImpact ?? GEOMETRY.laser.length;
        this.laserEnd = { x: GEOMETRY.laser.x + distance, y: GEOMETRY.laser.y + this.scene.laserAim * distance };
        if (hit?.collider.handle === this.balloon.handle) this.popBalloon();
      }
    }
    if (!this.bannerOpen) {
      for (const item of this.dynamic) {
        if (item.id === 'ball') continue;
        let touching = false;
        this.world.contactPair(item.collider, this.lever, (manifold) => { if (manifold.numContacts() > 0) touching = true; });
        if (!touching) continue;
        this.bannerOpen = true;
        this.emit('lever', item.id, 'lever');
        this.emit('banner', 'lever', 'message');
        break;
      }
    }
  }
  step(ticks = 1): ChainSnapshot {
    this.assertActive();
    if (!Number.isInteger(ticks) || ticks < 0 || ticks > MAX_TICKS) throw new Error('Invalid tick count');
    for (let n = 0; n < ticks && this.tick < MAX_TICKS; n++) {
      if (this.tick === 0) this.emit('released', `token-${this.scene.laserToken}`, 'ball', this.scene.laserToken);
      this.applyLift();
      for (const { body } of this.dynamic) {
        const v = body.linvel();
        body.setLinvel({ x: Math.max(-8, Math.min(8, v.x)), y: Math.max(-8, Math.min(8, v.y)) }, false);
      }
      this.world.step();
      this.tick++;
      this.portals();
      this.interactions();
    }
    return this.snapshot();
  }
  snapshot(): ChainSnapshot {
    this.assertActive();
    return {
      tick: this.tick,
      bodies: this.dynamic.map(({ id, body }) => { const p = body.translation(); const v = body.linvel(); return { id, x: p.x, y: p.y, vx: v.x, vy: v.y }; }),
      bodyCount: this.world.bodies.len(), colliderCount: this.world.colliders.len(),
      balloonPopped: this.balloonPopped, bannerOpen: this.bannerOpen, events: this.events.map((e) => ({ ...e })),
      laserEnd: this.laserEnd ? { ...this.laserEnd } : null,
    };
  }
  dispose(): void { if (!this.disposed) { this.world.free(); this.disposed = true; } }
  private assertActive(): void { if (this.disposed) throw new Error('Simulation is disposed'); }
}
