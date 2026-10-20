import { DEFAULT_SCENE, parseFallingScene, type FallingScene } from './fallingScene';

export const SCENE_STORAGE_KEY = 'chogmog:falling-scene:v1';
type SceneStorage = Pick<Storage, 'getItem' | 'setItem'>;

export function loadScene(storage?: SceneStorage): FallingScene {
  try {
    const raw = (storage ?? globalThis.localStorage).getItem(SCENE_STORAGE_KEY);
    if (raw && raw.length <= 1024) return parseFallingScene(JSON.parse(raw));
  } catch {
    // Corrupt or unavailable storage must not block the development canvas.
  }
  return { ...DEFAULT_SCENE };
}

export function saveScene(scene: FallingScene, storage?: SceneStorage): boolean {
  try {
    (storage ?? globalThis.localStorage).setItem(
      SCENE_STORAGE_KEY,
      JSON.stringify(parseFallingScene(scene)),
    );
    return true;
  } catch {
    return false;
  }
}
