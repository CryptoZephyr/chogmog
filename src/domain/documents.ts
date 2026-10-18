import { canonicalJson, contentId, freezeDocument } from './canonical';
import { compileKit, getPreview, parseMetadata, provenance, TRAIT_RULES_VERSION, type Metadata } from './chog';
import { MAX_TICKS, WORLD_HEIGHT, WORLD_WIDTH } from './fallingScene';

export const ENGINE_VERSION = 'rapier2d-compat@0.21.0';
export const SCHEMA_VERSION = 1;
export const LIMITS = Object.freeze({ parts: 6, props: 30, bodies: 80, connections: 200, inputs: 200, sockets: 16, controls: 8 });
type RecordValue = Record<string, unknown>;
interface Point { x: number; y: number }
interface Bounds { width: number; height: number }
interface Header { schemaVersion: 1; engineVersion: typeof ENGINE_VERSION; rulesVersion: 1 }
export interface SourcePin {
  nft: { chainId: 143; collection: string; tokenId: string };
  tokenURI: string; metadataSha256: string; artworkNumber: number;
  imageURI: string; artworkSha256: string; observedAt: string;
}
export type SourceResolver = (pin: Readonly<SourcePin>) => Promise<{ pin: SourcePin; metadata: Metadata }>;
export type Prop = { id: string } & (
  | (Point & { type: 'ball'; radius: number; restitution: number })
  | (Point & { type: 'balloon'; radius: number })
  | (Point & Bounds & { type: 'ramp'; angle: number })
  | (Point & Bounds & { type: 'sensor' | 'lever' })
  | (Point & { type: 'banner' })
);
export type Action = { id: string } & (
  | (Point & { type: 'push'; impulse: number; range: number; angle: number })
  | (Point & { type: 'release'; propId: string })
  | (Point & { type: 'laser'; length: number; angle: number })
  | (Point & Bounds & { type: 'lift'; acceleration: number; maxSpeed: number })
  | (Point & { type: 'portal'; exitX: number; exitY: number; radius: number; quarterTurns: number; cooldownTicks: number })
);
export interface Endpoint { objectId: string; socket: string }
export interface Connection { from: Endpoint; to: Endpoint }
type SocketKind = 'event' | 'body';
type Direction = 'input' | 'output';
export interface Socket { id: string; direction: Direction; kind: SocketKind; target: Endpoint }
export interface Control { id: string; objectId: string; field: string; min: number; max: number; default: number }
export interface PartContent extends Header {
  kind: 'part'; partId: string; author: string; source: SourcePin; reuseAllowed: boolean;
  bounds: Bounds; props: Prop[]; actions: Action[]; sockets: Socket[]; controls: Control[]; connections: Connection[];
}
export interface PartVersion { id: string; content: PartContent }
export interface PartInstance { id: string; versionId: string; x: number; y: number; values: Record<string, number> }
export interface Scene extends Header {
  kind: 'machine'; machineId: string; author: string; seed: number; bounds: Bounds; message: string;
  props: Prop[]; parts: PartInstance[]; connections: Connection[];
  inputs: { id: string; tick: number; target: Endpoint }[];
}
export type PartResolver = (versionId: string) => Promise<{ version: PartVersion; origin: 'public-data-preview' | 'holder-published' }>;

