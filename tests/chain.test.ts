import { afterEach, describe, expect, test, vi } from 'vitest';
import { DEFAULT_CHAIN, loadChain, parseChainScene, saveChain, type ChainScene } from '../src/domain/chainScene';
import { MAX_TICKS } from '../src/domain/fallingScene';
import { ChainSimulation } from '../src/game/chain';

const active: ChainSimulation[] = [];
async function create(edits: Partial<ChainScene> = {}) {
  const simulation = await ChainSimulation.create({ ...DEFAULT_CHAIN, ...edits });
  active.push(simulation);
  return simulation;
}
afterEach(() => { for (const s of active.splice(0)) s.dispose(); vi.unstubAllGlobals(); });

describe('trait-powered first chain in real Rapier WASM', () => {
  test('physical sensor, ray, force, teleport and confetti contact open the banner in causal order', async () => {
    const simulation = await create();
    const final = simulation.step(MAX_TICKS);
    expect(final.bannerOpen, JSON.stringify(final.events)).toBe(true);
    expect(final.events.filter((e) => ['released', 'sensor', 'laser', 'popped', 'lever', 'banner'].includes(e.type)).map((e) => e.type))
      .toEqual(['released', 'sensor', 'laser', 'popped', 'lever', 'banner']);
    const lever = final.events.find((e) => e.type === 'lever')!;
    expect(lever.actor).toMatch(/^confetti-/);
    const lifted = final.events.find((e) => e.type === 'lifted' && e.target === lever.actor)!;
    const portal = final.events.find((e) => e.type === 'teleported' && e.target === lever.actor)!;
    expect(lifted.sourceToken).toBe('846');
    expect(portal.sourceToken).toBe('846');
    expect(lifted.tick).toBeLessThan(portal.tick);
    expect(portal.tick).toBeLessThan(lever.tick);
    expect(final.bodies).toHaveLength(13);
    expect(final.events.length).toBeLessThan(200);
    expect(final.laserEnd!.x).toBeLessThan(5);
  });
  test.each([
    [{ liftToken: '533' }, 'lifted', true],
    [{ portalToken: '533' }, 'teleported', true],
    [{ laserToken: '846' }, 'laser', false],
  ] as const)('actual source swap %j breaks only the affected chain step', async (edits, absent, popped) => {
    const final = (await create(edits)).step(MAX_TICKS);
    expect(final.bannerOpen).toBe(false);
    expect(final.balloonPopped).toBe(popped);
    expect(final.events.some((e) => e.type === absent)).toBe(false);
    expect(final.events.some((e) => e.type === 'sensor')).toBe(true);
  });
  test.each([{ ballX: 3.25 }, { laserAim: 0.5 }, { portalExitY: 2 }])('a meaningful geometry edit %j changes the physical result', async (edits) => {
    const original = (await create()).step(MAX_TICKS);
    const edited = (await create(edits)).step(MAX_TICKS);
    expect(original.bannerOpen).toBe(true);
    expect(edited.bannerOpen).toBe(false);
    expect(edited.events).not.toEqual(original.events);
  });
  test('reset reconstructs bodies, per-object cooldowns, outputs and identical tick traces', async () => {
    const simulation = await create();
    const initial = simulation.snapshot();
    const run = simulation.step(MAX_TICKS);
    for (let i = 0; i < 10; i++) {
      simulation.reset();
      expect(simulation.snapshot()).toEqual(initial);
      expect(simulation.step(MAX_TICKS)).toEqual(run);
      expect(simulation.step(1)).toEqual(run);
    }
  });
  test('rejects bad edits atomically and protects evidence from outside mutation', async () => {
    const simulation = await create();
    const before = simulation.step(100);
    expect(() => simulation.reset({ ...DEFAULT_CHAIN, portalExitY: Infinity })).toThrow();
    expect(simulation.snapshot()).toEqual(before);
    before.events.length = 0;
    before.bodies[0].x = 100;
    expect(simulation.snapshot().events.length).toBeGreaterThan(0);
    expect(simulation.snapshot().bodies[0].x).toBe(2);
    for (const n of [-1, 0.5, NaN, MAX_TICKS + 1]) expect(() => simulation.step(n)).toThrow();
    simulation.dispose();
    simulation.dispose();
    expect(() => simulation.step()).toThrow('disposed');
  });
});

test('bounds scene data, token identities and plain-text message', () => {
  for (const scene of [null, {}, { ...DEFAULT_CHAIN, message: 'x'.repeat(81) },
    { ...DEFAULT_CHAIN, seed: 0 }, { ...DEFAULT_CHAIN, rulesVersion: 2 },
    { ...DEFAULT_CHAIN, laserToken: '25' }, { ...DEFAULT_CHAIN, ballX: NaN }]) {
    expect(() => parseChainScene(scene)).toThrow();
  }
  expect(parseChainScene({ ...DEFAULT_CHAIN, message: '<script>plain text</script>', abilities: ['laser'] })).toEqual({ ...DEFAULT_CHAIN, message: '<script>plain text</script>' });
});

test('saves only an arrangement, restores it and recovers safely from bad local data', () => {
  let raw: string | null = null;
  vi.stubGlobal('localStorage', {
    getItem: () => raw,
    setItem: (key: string, value: string) => { expect(key).toBe('chogmog:first-chain:v1'); raw = value; },
  });
  const scene = { ...DEFAULT_CHAIN, ballX: 3, message: 'A different message' };
  expect(saveChain(scene)).toBe(true);
  expect(loadChain()).toEqual(scene);
  for (const invalid of [null, '{', '{}', 'x'.repeat(2049), JSON.stringify({ ...scene, liftToken: '338' })]) {
    raw = invalid;
    expect(loadChain()).toEqual(DEFAULT_CHAIN);
  }
  vi.stubGlobal('localStorage', { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } });
  expect(loadChain()).toEqual(DEFAULT_CHAIN);
  expect(saveChain(scene)).toBe(false);
});
