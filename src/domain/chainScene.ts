import { getPreview, TRAIT_RULES_VERSION } from './chog';

export interface ChainScene {
  version: 1;
  rulesVersion: 1;
  seed: 143;
  ballX: number;
  laserAim: number;
  liftToken: string;
  portalToken: string;
  laserToken: string;
  portalExitY: number;
  message: string;
}
export const DEFAULT_CHAIN: Readonly<ChainScene> = Object.freeze({
  version: 1, rulesVersion: TRAIT_RULES_VERSION, seed: 143,
  ballX: 2, laserAim: 0, liftToken: '846', portalToken: '846', laserToken: '533',
  portalExitY: 4, message: 'Make mischief move!',
});
export function parseChainScene(value: unknown): ChainScene {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid chain');
  const scene = value as Record<string, unknown>;
  if (scene.version !== 1 || scene.rulesVersion !== TRAIT_RULES_VERSION || scene.seed !== 143) throw new Error('Unsupported chain version or seed');
  const number = (key: string, min: number, max: number) => {
    const n = scene[key];
    if (typeof n !== 'number' || !Number.isFinite(n) || n < min || n > max) throw new Error(`Invalid ${key}`);
    return n;
  };
  if (typeof scene.message !== 'string' || !scene.message.trim() || [...scene.message].length > 80) throw new Error('Message must contain 1 to 80 characters');
  return {
    version: 1, rulesVersion: 1, seed: 143,
    ballX: number('ballX', 0.5, 3.5), laserAim: number('laserAim', -0.6, 0.6),
    liftToken: getPreview(scene.liftToken).tokenId, portalToken: getPreview(scene.portalToken).tokenId,
    laserToken: getPreview(scene.laserToken).tokenId, portalExitY: number('portalExitY', 2, 6),
    message: scene.message,
  };
}

const STORAGE_KEY = 'chogmog:first-chain:v1';
export function loadChain(): ChainScene {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw && raw.length <= 2048) return parseChainScene(JSON.parse(raw));
  } catch { /* Recover to the known valid preview. */ }
  return { ...DEFAULT_CHAIN };
}
export function saveChain(scene: ChainScene): boolean {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(parseChainScene(scene))); return true; }
  catch { return false; }
}
