import { afterEach, describe, expect, test } from 'vitest';
import { authoredPart, loadPartSettings, loadPartSource, newPartSettings, parsePartSettings, savePartSettings, savePartSource, type PartSettings } from '../src/domain/partAuthoring';
import { getPreview } from '../src/domain/chog';
import { createPartVersion, previewSourcePin, resolvePreviewSource, validateMachine } from '../src/domain/documents';
import { PartPreview } from '../src/game/partPreview';
import { account, scene } from './backendFixtures';

const simulations: PartPreview[] = [];
const author = account().address;
const source = (token: string) => ({ pin: previewSourcePin(token), metadata: getPreview(token).metadata });
async function build(action: PartSettings['action'], overrides: Partial<PartSettings> = {}) {
  return authoredPart({ ...newPartSettings(), action, ...overrides }, author, source(action === 'lift' || action === 'portal' ? '846' : '533'));
}
async function simulation(action: PartSettings['action'], overrides: Partial<PartSettings> = {}) {
  const sim = await PartPreview.create(await build(action, overrides)); simulations.push(sim); return sim;
}
afterEach(() => { for (const sim of simulations.splice(0)) sim.dispose(); });

describe('bounded T6 part authoring', () => {
  test('all supported presets produce exact immutable T3 parts with genuine-compatible ports', async () => {
    for (const action of ['push', 'release', 'laser', 'lift', 'portal'] as const) {
      const version = await build(action, { reuseAllowed: true, ramp: true });
      expect(await createPartVersion(version.content, resolvePreviewSource)).toEqual(version);
      expect(Object.isFrozen(version.content)).toBe(true);
      expect(version.content.actions[0].type).toBe(action);
      expect(version.content.sockets.map((s) => s.direction)).toEqual(['input', 'output']);
      expect(version.content.controls).toHaveLength(1);
    }
  });
  test('every supported token has useful baseline push/release without a rare trait', async () => {
    for (const token of ['846', '533']) for (const action of ['push', 'release'] as const) {
      expect((await authoredPart({ ...newPartSettings(), action }, author, source(token))).content.actions[0].type).toBe(action);
    }
  });
  test('missing trait and client-injected script/kit settings cannot create an authorable part', async () => {
    await expect(authoredPart({ ...newPartSettings(), action: 'laser' }, author, source('846'))).rejects.toThrow('does not have');
    for (const change of [{ action: 'shout' }, { scripts: ['evil'] }, { kit: ['laser'] }, { ballY: Infinity }, { impulse: 9 }, { partId: 'Bad name' }]) {
      expect(() => parsePartSettings({ ...newPartSettings(), ...change })).toThrow();
    }
  });
  test('exposure and explicit reusable permission change the pinned version, and old versions remain frozen', async () => {
    const settings = newPartSettings(), original = await authoredPart(settings, author, source('533'));
    const changed = await authoredPart({ ...settings, expose: false, reuseAllowed: true }, author, source('533'));
    expect(changed.content.controls).toEqual([]); expect(changed.id).not.toBe(original.id);
    expect(original.content.reuseAllowed).toBe(false); expect(original.content.controls).toHaveLength(1);
  });
  test('published-compatible baseline exposes only the chosen control to a future machine', async () => {
    const version = await build('release', { reuseAllowed: true });
    const machine = scene(version, author);
    machine.parts[0] = { ...machine.parts[0], x: 0, y: 0 };
    machine.connections = [];
    machine.inputs[0].target.socket = 'in';
    machine.parts[0].values = { bounce: 0.8 };
    const resolve = async () => ({ version, origin: 'holder-published' as const });
    expect((await validateMachine(machine, resolve, resolvePreviewSource)).expanded[0].configured.props.find((p) => p.type === 'ball')).toMatchObject({ restitution: 0.8 });
    machine.parts[0].values = { impulse: 8 };
    await expect(validateMachine(machine, resolve, resolvePreviewSource)).rejects.toThrow();
  });
  test('settings and public source snapshots recover without ownership or credentials', () => {
    const map = new Map<string, string>();
    const storage = { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => { map.set(k, v); } };
    const settings = newPartSettings();
    expect(savePartSettings(storage, settings)).toBe(true);
    expect(savePartSource(storage, source('846'))).toBe(true);
    expect(loadPartSettings(storage)).toEqual({ settings, recovered: true });
    expect(loadPartSource(storage)).toEqual(source('846'));
    expect([...map.values()].join()).not.toMatch(/credential|signature|isOwner|sessionHash/);
    const denied = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
    expect(savePartSettings(denied, settings)).toBe(false);
    expect(loadPartSettings(denied).recovered).toBe(false);
    expect(loadPartSource(denied).pin.nft.tokenId).toBe('533');
    expect(savePartSettings(storage, { ...settings, ballY: NaN })).toBe(false);
    expect(loadPartSettings(storage).settings).toEqual(settings);
  });
});

describe('real Rapier single-part sandbox', () => {
  test('baseline release falls, bounces, resets and repeats from its saved position', async () => {
    const sim = await simulation('release');
    const initial = sim.snapshot();
    const first = sim.step(30);
    expect(first.bodies[0].y).toBeLessThan(initial.bodies[0].y);
    expect(first.events[0].text).toContain('released');
    let bounced = false;
    for (let i = 0; i < 150; i++) if (sim.step().bodies[0].vy > 1) bounced = true;
    expect(bounced).toBe(true);
    sim.reset(); expect(sim.snapshot()).toEqual(initial); expect(sim.step(30)).toEqual(first);
    const edited = await simulation('release', { ballY: 3 });
    expect(edited.step(30).bodies[0].y).toBeLessThan(first.bodies[0].y);
  });
  test('push strength changes real horizontal displacement rather than only a label', async () => {
    const weak = await simulation('push', { impulse: 1 }), strong = await simulation('push', { impulse: 4 });
    expect(strong.step(15).bodies[0].x).toBeGreaterThan(weak.step(15).bodies[0].x + 0.4);
  });
  test('a ray pops the balloon physically, and changing aim causes a miss', async () => {
    const hit = await simulation('laser'), miss = await simulation('laser', { angle: 0.6 });
    expect(hit.step(2).balloonPopped).toBe(true); expect(hit.snapshot().bodies).toHaveLength(12);
    expect(miss.step(2).balloonPopped).toBe(false); expect(miss.snapshot().bodies).toHaveLength(0);
  });
  test('Fire lift raises a body and Wizard portals relocate only an entering body', async () => {
    const lift = await simulation('lift'), portal = await simulation('portal');
    expect(lift.step(30).bodies[0].y).toBeGreaterThan(1.3);
    const result = portal.step(100);
    expect(result.events.some((e) => e.text.includes('portal moved'))).toBe(true);
    expect(result.bodies[0].x).toBeGreaterThan(5);
  });
  test('all presets cap bodies, velocity, run length and reset allocations', async () => {
    for (const action of ['push', 'release', 'laser', 'lift', 'portal'] as const) {
      const sim = await simulation(action);
      const end = sim.step(720);
      expect(end.tick).toBe(720); expect(end.bodies.length).toBeLessThanOrEqual(12);
      expect(end.events.length).toBeLessThanOrEqual(200); expect(sim.step(10)).toEqual(end);
      const counts = [];
      for (let n = 0; n < 5; n++) { sim.reset(); counts.push(sim.snapshot().bodyCount); }
      expect(new Set(counts).size).toBe(1);
      expect(() => sim.step(-1)).toThrow();
      sim.dispose(); expect(() => sim.step()).toThrow('disposed');
    }
  });
});