function record(value: unknown, keys: string[]): RecordValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected object');
  const result = value as RecordValue;
  if (Object.keys(result).length !== keys.length || keys.some((key) => !Object.hasOwn(result, key)) ||
      Object.keys(result).some((key) => !keys.includes(key))) throw new Error('Unexpected or missing field');
  return result;
}
function number(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error('Number outside bounds');
  return Object.is(value, -0) ? 0 : value;
}
function integer(value: unknown, min: number, max: number): number {
  const n = number(value, min, max);
  if (!Number.isSafeInteger(n)) throw new Error('Expected integer');
  return n;
}
function text(value: unknown, max: number): string {
  if (typeof value !== 'string' || !value.trim() || [...value].length > max) throw new Error('Invalid text');
  return value;
}
function id(value: unknown): string {
  const s = text(value, 64);
  if (!/^[a-z][a-z0-9-]*$/.test(s)) throw new Error('Invalid object ID');
  return s;
}
function hash(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw new Error('Invalid SHA-256');
  return value;
}
function versionId(value: unknown): string {
  if (typeof value !== 'string' || !value.startsWith('sha256:')) throw new Error('Expected pinned version');
  return `sha256:${hash(value.slice(7))}`;
}
function address(value: unknown): string {
  if (typeof value !== 'string' || !/^0x[a-fA-F0-9]{40}$/.test(value) || /^0x0{40}$/.test(value)) throw new Error('Invalid address');
  return value.toLowerCase();
}
function list<T>(value: unknown, max: number, parse: (value: unknown) => T): T[] {
  if (!Array.isArray(value) || value.length > max) throw new Error('Array limit');
  return value.map(parse);
}
function unique<T extends { id: string }>(items: T[]): T[] {
  if (new Set(items.map((item) => item.id)).size !== items.length) throw new Error('Duplicate object ID');
  return items.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}
function header(value: RecordValue): Header {
  if (value.schemaVersion !== SCHEMA_VERSION || value.engineVersion !== ENGINE_VERSION || value.rulesVersion !== TRAIT_RULES_VERSION) {
    throw new Error('Unsupported schema, engine or rules version');
  }
  return { schemaVersion: 1, engineVersion: ENGINE_VERSION, rulesVersion: 1 };
}
function bounds(value: unknown): Bounds {
  const b = record(value, ['width', 'height']);
  return { width: number(b.width, 0.5, WORLD_WIDTH), height: number(b.height, 0.5, WORLD_HEIGHT) };
}
function point(value: RecordValue, b: Bounds): Point {
  return { x: number(value.x, 0, b.width), y: number(value.y, 0, b.height) };
}
function fits(p: Point, halfWidth: number, halfHeight: number, b: Bounds): void {
  if (p.x - halfWidth < 0 || p.y - halfHeight < 0 || p.x + halfWidth > b.width || p.y + halfHeight > b.height) {
    throw new Error('Geometry outside bounds');
  }
}
function uri(value: unknown): string {
  const s = text(value, 256);
  if (!/^ipfs:\/\/[a-zA-Z0-9]+\/[0-9]+\.(json|webp)$/.test(s)) throw new Error('Invalid pinned source URI');
  return s;
}
export function parseSourcePin(value: unknown): SourcePin {
  canonicalJson(value);
  const s = record(value, ['nft', 'tokenURI', 'metadataSha256', 'artworkNumber', 'imageURI', 'artworkSha256', 'observedAt']);
  const nft = record(s.nft, ['chainId', 'collection', 'tokenId']);
  const tokenId = text(nft.tokenId, 78);
  if (!/^(0|[1-9][0-9]*)$/.test(tokenId) || BigInt(tokenId) >= 2n ** 256n ||
      nft.chainId !== 143 || address(nft.collection) !== provenance.collection) throw new Error('Invalid Genesis reference');
  const observedAt = text(s.observedAt, 24);
  if (!Number.isFinite(Date.parse(observedAt)) || new Date(observedAt).toISOString() !== observedAt) throw new Error('Invalid observation time');
  const artworkNumber = integer(s.artworkNumber, 0, 1_000_000);
  const tokenURI = uri(s.tokenURI), imageURI = uri(s.imageURI);
  if (!tokenURI.endsWith(`/${artworkNumber}.json`) || !imageURI.endsWith(`/${artworkNumber}.webp`)) throw new Error('Artwork reference mismatch');
  return { nft: { chainId: 143, collection: provenance.collection, tokenId }, tokenURI,
    metadataSha256: hash(s.metadataSha256), artworkNumber,
    imageURI, artworkSha256: hash(s.artworkSha256), observedAt };
}

