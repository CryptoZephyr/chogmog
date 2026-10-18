import { createHash } from 'node:crypto';
import { describe, expect, test, vi } from 'vitest';
import { canonicalJson, contentId, MAX_DOCUMENT_BYTES } from '../src/domain/canonical';
import { createPartVersion, ENGINE_VERSION, parseScene, parseSourcePin, previewSourcePin, resolvePreviewSource, validateMachine,
  type PartContent, type PartResolver, type PartVersion, type Scene } from '../src/domain/documents';
import packageJson from '../package.json';

const author = '0x1111111111111111111111111111111111111111';
const otherAuthor = '0x2222222222222222222222222222222222222222';
function part(): PartContent {
  return {
    kind: 'part', schemaVersion: 1, rulesVersion: 1, engineVersion: ENGINE_VERSION, partId: 'laser-part', author,
    source: previewSourcePin('533'), reuseAllowed: true, bounds: { width: 3, height: 3 },
    props: [
      { id: 'sensor', type: 'sensor', x: 1, y: 2, width: 0.4, height: 0.2 },
      { id: 'balloon', type: 'balloon', x: 2, y: 1, radius: 0.3 },
    ],
    actions: [{ id: 'laser', type: 'laser', x: 1, y: 1, length: 6, angle: 0 }],
    sockets: [
      { id: 'trigger', direction: 'input', kind: 'event', target: { objectId: 'laser', socket: 'trigger' } },
      { id: 'ray', direction: 'output', kind: 'event', target: { objectId: 'laser', socket: 'fired' } },
      { id: 'confetti', direction: 'output', kind: 'body', target: { objectId: 'balloon', socket: 'confetti' } },
    ],
    controls: [{ id: 'aim', objectId: 'laser', field: 'angle', min: -0.6, max: 0.6, default: 0 }],
    connections: [
      { from: { objectId: 'sensor', socket: 'triggered' }, to: { objectId: 'laser', socket: 'trigger' } },
      { from: { objectId: 'laser', socket: 'fired' }, to: { objectId: 'balloon', socket: 'hit' } },
    ],
  };
}
function scene(version: PartVersion): Scene {
  return {
    kind: 'machine', schemaVersion: 1, rulesVersion: 1, engineVersion: ENGINE_VERSION, machineId: 'first-machine', author: otherAuthor,
    seed: 143, bounds: { width: 12, height: 8 }, message: 'Make mischief move!',
    props: [
      { id: 'lever', type: 'lever', x: 10, y: 2, width: 1, height: 0.2 },
      { id: 'banner', type: 'banner', x: 10, y: 5 },
    ],
    parts: [{ id: 'first', versionId: version.id, x: 1, y: 1, values: {} }],
    connections: [
      { from: { objectId: 'first', socket: 'ray' }, to: { objectId: 'lever', socket: 'hit' } },
      { from: { objectId: 'lever', socket: 'activated' }, to: { objectId: 'banner', socket: 'open' } },
    ],
    inputs: [{ id: 'start', tick: 0, target: { objectId: 'first', socket: 'trigger' } }],
  };
}
const registry = (version: PartVersion, origin: 'public-data-preview' | 'holder-published' = 'public-data-preview'): PartResolver =>
  async () => ({ version, origin });
const make = (input: unknown = part()) => createPartVersion(input, resolvePreviewSource);
function edit(value: object, path: string, replacement: unknown) {
  const keys = path.split('.');
  let target = value;
  for (const key of keys.slice(0, -1)) target = Reflect.get(target, key);
  Reflect.set(target, keys.at(-1)!, replacement);
}

describe('bounded canonical JSON v1', () => {
  test('sorts keys, preserves arrays and uses exact UTF-8 SHA-256 bytes', async () => {
    const input = { z: [2, 1], a: 'Chog 🐸', n: -0 };
    const expected = '{"a":"Chog 🐸","n":0,"z":[2,1]}';
    expect(canonicalJson(input)).toBe(expected);
    expect(await contentId(input)).toBe(`sha256:${createHash('sha256').update(expected).digest('hex')}`);
    expect(await contentId({ a: 1, b: 2 })).toBe(await contentId({ b: 2, a: 1 }));
    expect(await contentId([1, 2])).not.toBe(await contentId([2, 1]));
  });
  test.each([undefined, NaN, Infinity, -Infinity, 1n, () => 1, new Date(), new Map(), { a: undefined }, [undefined],
    new Array(2), new Array(1_000_000), Object.assign([1], { extra: true }), { [Symbol('key')]: 1 },
  ])('rejects unsupported JSON data %#', (value) => { expect(() => canonicalJson(value)).toThrow(); });
  test('rejects cycles, getters, deep and oversized payloads before hashing', () => {
    const cycle = { self: null as unknown }; cycle.self = cycle;
    const getter = vi.fn(() => 'unsafe');
    expect(() => canonicalJson(cycle)).toThrow();
    expect(() => canonicalJson(Object.defineProperty({}, 'value', { get: getter, enumerable: true }))).toThrow();
    expect(getter).not.toHaveBeenCalled();
    let deep: unknown = 0;
    for (let i = 0; i < 18; i++) deep = { deep };
    expect(() => canonicalJson(deep)).toThrow(/complexity/);
    expect(() => canonicalJson('a'.repeat(MAX_DOCUMENT_BYTES))).toThrow(/byte/);
    expect(() => canonicalJson('🐸'.repeat(20_000))).toThrow(/byte/);
  });
});

