import { compileKit, getPreview, TRAIT_RULES_VERSION } from './chog';
import { ENGINE_VERSION, createPartVersion, parsePart, parseScene, parseSourcePin, previewSourcePin, resolvePreviewSource, validateMachine,
  type Action, type Control, type PartContent, type PartResolver, type PartVersion, type Scene } from './documents';
import { WORLD_HEIGHT, WORLD_WIDTH } from './fallingScene';
import { canonicalJson, contentId, MAX_DOCUMENT_BYTES } from './canonical';

export const MACHINE_DRAFT_KEY = 'chogmog.machine-draft.v1';
export const PREVIEW_PARTS_KEY = 'chogmog.preview-parts.v1';
export const PREVIEW_PART_LIMIT = 6;
export const PREVIEW_ACTIONS = ['release', 'laser', 'push', 'lift', 'portal', 'shout'] as const;
export type PreviewAction = typeof PREVIEW_ACTIONS[number];
export type Machine = Awaited<ReturnType<typeof validateMachine>>;
export interface DraftCatalog {
  resolvePart: PartResolver;
  resolveSource: typeof resolvePreviewSource;
  validate(scene: Scene, purpose?: 'draft' | 'publication'): Promise<Machine>;
}

const previewAuthor = '0x0000000000000000000000000000000000000001';

function previewContent(kind: PreviewAction): PartContent {
  const token = kind === 'laser' ? '533' : kind === 'lift' || kind === 'portal' || kind === 'shout' ? '846' : '533';
  const action: Action = kind === 'release' ? { id: 'chog', type: 'release', x: 1, y: 2.5, propId: 'ball' } :
    kind === 'laser' ? { id: 'chog', type: 'laser', x: 0.4, y: 1.5, length: 2.5, angle: 0 } :
      kind === 'push' ? { id: 'chog', type: 'push', x: 1, y: 1, impulse: 5, range: 1.5, angle: 0 } :
        kind === 'shout' ? { id: 'chog', type: 'shout', x: 1, y: 1, impulse: 5, range: 1.5 } :
        kind === 'lift' ? { id: 'chog', type: 'lift', x: 1.5, y: 1.4, width: 2, height: 2, acceleration: 18, maxSpeed: 6 } :
          { id: 'chog', type: 'portal', x: 0.6, y: 0.9, exitX: 2.1, exitY: 1.6, radius: 0.3, quarterTurns: 0, cooldownTicks: 30 };
  const isBody = kind === 'lift' || kind === 'portal';
  const output = kind === 'release' ? 'released' : kind === 'push' ? 'pushed' : kind === 'shout' ? 'shouted' :
    kind === 'laser' ? 'fired' : kind === 'lift' ? 'lifted' : 'teleported';
  const control: Control[] = kind === 'laser' ? [{ id: 'aim', objectId: 'chog', field: 'angle', min: -0.5, max: 0.5, default: 0 }] :
    kind === 'push' ? [{ id: 'impulse', objectId: 'chog', field: 'impulse', min: 0, max: 8, default: 5 }] :
      kind === 'shout' ? [{ id: 'impulse', objectId: 'chog', field: 'impulse', min: 0, max: 8, default: 5 }] :
      kind === 'lift' ? [{ id: 'strength', objectId: 'chog', field: 'acceleration', min: 0, max: 24, default: 18 }] : [];
  return {
    kind: 'part', schemaVersion: 1, engineVersion: ENGINE_VERSION, rulesVersion: TRAIT_RULES_VERSION,
    partId: `public-preview-${kind}`, author: previewAuthor, source: previewSourcePin(token), reuseAllowed: true,
    bounds: { width: 3, height: 3 },
    props: kind === 'release' ? [{ id: 'ball', type: 'ball', x: 1, y: 2.5, radius: 0.18, restitution: 0.5 }] :
      kind === 'laser' ? [{ id: 'balloon', type: 'balloon', x: 2.4, y: 1.5, radius: 0.3 }] : [],
    actions: [action],
    sockets: [
      { id: 'in', direction: 'input', kind: isBody ? 'body' : 'event', target: { objectId: 'chog', socket: isBody ? 'body' : 'trigger' } },
      { id: 'out', direction: 'output', kind: kind === 'laser' ? 'event' : 'body', target: { objectId: 'chog', socket: output } },
      ...(kind === 'laser' ? [
        { id: 'pop', direction: 'output' as const, kind: 'event' as const, target: { objectId: 'balloon', socket: 'popped' } },
        { id: 'confetti', direction: 'output' as const, kind: 'body' as const, target: { objectId: 'balloon', socket: 'confetti' } },
      ] : []),
    ],
    controls: control,
    connections: kind === 'laser' ? [{ from: { objectId: 'chog', socket: 'fired' }, to: { objectId: 'balloon', socket: 'hit' } }] : [],
  };
}

