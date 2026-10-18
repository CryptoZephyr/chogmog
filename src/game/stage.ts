import { Application, Graphics } from 'pixi.js';
import { BALL_RADIUS, FLOOR_HEIGHT, MAX_TICKS, WORLD_HEIGHT, WORLD_WIDTH, type FallingScene } from '../domain/fallingScene';
import { FixedStepClock } from './fixedStepClock';
import { FallingSimulation, type PhysicsSnapshot } from './physics';

export interface StageView { snapshot: PhysicsSnapshot; running: boolean }
export interface Stage {
  run(): void;
  pause(): void;
  reset(scene: FallingScene): void;
  dispose(): void;
}

export async function createStage(
  host: HTMLElement,
  scene: FallingScene,
  signal: AbortSignal,
  notify: (view: StageView) => void,
): Promise<Stage> {
  const simulation = await FallingSimulation.create(scene);
  if (signal.aborted) {
    simulation.dispose();
    throw new DOMException('Stage setup cancelled', 'AbortError');
  }
  const app = new Application();
  try {
    await app.init({
      width: 960, height: 640, background: 0xffffff,
      antialias: true, autoStart: false, preference: 'webgl',
      resolution: Math.min(globalThis.devicePixelRatio || 1, 2), autoDensity: true,
    });
  } catch (error) {
    simulation.dispose();
    if (app.renderer) app.destroy(true, { children: true });
    throw error;
  }
  if (signal.aborted) {
    simulation.dispose();
    app.destroy(true, { children: true });
    throw new DOMException('Stage setup cancelled', 'AbortError');
  }

  const scale = 960 / WORLD_WIDTH;
  const floor = new Graphics().rect(0, (WORLD_HEIGHT - FLOOR_HEIGHT) * scale, 960, FLOOR_HEIGHT * scale).fill(0x999999);
  const ball = new Graphics().circle(0, 0, BALL_RADIUS * scale).fill(0x333333);
  app.stage.addChild(floor, ball);
  app.canvas.setAttribute('role', 'img');
  app.canvas.setAttribute('aria-label', 'Debug physics scene: a ball above a fixed floor');
  host.appendChild(app.canvas);

  const clock = new FixedStepClock();
  let running = false;
  let disposed = false;
  const draw = (snapshot: PhysicsSnapshot) => {
    ball.position.set(snapshot.ball.x * scale, (WORLD_HEIGHT - snapshot.ball.y) * scale);
  };
  const publish = () => notify({ snapshot: simulation.snapshot(), running });
  const pause = () => {
    if (disposed) return;
    running = false;
    clock.reset();
    app.stop();
    app.render();
    publish();
  };
  const onVisibilityChange = () => {
    if (document.hidden) pause();
  };
  document.addEventListener('visibilitychange', onVisibilityChange);
  app.ticker.add((ticker) => {
    if (!running || disposed) return;
    const snapshot = simulation.step(clock.consume(ticker.elapsedMS / 1000));
    draw(snapshot);
    if (snapshot.tick >= MAX_TICKS) pause();
    else if (snapshot.tick % 6 === 0) publish();
  });
  draw(simulation.snapshot());
  app.render();
  publish();

  return {
    run() {
      if (disposed || running || simulation.snapshot().tick >= MAX_TICKS) return;
      clock.reset();
      running = true;
      app.start();
      publish();
    },
    pause,
    reset(nextScene) {
      if (disposed) return;
      simulation.reset(nextScene);
      draw(simulation.snapshot());
      pause();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      document.removeEventListener('visibilitychange', onVisibilityChange);
      app.stop();
      app.destroy(true, { children: true });
      simulation.dispose();
    },
  };
}