describe('source pins and immutable one-Chog parts', () => {
  test('pins the engine to the actual installed package and separates token from artwork', () => {
    expect(ENGINE_VERSION).toBe(`rapier2d-compat@${packageJson.dependencies['@dimforge/rapier2d-compat']}`);
    expect(previewSourcePin('846')).toMatchObject({ nft: { tokenId: '846' }, artworkNumber: 338 });
    expect(previewSourcePin('533')).toMatchObject({ nft: { tokenId: '533' }, artworkNumber: 25 });
  });
  test.each([
    ['nft.tokenId', '0533'], ['nft.tokenId', '-1'], ['nft.tokenId', '1e3'], ['nft.tokenId', (2n ** 256n).toString()],
    ['nft.chainId', 1], ['nft.collection', author], ['metadataSha256', 'abc'], ['artworkSha256', 'f'.repeat(63)],
    ['artworkNumber', 533], ['tokenURI', 'https://evil.example/25.json'], ['imageURI', 'ipfs://cid/25.json'],
    ['observedAt', '2026-02-30T00:00:00.000Z'],
  ])('rejects malformed source %s = %s', (path, value) => {
    const pin = previewSourcePin('533'); edit(pin, path, value);
    expect(() => parseSourcePin(pin)).toThrow();
  });
  test('cross-checks trusted pins and never accepts a client ability list or substituted metadata hash', async () => {
    const p = part(); p.source.metadataSha256 = 'a'.repeat(64);
    await expect(make(p)).rejects.toThrow(/verified cache/);
    await expect(make({ ...part(), kit: ['portal'] })).rejects.toThrow(/field/);
    await expect(createPartVersion(part(), async () => ({ pin: previewSourcePin('846'), metadata: (await resolvePreviewSource(previewSourcePin('533'))).metadata })))
      .rejects.toThrow(/snapshot mismatch/);
    const noLaser = part(); noLaser.source = previewSourcePin('846');
    await expect(make(noLaser)).rejects.toThrow(/trait kit/);
  });
  test('combines real Fire and Wizard abilities, while bounds constrain each action and control', async () => {
    const p = part(); p.source = previewSourcePin('846'); p.props = []; p.sockets = []; p.connections = [];
    p.actions = [
      { id: 'lift', type: 'lift', x: 1, y: 1, width: 1, height: 1.5, acceleration: 24, maxSpeed: 8 },
      { id: 'portal', type: 'portal', x: 1, y: 1, exitX: 2, exitY: 2, radius: 0.2, quarterTurns: 1, cooldownTicks: 30 },
    ];
    p.controls = [{ id: 'speed', objectId: 'lift', field: 'maxSpeed', min: 0, max: 8, default: 8 }];
    const v = await make(p);
    expect(v.content.actions.map((a) => a.type)).toEqual(['lift', 'portal']);
    p.actions[1] = { ...p.actions[1] as Extract<typeof p.actions[number], { type: 'portal' }>, exitX: 1, exitY: 1 };
    await expect(make(p)).rejects.toThrow(/Overlapping/);
  });
  test('baseline release requires a prepared ball, not an arbitrary spawn script', async () => {
    const p = part(); p.props = [{ id: 'ball', type: 'ball', x: 1, y: 2, radius: 0.2, restitution: 0.2 }];
    p.actions = [{ id: 'release', type: 'release', x: 1, y: 2, propId: 'ball' }]; p.sockets = []; p.connections = []; p.controls = [];
    await expect(make(p)).resolves.toHaveProperty('id');
    p.props = [];
    await expect(make(p)).rejects.toThrow(/prepared ball/);
  });
  test.each([
    ['schemaVersion', 2], ['rulesVersion', 2], ['engineVersion', 'latest'], ['author', '0x' + '0'.repeat(40)],
    ['props.0.x', -1], ['props.1.radius', 2], ['props.1.x', 3], ['actions.0.length', Infinity],
    ['actions.0.type', 'script'], ['actions.0.angle', 4], ['controls.0.field', 'source'],
    ['controls.0.min', -10], ['controls.0.default', 0.1], ['sockets.0.kind', 'body'],
    ['sockets.0.target.socket', 'constructor'], ['connections.0.to.socket', 'fired'],
    ['connections.0.from.objectId', 'missing'], ['connections.0.from.socket', 'body'],
  ])('rejects unsafe part %s = %s', async (path, value) => {
    const p = part(); edit(p, path, value); await expect(make(p)).rejects.toThrow();
  });
  test('rejects duplicate IDs, repeated actions, duplicate connections and recursive parts', async () => {
    const p = part(); p.props.push(p.props[0]); await expect(make(p)).rejects.toThrow(/Duplicate/);
    const a = part(); a.actions.push({ ...a.actions[0], id: 'another' }); await expect(make(a)).rejects.toThrow(/distinct/);
    const c = part(); c.connections.push(c.connections[0]); await expect(make(c)).rejects.toThrow(/Duplicate/);
    await expect(make({ ...part(), parts: [{ versionId: 'recursive' }] })).rejects.toThrow(/field/);
  });
  test('normalizes ordering and returns independent deeply frozen versions', async () => {
    const p = part(); const first = await make(p);
    p.props.reverse(); p.sockets.reverse(); p.connections.reverse();
    expect((await make(p)).id).toBe(first.id);
    p.author = otherAuthor;
    const later = await make(p);
    expect(later.id).not.toBe(first.id);
    expect(first.content.author).toBe(author);
    expect(Object.isFrozen(first.content.source.nft)).toBe(true);
    expect(Object.isFrozen(first.content.actions[0])).toBe(true);
    expect(() => Reflect.set(first.content.source.nft, 'tokenId', '846')).not.toThrow();
    expect(first.content.source.nft.tokenId).toBe('533');
    p.source.artworkNumber = 999;
    expect(later.content.source.artworkNumber).toBe(25);
  });
});