export function previewSourcePin(tokenId: string): SourcePin {
  const p = getPreview(tokenId);
  return parseSourcePin({ nft: { chainId: provenance.chainId, collection: provenance.collection, tokenId },
    tokenURI: p.tokenURI, metadataSha256: p.metadataSha256, artworkNumber: p.artworkNumber,
    imageURI: p.imageURI, artworkSha256: p.artworkSha256, observedAt: provenance.retrievedAt });
}
export const resolvePreviewSource: SourceResolver = async (pin) => {
  const expected = previewSourcePin(pin.nft.tokenId);
  if (canonicalJson(expected) !== canonicalJson(pin)) throw new Error('Source pin differs from verified cache');
  return { pin: expected, metadata: getPreview(pin.nft.tokenId).metadata };
};

function prop(value: unknown, b: Bounds): Prop {
  const type = (value as RecordValue | null)?.type;
  const fields = type === 'ball' ? ['radius', 'restitution'] : type === 'balloon' ? ['radius'] :
    type === 'ramp' ? ['width', 'height', 'angle'] : type === 'sensor' || type === 'lever' ? ['width', 'height'] : type === 'banner' ? [] : null;
  if (!fields) throw new Error('Unsupported prop');
  const p = record(value, ['id', 'type', 'x', 'y', ...fields]);
  const base = { id: id(p.id), ...point(p, b) };
  if (type === 'ball' || type === 'balloon') {
    const radius = number(p.radius, 0.05, 0.75);
    fits(base, radius, radius, b);
    return type === 'ball' ? { ...base, type, radius, restitution: number(p.restitution, 0, 0.95) } : { ...base, type, radius };
  }
  if (type === 'banner') return { ...base, type };
  const width = number(p.width, 0.1, b.width), height = number(p.height, 0.1, b.height);
  if (type === 'ramp') {
    const angle = number(p.angle, -Math.PI, Math.PI);
    fits(base, (Math.abs(Math.cos(angle)) * width + Math.abs(Math.sin(angle)) * height) / 2,
      (Math.abs(Math.sin(angle)) * width + Math.abs(Math.cos(angle)) * height) / 2, b);
    return { ...base, type, width, height, angle };
  }
  fits(base, width / 2, height / 2, b);
  return { ...base, type: type as 'sensor' | 'lever', width, height };
}
function action(value: unknown, b: Bounds): Action {
  const type = (value as RecordValue | null)?.type;
  const fields = type === 'push' ? ['impulse', 'range', 'angle'] : type === 'release' ? ['propId'] :
    type === 'laser' ? ['length', 'angle'] : type === 'lift' ? ['width', 'height', 'acceleration', 'maxSpeed'] :
      type === 'portal' ? ['exitX', 'exitY', 'radius', 'quarterTurns', 'cooldownTicks'] : null;
  if (!fields) throw new Error('Unsupported action');
  const a = record(value, ['id', 'type', 'x', 'y', ...fields]);
  const base = { id: id(a.id), ...point(a, b) };
  if (type === 'release') return { ...base, type, propId: id(a.propId) };
  if (type === 'push') return { ...base, type, impulse: number(a.impulse, 0, 8), range: number(a.range, 0.1, 2), angle: number(a.angle, -Math.PI, Math.PI) };
  if (type === 'laser') return { ...base, type, length: number(a.length, 0.1, WORLD_WIDTH), angle: number(a.angle, -Math.PI, Math.PI) };
  if (type === 'lift') {
    const width = number(a.width, 0.1, b.width), height = number(a.height, 0.1, b.height);
    fits(base, width / 2, height / 2, b);
    return { ...base, type, width, height, acceleration: number(a.acceleration, 0, 24), maxSpeed: number(a.maxSpeed, 0, 8) };
  }
  const radius = number(a.radius, 0.1, 0.5), exitX = number(a.exitX, 0, b.width), exitY = number(a.exitY, 0, b.height);
  fits(base, radius, radius, b); fits({ x: exitX, y: exitY }, radius, radius, b);
  if (Math.hypot(base.x - exitX, base.y - exitY) <= 2 * radius) throw new Error('Overlapping portal apertures');
  return { ...base, type: 'portal', exitX, exitY, radius, quarterTurns: integer(a.quarterTurns, 0, 3), cooldownTicks: integer(a.cooldownTicks, 1, MAX_TICKS) };
}
function endpoint(value: unknown): Endpoint {
  const e = record(value, ['objectId', 'socket']);
  return { objectId: id(e.objectId), socket: id(e.socket) };
}
type Ports = { input: Record<string, SocketKind>; output: Record<string, SocketKind> };
function ports(object: Prop | Action): Ports {
  switch (object.type) {
    case 'ball': return { input: { release: 'event' }, output: { contact: 'event', body: 'body' } };
    case 'balloon': return { input: { hit: 'event' }, output: { popped: 'event', confetti: 'body' } };
    case 'sensor': return { input: { body: 'body' }, output: { triggered: 'event' } };
    case 'lever': return { input: { hit: 'event' }, output: { activated: 'event' } };
    case 'banner': return { input: { open: 'event' }, output: {} };
    case 'ramp': return { input: {}, output: {} };
    case 'release': return { input: { trigger: 'event' }, output: { released: 'body' } };
    case 'push': return { input: { trigger: 'event' }, output: { pushed: 'body' } };
    case 'laser': return { input: { trigger: 'event' }, output: { fired: 'event' } };
    case 'lift': return { input: { body: 'body' }, output: { lifted: 'body' } };
    case 'portal': return { input: { body: 'body' }, output: { teleported: 'body' } };
  }
}
function port(e: Endpoint, direction: Direction, objects: Map<string, Ports>): SocketKind {
  const found = objects.get(e.objectId)?.[direction];
  if (!found || !Object.hasOwn(found, e.socket)) throw new Error('Missing or wrong-direction socket');
  return found[e.socket];
}
function connections(value: unknown, objects: Map<string, Ports>): Connection[] {
  const seen = new Set<string>();
  return list(value, LIMITS.connections, (item) => {
    const c = record(item, ['from', 'to']);
    const parsed = { from: endpoint(c.from), to: endpoint(c.to) };
    if (port(parsed.from, 'output', objects) !== port(parsed.to, 'input', objects)) throw new Error('Incompatible sockets');
    const key = canonicalJson(parsed);
    if (seen.has(key)) throw new Error('Duplicate connection');
    seen.add(key);
    return parsed;
  }).sort((a, b) => { const x = canonicalJson(a), y = canonicalJson(b); return x < y ? -1 : x > y ? 1 : 0; });
}
function controlBounds(object: Prop | Action, field: string): [number, number] {
  if ('angle' in object && field === 'angle') return [-Math.PI, Math.PI];
  if (object.type === 'ball' && field === 'restitution') return [0, 0.95];
  if (object.type === 'laser' && field === 'length') return [0.1, WORLD_WIDTH];
  if (object.type === 'push' && field === 'impulse') return [0, 8];
  if (object.type === 'lift' && field === 'acceleration') return [0, 24];
  if (object.type === 'lift' && field === 'maxSpeed') return [0, 8];
  throw new Error('Field cannot be exposed');
}
function parsePart(value: unknown): PartContent {
  canonicalJson(value);
  const p = record(value, ['kind', 'schemaVersion', 'engineVersion', 'rulesVersion', 'partId', 'author', 'source', 'reuseAllowed', 'bounds', 'props', 'actions', 'sockets', 'controls', 'connections']);
  if (p.kind !== 'part' || typeof p.reuseAllowed !== 'boolean') throw new Error('Invalid part');
  const b = bounds(p.bounds);
  const props = unique(list(p.props, LIMITS.props, (v) => prop(v, b)));
  const actions = unique(list(p.actions, 5, (v) => action(v, b)));
  if (!actions.length || new Set(actions.map((a) => a.type)).size !== actions.length) throw new Error('Expected distinct Chog actions');
  unique([...props, ...actions]);
  const objects = new Map([...props, ...actions].map((o) => [o.id, ports(o)]));
  const released = new Set<string>();
  for (const a of actions) if (a.type === 'release') {
    if (!props.some((p) => p.id === a.propId && p.type === 'ball') || released.has(a.propId)) throw new Error('Release requires a unique prepared ball');
    released.add(a.propId);
  }
  const sockets = unique(list(p.sockets, LIMITS.sockets, (v): Socket => {
    const s = record(v, ['id', 'direction', 'kind', 'target']);
    if ((s.direction !== 'input' && s.direction !== 'output') || (s.kind !== 'event' && s.kind !== 'body')) throw new Error('Invalid socket');
    const target = endpoint(s.target);
    if (port(target, s.direction, objects) !== s.kind) throw new Error('Invalid exposed socket type');
    return { id: id(s.id), direction: s.direction, kind: s.kind, target };
  }));
  const targets = new Set<string>();
  const controls = unique(list(p.controls, LIMITS.controls, (v): Control => {
    const c = record(v, ['id', 'objectId', 'field', 'min', 'max', 'default']);
    const objectId = id(c.objectId), field = text(c.field, 32);
    const target = [...props, ...actions].find((o) => o.id === objectId);
    if (!target) throw new Error('Missing control target');
    const [lo, hi] = controlBounds(target, field);
    const min = number(c.min, lo, hi), max = number(c.max, min, hi), initial = number(c.default, min, max);
    if (Reflect.get(target, field) !== initial || targets.has(`${objectId}:${field}`)) throw new Error('Ambiguous control default');
    targets.add(`${objectId}:${field}`);
    return { id: id(c.id), objectId, field, min, max, default: initial };
  }));
  return { ...header(p), kind: 'part', partId: id(p.partId), author: address(p.author), source: parseSourcePin(p.source),
    reuseAllowed: p.reuseAllowed, bounds: b, props, actions, sockets, controls, connections: connections(p.connections, objects) };
}