export class PreviewCatalog {
  readonly resolveSource = resolvePreviewSource;
  private readonly localParts = new Map<string, PartVersion>();
  private constructor(readonly entries: ReadonlyMap<PreviewAction, PartVersion>) {}
  static async create(): Promise<PreviewCatalog> {
    const entries = await Promise.all(PREVIEW_ACTIONS.map(async (kind) =>
      [kind, await createPartVersion(previewContent(kind), resolvePreviewSource)] as const));
    return new PreviewCatalog(new Map(entries));
  }
  get(kind: PreviewAction): PartVersion { return this.entries.get(kind)!; }
  get previewParts(): readonly PartVersion[] { return [...this.localParts.values()]; }
  async addLocalPreviewPart(value: unknown): Promise<PartVersion> {
    const version = await parsePreviewPart(value);
    if (!version) throw new Error('Invalid local preview part.');
    this.localParts.delete(version.id);
    this.localParts.set(version.id, version);
    if (this.localParts.size > PREVIEW_PART_LIMIT) this.localParts.delete(this.localParts.keys().next().value!);
    return version;
  }
  isPreview(id: string): boolean {
    return this.localParts.has(id) || [...this.entries.values()].some((version) => version.id === id);
  }
  readonly resolvePart: PartResolver = async (id) => {
    const version = [...this.entries.values()].find((v) => v.id === id) ?? this.localParts.get(id);
    if (!version) throw new Error('Only pinned public preview parts are available locally');
    return { version, origin: 'public-data-preview' };
  };
  validate(scene: Scene, purpose: 'draft' | 'publication' = 'draft'): Promise<Machine> { return validateMachine(scene, this.resolvePart, this.resolveSource, purpose); }
  source(kind: PreviewAction) { return getPreview(this.get(kind).content.source.nft.tokenId); }
}

export const PREVIEW_PART_AUTHOR = previewAuthor;

async function parsePreviewPart(value: unknown): Promise<PartVersion | null> {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const entry = value as Record<string, unknown>;
    if (Object.keys(entry).length !== 2 || typeof entry.id !== 'string' || !Object.hasOwn(entry, 'content')) return null;
    if (await contentId(entry.content) !== entry.id) return null;
    const content = parsePart(entry.content);
    if (content.author !== previewAuthor || content.reuseAllowed !== true) return null;
    const token = (['533', '846'] as const).find((id) => canonicalJson(parseSourcePin(content.source)) === canonicalJson(previewSourcePin(id)));
    if (!token || content.actions.some((action) => !compileKit(getPreview(token).metadata).includes(action.type))) return null;
    const version = await createPartVersion(content, resolvePreviewSource);
    return version.id === entry.id ? version : null;
  } catch { return null; }
}

export async function parsePreviewParts(value: unknown): Promise<PartVersion[]> {
  if (!Array.isArray(value)) return [];
  const entries: PartVersion[] = [];
  for (const item of value.slice(-PREVIEW_PART_LIMIT)) {
    const version = await parsePreviewPart(item);
    if (!version) continue;
    const existing = entries.findIndex((entry) => entry.id === version.id);
    if (existing >= 0) entries.splice(existing, 1);
    entries.push(version);
  }
  return entries.slice(-PREVIEW_PART_LIMIT);
}

export async function loadPreviewParts(storage: Pick<Storage, 'getItem'>): Promise<PartVersion[]> {
  try {
    const raw = storage.getItem(PREVIEW_PARTS_KEY);
    if (!raw || raw.length > MAX_DOCUMENT_BYTES * PREVIEW_PART_LIMIT) return [];
    return parsePreviewParts(JSON.parse(raw));
  } catch { return []; }
}

export async function savePreviewPart(storage: Pick<Storage, 'getItem' | 'setItem'>, value: unknown): Promise<boolean> {
  const version = await parsePreviewPart(value);
  if (!version) return false;
  try {
    const entries = (await loadPreviewParts(storage)).filter((entry) => entry.id !== version.id);
    const referenced = new Set<string>();
    const rawDraft = storage.getItem(MACHINE_DRAFT_KEY);
    if (rawDraft && rawDraft.length <= MAX_DOCUMENT_BYTES) {
      const draft = JSON.parse(rawDraft) as { parts?: unknown };
      if (Array.isArray(draft.parts)) for (const item of draft.parts) {
        if (item && typeof item === 'object' && !Array.isArray(item) && typeof Reflect.get(item, 'versionId') === 'string') {
          referenced.add(Reflect.get(item, 'versionId') as string);
        }
      }
    }
    if (entries.length >= PREVIEW_PART_LIMIT) {
      const replace = entries.findIndex((entry) => !referenced.has(entry.id));
      if (replace < 0) return false;
      entries.splice(replace, 1);
    }
    const next = [...entries, version];
    storage.setItem(PREVIEW_PARTS_KEY, JSON.stringify(next));
    return true;
  } catch { return false; }
}

