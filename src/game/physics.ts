import type { RigidBody, World } from '@dimforge/rapier2d-compat';
import {
  BALL_RADIUS, FIXED_STEP, FLOOR_HEIGHT, MAX_TICKS, WORLD_WIDTH,
  parseFallingScene, type FallingScene,
} from '../domain/fallingScene';

type Rapier = typeof import('@dimforge/rapier2d-compat');
let enginePromise: Promise<Rapier> | undefined;

function loadEngine(): Promise<Rapier> {
  enginePromise ??= import('@dimforge/rapier2d-compat').then(async (engine) => {
    await engine.init();
    return engine;
  });
  return enginePromise;
}

export interface PhysicsSnapshot {
  tick: number;
  ball: { id: 'ball'; x: number; y: number; velocityX: number; velocityY: number };
  bodyCount: number;
  colliderCount: number;
}

export class FallingSimulation {
  private world!: World;
  private ball!: RigidBody;
  private tick = 0;
  private disposed = false;
  private scene: FallingScene;

  private constructor(private readonly engine: Rapier, scene: FallingScene) {
    this.scene = parseFallingScene(scene);
    this.reset();
  }

  static async create(scene: FallingScene): Promise<FallingSimulation> {
    const validated = parseFallingScene(scene);
    return new FallingSimulation(await loadEngine(), validated);
  }

  reset(scene: FallingScene = this.scene): void {
    this.assertActive();
    const validated = parseFallingScene(scene);
    const R = this.engine;
    const world = new R.World({ x: 0, y: -9.81 });
    world.timestep = FIXED_STEP;
    world.integrationParameters.maxCcdSubsteps = 4;
    const floor = world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(WORLD_WIDTH / 2, FLOOR_HEIGHT / 2));
    world.createCollider(R.ColliderDesc.cuboid(WORLD_WIDTH / 2, FLOOR_HEIGHT / 2), floor);
    const ball = world.createRigidBody(
      R.RigidBodyDesc.dynamic().setTranslation(validated.ballX, validated.ballY).setCcdEnabled(true),
    );
    world.createCollider(
      R.ColliderDesc.ball(BALL_RADIUS)
        .setRestitution(validated.restitution)
        .setRestitutionCombineRule(R.CoefficientCombineRule.Max),
      ball,
    );
    this.world?.free();
    this.world = world;
    this.ball = ball;
    this.scene = validated;
    this.tick = 0;
  }

  step(ticks = 1): PhysicsSnapshot {
    this.assertActive();
    if (!Number.isInteger(ticks) || ticks < 0 || ticks > MAX_TICKS) {
      throw new Error('Tick count must be an integer between 0 and 720');
    }
    for (let i = 0; i < ticks && this.tick < MAX_TICKS; i++) {
      this.world.step();
      this.tick++;
    }
    return this.snapshot();
  }

  snapshot(): PhysicsSnapshot {
    this.assertActive();
    const position = this.ball.translation();
    const velocity = this.ball.linvel();
    return {
      tick: this.tick,
      ball: { id: 'ball', x: position.x, y: position.y, velocityX: velocity.x, velocityY: velocity.y },
      bodyCount: this.world.bodies.len(),
      colliderCount: this.world.colliders.len(),
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.world.free();
    this.disposed = true;
  }

  private assertActive(): void {
    if (this.disposed) throw new Error('Simulation is disposed');
  }
}