export async function createPartVersion(value: unknown, resolveSource: SourceResolver): Promise<PartVersion> {
  const content = parsePart(value);
  // The resolver must read a trusted, hash-verified snapshot, never client-supplied traits.
  const resolved = await resolveSource(freezeDocument(structuredClone(content.source)));
  if (canonicalJson(parseSourcePin(resolved.pin)) !== canonicalJson(content.source)) throw new Error('Source snapshot mismatch');
  const metadata = parseMetadata(resolved.metadata, content.source.artworkNumber);
  if (metadata.image !== content.source.imageURI) throw new Error('Metadata image differs from source pin');
  const kit = compileKit(metadata);
  if (content.actions.some((a) => !kit.includes(a.type))) throw new Error('Action is not in source trait kit');
  const version = { id: await contentId(content), content };
  return freezeDocument(version);
}

export function parseScene(value: unknown): Scene {
  canonicalJson(value);
  const s = record(value, ['kind', 'schemaVersion', 'engineVersion', 'rulesVersion', 'machineId', 'author', 'seed', 'bounds', 'message', 'props', 'parts', 'connections', 'inputs']);
  if (s.kind !== 'machine') throw new Error('Expected machine');
  const b = bounds(s.bounds);
  if (b.width !== WORLD_WIDTH || b.height !== WORLD_HEIGHT) throw new Error('Unsupported stage bounds');
  const props = unique(list(s.props, LIMITS.props, (v) => prop(v, b)));
  const parts = unique(list(s.parts, LIMITS.parts, (v): PartInstance => {
    const p = record(v, ['id', 'versionId', 'x', 'y', 'values']);
    if (!p.values || typeof p.values !== 'object' || Array.isArray(p.values) || Object.keys(p.values).length > LIMITS.controls) throw new Error('Invalid exposed values');
    const values = Object.fromEntries(Object.entries(p.values).map(([key, v]) => [id(key), number(v, -1_000_000, 1_000_000)]));
    return { id: id(p.id), versionId: versionId(p.versionId), ...point(p, b), values };
  }));
  unique([...props, ...parts]);
  const parseEndpoint = (v: unknown) => { const c = record(v, ['from', 'to']); return { from: endpoint(c.from), to: endpoint(c.to) }; };
  const inputs = unique(list(s.inputs, LIMITS.inputs, (v) => {
    const input = record(v, ['id', 'tick', 'target']);
    return { id: id(input.id), tick: integer(input.tick, 0, MAX_TICKS - 1), target: endpoint(input.target) };
  })).sort((a, b) => a.tick - b.tick || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return freezeDocument({ ...header(s), kind: 'machine', machineId: id(s.machineId), author: address(s.author), seed: integer(s.seed, 0, 0xffff_ffff),
    bounds: b, message: text(s.message, 80), props, parts, connections: list(s.connections, LIMITS.connections, parseEndpoint), inputs });
}

export async function validateMachine(value: unknown, resolvePart: PartResolver, resolveSource: SourceResolver, purpose: 'draft' | 'publication' = 'draft') {
  if (purpose !== 'draft' && purpose !== 'publication') throw new Error('Invalid validation purpose');
  const scene = parseScene(value);
  const objects = new Map(scene.props.map((p) => [p.id, ports(p)]));
  const expanded: { instanceId: string; version: PartVersion; configured: PartContent }[] = [];
  let propCount = scene.props.length;
  let bodyCount = dynamicBodies(scene.props);
  let connectionCount = scene.connections.length;
  for (const instance of scene.parts) {
    const entry = await resolvePart(instance.versionId);
    if (entry.origin !== 'public-data-preview' && entry.origin !== 'holder-published') throw new Error('Unknown source origin');
    if (purpose === 'publication' && entry.origin !== 'holder-published') throw new Error('Preview parts cannot be published');
    const version = await createPartVersion(entry.version.content, resolveSource);
    if (version.id !== instance.versionId || entry.version.id !== version.id) throw new Error('Part content does not match pinned version');
    if (!version.content.reuseAllowed) throw new Error('Part version does not grant reuse');
    if (instance.x + version.content.bounds.width > scene.bounds.width || instance.y + version.content.bounds.height > scene.bounds.height) throw new Error('Part placement outside stage');
    const configured = structuredClone(version.content);
    for (const [key, value] of Object.entries(instance.values)) {
      const c = configured.controls.find((c) => c.id === key);
      if (!c) throw new Error('Unexposed override');
      const target = [...configured.props, ...configured.actions].find((o) => o.id === c.objectId)!;
      Reflect.set(target, c.field, number(value, c.min, c.max));
      c.default = value;
    }
    const effective = parsePart(configured);
    propCount += effective.props.length;
    bodyCount += dynamicBodies(effective.props);
    connectionCount += effective.connections.length;
    if (propCount > LIMITS.props || bodyCount > LIMITS.bodies || connectionCount > LIMITS.connections) throw new Error('Expanded machine budget exceeded');
    const p: Ports = { input: {}, output: {} };
    for (const socket of effective.sockets) p[socket.direction][socket.id] = socket.kind;
    objects.set(instance.id, p);
    expanded.push({ instanceId: instance.id, version, configured: effective });
  }
  if (propCount > LIMITS.props || bodyCount > LIMITS.bodies) throw new Error('Expanded machine budget exceeded');
  const connected = connections(scene.connections, objects);
  for (const input of scene.inputs) if (port(input.target, 'input', objects) !== 'event') throw new Error('Input requires an event socket');
  const chogEndpoint = (e: Endpoint) => {
    const part = expanded.find((p) => p.instanceId === e.objectId);
    const socket = part?.configured.sockets.find((s) => s.id === e.socket);
    return !!socket && part!.configured.actions.some((a) => a.id === socket.target.objectId);
  };
  if (purpose === 'publication' && !connected.some((c) => chogEndpoint(c.from) || chogEndpoint(c.to))) throw new Error('Publication requires a direct Chog socket connection');
  const content = { ...scene, connections: connected };
  return freezeDocument({ id: await contentId(content), scene: content, expanded, budgets: { props: propCount, dynamicBodies: bodyCount } });
}

function dynamicBodies(props: Prop[]): number {
  return props.reduce((sum, p) => sum + (p.type === 'ball' ? 1 : p.type === 'balloon' ? 12 : 0), 0);
}
