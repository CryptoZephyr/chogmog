import { describe, expect, test, vi } from 'vitest';
import { DEFAULT_SCENE, parseFallingScene } from '../src/domain/fallingScene';
import { loadScene, saveScene, SCENE_STORAGE_KEY } from '../src/domain/sceneStorage';

describe('bounded development scene', () => {
  test('copies valid settings and discards unknown keys', () => {
    const input = { ...DEFAULT_SCENE, script: 'ignored' };
    expect(parseFallingScene(input)).toEqual(DEFAULT_SCENE);
    expect(parseFallingScene(input)).not.toBe(input);
  });
  test.each([
    null, [], {}, { ...DEFAULT_SCENE, version: 2 },
    { ...DEFAULT_SCENE, ballX: NaN }, { ...DEFAULT_SCENE, ballY: Infinity },
    { ...DEFAULT_SCENE, ballX: 12 }, { ...DEFAULT_SCENE, ballX: -1 },
    { ...DEFAULT_SCENE, ballY: 0 }, { ...DEFAULT_SCENE, ballY: 8 },
    { ...DEFAULT_SCENE, restitution: 1 }, { ...DEFAULT_SCENE, ballY: '6' },
  ])('rejects invalid scene %#', (input) => expect(() => parseFallingScene(input)).toThrow());
});

describe('local arrangement persistence', () => {
  test('round trips only validated arrangement settings', () => {
    const map = new Map<string, string>();
    const storage = {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => { map.set(key, value); },
    };
    const scene = { ...DEFAULT_SCENE, ballX: 7 };
    expect(saveScene(scene, storage)).toBe(true);
    expect(loadScene(storage)).toEqual(scene);
    expect(map.size).toBe(1);
    expect(map.has(SCENE_STORAGE_KEY)).toBe(true);
  });
  test.each([null, '{', '{}', 'x'.repeat(1025), JSON.stringify({ ...DEFAULT_SCENE, version: 2 })])(
    'falls back to defaults for absent, corrupt, oversized or outdated storage %#', (raw) => {
      expect(loadScene({ getItem: () => raw, setItem: vi.fn() })).toEqual(DEFAULT_SCENE);
    },
  );
  test('storage failure does not block play', () => {
    const storage = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('quota'); } };
    expect(loadScene(storage)).toEqual(DEFAULT_SCENE);
    expect(saveScene({ ...DEFAULT_SCENE }, storage)).toBe(false);
  });
});