describe('machine expansion, permissions and typed connections', () => {
  test('pins versions, derives counts and applies only exposed values without rewriting the original', async () => {
    const v = await make(); const s = scene(v); s.parts[0].values = { aim: 0.5 };
    const result = await validateMachine(s, registry(v), resolvePreviewSource);
    expect(result.budgets).toEqual({ props: 4, dynamicBodies: 12 });
    expect(result.expanded[0].configured.actions[0]).toHaveProperty('angle', 0.5);
    expect(v.content.actions[0]).toHaveProperty('angle', 0);
    expect(result.scene.parts[0].versionId).toBe(v.id);
    expect(Object.isFrozen(result.expanded[0].configured)).toBe(true);
    s.props.reverse(); s.connections.reverse();
    expect((await validateMachine(s, registry(v), resolvePreviewSource)).id).toBe(result.id);
  });
  test.each([['hidden', 0], ['aim', 0.7], ['aim', NaN]])('rejects invalid exposed value %s', async (key, value) => {
    const v = await make(); const s = scene(v); s.parts[0].values = { [key]: value };
    await expect(validateMachine(s, registry(v), resolvePreviewSource)).rejects.toThrow();
  });
  test.each([
    ['parts.0.versionId', 'latest'], ['parts.0.x', 10], ['parts.0.y', 6], ['seed', -1], ['seed', 1.5],
    ['message', ' '], ['message', 'a'.repeat(81)], ['bounds.width', 24], ['inputs.0.tick', 720],
    ['inputs.0.target.socket', 'ray'], ['connections.0.from.socket', 'trigger'],
    ['connections.0.from.objectId', 'missing'], ['connections.0.from.socket', 'confetti'],
  ])('rejects invalid scene %s = %s', async (path, value) => {
    const v = await make(); const s = scene(v); edit(s, path, value);
    await expect(validateMachine(s, registry(v), resolvePreviewSource)).rejects.toThrow();
  });
  test('sorts inputs by tick then stable ID and rejects raw internal overrides', async () => {
    const v = await make(); const s = scene(v);
    s.inputs.push({ ...s.inputs[0], id: 'earlier', tick: 0 }, { ...s.inputs[0], id: 'later', tick: 10 });
    expect(parseScene(s).inputs.map((i) => i.id)).toEqual(['earlier', 'start', 'later']);
    const duplicate = scene(v); duplicate.props.push({ id: 'first', type: 'banner', x: 1, y: 1 });
    expect(() => parseScene(duplicate)).toThrow(/Duplicate/);
    const override = scene(v); Reflect.set(override.parts[0], 'actions', []);
    expect(() => parseScene(override)).toThrow(/field/);
  });
  test('later source versions cannot replace an existing machine pin or its author credit', async () => {
    const original = await make(); const s = scene(original);
    const changed = part(); changed.author = otherAuthor;
    const later = await make(changed);
    await expect(validateMachine(s, registry(later), resolvePreviewSource)).rejects.toThrow(/pinned version/);
    const correct = await validateMachine(s, registry(original), resolvePreviewSource);
    expect(correct.expanded[0].version.content.author).toBe(author);
    expect(correct.scene.author).toBe(otherAuthor);
    expect(correct.scene.parts[0].versionId).toBe(original.id);
  });
  test('content-address verification catches a mutated registry entry', async () => {
    const original = await make(); const changed = structuredClone(original); changed.content.author = otherAuthor;
    await expect(validateMachine(scene(original), registry(changed), resolvePreviewSource)).rejects.toThrow(/pinned version/);
  });
  test('preview source provenance comes from the trusted registry and cannot enter publication-ready content', async () => {
    const v = await make(); const s = scene(v);
    await expect(validateMachine(s, registry(v), resolvePreviewSource, 'publication')).rejects.toThrow(/Preview/);
    // This registry flag is synthetic unit-test state, not evidence of genuine holder publication.
    await expect(validateMachine(s, registry(v, 'holder-published'), resolvePreviewSource, 'publication')).resolves.toHaveProperty('id');
    const propOnly = part(); propOnly.sockets[1].target = { objectId: 'sensor', socket: 'triggered' };
    const propVersion = await make(propOnly);
    await expect(validateMachine(scene(propVersion), registry(propVersion, 'holder-published'), resolvePreviewSource, 'publication')).rejects.toThrow(/direct Chog/);
    const restricted = part(); restricted.reuseAllowed = false; const r = await make(restricted);
    await expect(validateMachine(scene(r), registry(r), resolvePreviewSource)).rejects.toThrow(/grant reuse/);
  });
  test('counts every instance and worst-case confetti against the 80-body expanded budget', async () => {
    const v = await make(); const s = scene(v);
    s.parts = Array.from({ length: 6 }, (_, i) => ({ ...s.parts[0], id: i ? `part-${i}` : 'first' }));
    expect((await validateMachine(s, registry(v), resolvePreviewSource)).budgets.dynamicBodies).toBe(72);
    s.props.push(...Array.from({ length: 9 }, (_, i) => ({ id: `ball-${i}`, type: 'ball' as const, x: 1, y: 1, radius: 0.1, restitution: 0 })));
    await expect(validateMachine(s, registry(v), resolvePreviewSource)).rejects.toThrow(/Expanded/);
    const alone = scene(v); alone.parts = []; alone.inputs = []; alone.connections = [];
    alone.props = Array.from({ length: 7 }, (_, i) => ({ id: `balloon-${i}`, type: 'balloon', x: 1, y: 1, radius: 0.1 }));
    await expect(validateMachine(alone, registry(v), resolvePreviewSource)).rejects.toThrow(/Expanded/);
  });
  test('enforces six parts and thirty props after expansion, including duplicated source versions', async () => {
    const v = await make(); const s = scene(v);
    s.parts = Array.from({ length: 7 }, (_, i) => ({ ...s.parts[0], id: i ? `part-${i}` : 'first' }));
    expect(() => parseScene(s)).toThrow(/Array limit/);
    s.parts.pop();
    s.props.push(...Array.from({ length: 19 }, (_, i) => ({ id: `banner-${i}`, type: 'banner' as const, x: 1, y: 1 })));
    await expect(validateMachine(s, registry(v), resolvePreviewSource)).rejects.toThrow(/Expanded/);
  });
  test('internal part connections count against the aggregate connection budget', async () => {
    const v = await make(); const s = scene(v);
    s.props = Array.from({ length: 20 }, (_, i) => ({ id: `lever-${i}`, type: 'lever', x: 1, y: 1, width: 0.2, height: 0.2 }));
    s.connections = Array.from({ length: 199 }, (_, i) => ({ from: { objectId: `lever-${Math.floor(i / 20)}`, socket: 'activated' }, to: { objectId: `lever-${i % 20}`, socket: 'hit' } }));
    await expect(validateMachine(s, registry(v), resolvePreviewSource)).rejects.toThrow(/Expanded/);
  });
});