export function newMachineDraft(catalog: Pick<PreviewCatalog, 'get'>): Scene {
  const release = catalog.get('release'), laser = catalog.get('laser');
  return parseScene({
    kind: 'machine', schemaVersion: 1, engineVersion: ENGINE_VERSION, rulesVersion: TRAIT_RULES_VERSION,
    machineId: `machine-${crypto.randomUUID()}`, author: previewAuthor, seed: 143,
    bounds: { width: WORLD_WIDTH, height: WORLD_HEIGHT }, message: 'Make mischief move!',
    props: [
      { id: 'sensor', type: 'sensor', x: 1, y: 4.4, width: 0.6, height: 0.3 },
      { id: 'lever', type: 'lever', x: 8, y: 3, width: 0.8, height: 0.3 },
      { id: 'banner', type: 'banner', x: 10, y: 5 },
    ],
    parts: [
      { id: 'release', versionId: release.id, x: 0, y: 4.5, values: {} },
      { id: 'laser', versionId: laser.id, x: 3, y: 2, values: {} },
    ],
    connections: [
      { from: { objectId: 'sensor', socket: 'triggered' }, to: { objectId: 'laser', socket: 'in' } },
      { from: { objectId: 'laser', socket: 'pop' }, to: { objectId: 'lever', socket: 'hit' } },
      { from: { objectId: 'lever', socket: 'activated' }, to: { objectId: 'banner', socket: 'open' } },
    ],
    inputs: [{ id: 'start', tick: 0, target: { objectId: 'release', socket: 'in' } }],
  });
}

export async function loadMachineDraft(storage: Pick<Storage, 'getItem'>, catalog: DraftCatalog & Pick<PreviewCatalog, 'get'>,
  fallback?: () => Scene, key = MACHINE_DRAFT_KEY): Promise<{ machine: Machine; recovered: boolean }> {
  const fresh = fallback ?? (() => newMachineDraft(catalog));
  try {
    const raw = storage.getItem(key);
    if (raw && raw.length > MAX_DOCUMENT_BYTES) throw new Error('Draft byte limit');
    if (raw) return { machine: await catalog.validate(parseScene(JSON.parse(raw))), recovered: true };
    return { machine: await catalog.validate(fresh()), recovered: true };
  } catch {
    return { machine: await catalog.validate(fresh()), recovered: false };
  }
}

export async function saveMachineDraft(storage: Pick<Storage, 'setItem'>, catalog: DraftCatalog, scene: Scene, key = MACHINE_DRAFT_KEY): Promise<boolean> {
  try {
    const { scene: valid } = await catalog.validate(scene);
    storage.setItem(key, JSON.stringify(valid));
    return true;
  } catch { return false; }
}

export async function addPreviewPartToDraft(storage: Pick<Storage, 'getItem' | 'setItem'>,
  catalog: DraftCatalog & Pick<PreviewCatalog, 'get' | 'addLocalPreviewPart'>, value: unknown): Promise<{ ok: boolean; message: string }> {
  const loaded = await loadMachineDraft(storage, catalog);
  if (!loaded.recovered) return { ok: false, message: 'The saved Build draft could not be verified, so it was left unchanged.' };
  const scene = structuredClone(loaded.machine.scene);
  if (scene.parts.length >= PREVIEW_PART_LIMIT) return { ok: false, message: 'Your Build draft already has six parts. Remove one in Build before adding this preview part.' };
  const version = await catalog.addLocalPreviewPart(value);
  const occupied = loaded.machine.expanded.map((part) => {
    const instance = scene.parts.find((item) => item.id === part.instanceId)!;
    return { x: instance.x, y: instance.y, width: part.configured.bounds.width, height: part.configured.bounds.height };
  });
  const bounds = version.content.bounds;
  let position: { x: number; y: number } | undefined;
  for (let y = 0; y + bounds.height <= scene.bounds.height && !position; y += 0.5) {
    for (let x = 0; x + bounds.width <= scene.bounds.width; x += 0.5) {
      if (occupied.every((other) => x + bounds.width <= other.x || other.x + other.width <= x ||
          y + bounds.height <= other.y || other.y + other.height <= y)) {
        position = { x, y };
        break;
      }
    }
  }
  if (!position) return { ok: false, message: 'There is no free spot for this preview part in your Build draft.' };
  const used = new Set([...scene.props.map((item) => item.id), ...scene.parts.map((item) => item.id), ...scene.inputs.map((item) => item.id)]);
  let suffix = 1;
  while (used.has(`preview-part-${suffix}`)) suffix++;
  scene.parts.push({ id: `preview-part-${suffix}`, versionId: version.id, ...position, values: {} });
  const valid = await catalog.validate(scene);
  if (!await saveMachineDraft(storage, catalog, valid.scene)) return { ok: false, message: 'The preview part was saved locally, but the Build draft could not be saved.' };
  return { ok: true, message: 'Preview part added to your Build draft.' };
}
