export const WORLD_WIDTH = 12;
export const WORLD_HEIGHT = 8;
export const BALL_RADIUS = 0.25;
export const FLOOR_HEIGHT = 0.4;
export const FIXED_STEP = 1 / 60;
export const MAX_TICKS = 720;

export interface FallingScene {
  version: 1;
  ballX: number;
  ballY: number;
  restitution: number;
}

export const DEFAULT_SCENE: Readonly<FallingScene> = Object.freeze({
  version: 1,
  ballX: 3,
  ballY: 6,
  restitution: 0.65,
});

export function parseFallingScene(value: unknown): FallingScene {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid falling-body scene');
  }
  const scene = value as Record<string, unknown>;
  const bounded = (key: string, min: number, max: number): number => {
    const n = scene[key];
    if (typeof n !== 'number' || !Number.isFinite(n) || n < min || n > max) {
      throw new Error(`Invalid scene field: ${key}`);
    }
    return n;
  };
  if (scene.version !== 1) throw new Error('Unsupported scene version');
  return {
    version: 1,
    ballX: bounded('ballX', BALL_RADIUS, WORLD_WIDTH - BALL_RADIUS),
    ballY: bounded('ballY', 1, WORLD_HEIGHT - 0.5),
    restitution: bounded('restitution', 0, 0.95),
  };
}
