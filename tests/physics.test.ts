import { afterEach, describe, expect, test } from 'vitest';
import { BALL_RADIUS, DEFAULT_SCENE, FLOOR_HEIGHT, MAX_TICKS } from '../src/domain/fallingScene';
import { FallingSimulation } from '../src/game/physics';

const simulations: FallingSimulation[] = [];
async function create(scene = { ...DEFAULT_SCENE }) {
  const simulation = await FallingSimulation.create(scene);
  simulations.push(simulation);
  return simulation;
}
afterEach(() => {
  for (const simulation of simulations.splice(0)) simulation.dispose();
});

describe('real Rapier WASM simulation', () => {
  test('starts at the chosen arrangement with bounded body and collider counts', async () => {
    const simulation = await create();
    expect(simulation.snapshot()).toEqual({
      tick: 0,
      ball: { id: 'ball', x: 3, y: 6, velocityX: 0, velocityY: 0 },
      bodyCount: 2, colliderCount: 2,
    });
  });

  test('gravity causes a fall and floor contact causes an upward bounce', async () => {
    const simulation = await create();
    const falling = simulation.step(30);
    expect(falling.ball.y).toBeLessThan(5);
    expect(falling.ball.velocityY).toBeLessThan(0);
    let bounced = false;
    for (let i = 0; i < 120; i++) {
      const snapshot = simulation.step();
      expect(snapshot.ball.y).toBeGreaterThan(FLOOR_HEIGHT + BALL_RADIUS - 0.04);
      if (snapshot.ball.velocityY > 1) bounced = true;
    }
    expect(bounced).toBe(true);
  });

  test('reset restores position, velocity, tick and identical second-run results', async () => {
    const simulation = await create();
    const initial = simulation.snapshot();
    const firstRun = simulation.step(100);
    simulation.step(300);
    for (let run = 0; run < 5; run++) {
      simulation.reset();
      expect(simulation.snapshot()).toEqual(initial);
      expect(simulation.step(100)).toEqual(firstRun);
    }
  });

  test('a height edit changes the physical outcome and becomes the reset arrangement', async () => {
    const simulation = await create();
    const original = simulation.step(20);
    simulation.reset({ ...DEFAULT_SCENE, ballY: 2 });
    const edited = simulation.step(20);
    expect(original.ball.y - edited.ball.y).toBeCloseTo(4, 4);
    simulation.reset();
    expect(simulation.snapshot().ball.y).toBe(2);
    expect(simulation.snapshot().tick).toBe(0);
  });

  test('zero restitution removes the rebound', async () => {
    const simulation = await create({ ...DEFAULT_SCENE, restitution: 0 });
    let maximumUpwardVelocity = 0;
    for (let i = 0; i < 240; i++) {
      maximumUpwardVelocity = Math.max(maximumUpwardVelocity, simulation.step().ball.velocityY);
    }
    expect(maximumUpwardVelocity).toBeLessThan(0.1);
    expect(simulation.snapshot().ball.y).toBeCloseTo(FLOOR_HEIGHT + BALL_RADIUS, 1);
  });

  test('caps runs and does not accumulate bodies across repeated resets', async () => {
    const simulation = await create();
    for (let run = 0; run < 10; run++) {
      simulation.reset();
      expect(simulation.step(MAX_TICKS).tick).toBe(MAX_TICKS);
      const stopped = simulation.snapshot();
      expect(simulation.step(10)).toEqual(stopped);
      expect(stopped.bodyCount).toBe(2);
      expect(stopped.colliderCount).toBe(2);
    }
  });

  test('rejects unsafe edits without corrupting the running world', async () => {
    const simulation = await create();
    const snapshot = simulation.step(20);
    expect(() => simulation.reset({ ...DEFAULT_SCENE, ballY: Infinity })).toThrow();
    expect(simulation.snapshot()).toEqual(snapshot);
    expect(() => simulation.step(-1)).toThrow();
    expect(() => simulation.step(1.5)).toThrow();
    expect(() => simulation.step(MAX_TICKS + 1)).toThrow();
  });

  test('dispose is idempotent and rejects use of a freed WASM world', async () => {
    const simulation = await create();
    simulation.dispose();
    simulation.dispose();
    expect(() => simulation.step()).toThrow('disposed');
    expect(() => simulation.reset()).toThrow('disposed');
    expect(() => simulation.snapshot()).toThrow('disposed');
  });
});
