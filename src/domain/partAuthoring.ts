import { compileKit, getPreview, parseMetadata, TRAIT_RULES_VERSION, type Metadata } from './chog';
import { createPartVersion, ENGINE_VERSION, parseSourcePin, previewSourcePin, type Action, type Control, type PartContent, type SourcePin } from './documents';

export const EDITABLE_ACTIONS = ['push', 'release', 'laser', 'lift', 'portal'] as const;
export type EditableAction = typeof EDITABLE_ACTIONS[number];
export interface PartSettings {
  partId: string; action: EditableAction; ballX: number; ballY: number; restitution: number;
  impulse: number; angle: number; acceleration: number; exitY: number; ramp: boolean;
  expose: boolean; reuseAllowed: boolean;
}
export function newPartSettings(): PartSettings {
  return { partId: `part-${crypto.randomUUID()}`, action: 'release', ballX: 2, ballY: 4.5,
    restitution: 0.5, impulse: 3, angle: 0, acceleration: 16, exitY: 4,
    ramp: false, expose: true, reuseAllowed: false };
}
export function parsePartSettings(value: unknown): PartSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid part settings');
  const s = value as PartSettings;
  if (Object.keys(s).sort().join(',') !== 'acceleration,action,angle,ballX,ballY,exitY,expose,impulse,partId,ramp,restitution,reuseAllowed' ||
      typeof s.partId !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(s.partId) || !EDITABLE_ACTIONS.includes(s.action) ||
      ['ramp', 'expose', 'reuseAllowed'].some((k) => typeof Reflect.get(s, k) !== 'boolean')) throw new Error('Invalid part settings');
  for (const [key, min, max] of [['ballX', 1, 3], ['ballY', 3, 5], ['restitution', 0, 0.95],
    ['impulse', 1, 8], ['angle', -0.6, 0.6], ['acceleration', 12, 24], ['exitY', 1, 5]] as const) {
    if (!Number.isFinite(s[key]) || s[key] < min || s[key] > max) throw new Error('Part setting outside bounds');
  }
  return { ...s };
}

export async function authoredPart(settings: PartSettings, author: string, source: { pin: SourcePin; metadata: Metadata }) {
  const s = parsePartSettings(settings);
  if (!compileKit(source.metadata).includes(s.action)) throw new Error('This Chog does not have that action');
  const action: Action = s.action === 'push' ? { id: 'chog', type: 'push', x: s.ballX - 0.4, y: 0.5, impulse: s.impulse, range: 1, angle: s.angle } :
    s.action === 'release' ? { id: 'chog', type: 'release', x: s.ballX, y: s.ballY, propId: 'ball' } :
      s.action === 'laser' ? { id: 'chog', type: 'laser', x: 1, y: 2, length: 5, angle: s.angle } :
        s.action === 'lift' ? { id: 'chog', type: 'lift', x: s.ballX, y: 2, width: 1.5, height: 3, acceleration: s.acceleration, maxSpeed: 5 } :
          { id: 'chog', type: 'portal', x: s.ballX, y: 1.7, exitX: 5, exitY: s.exitY, radius: 0.4, quarterTurns: 0, cooldownTicks: 30 };
  const control: Control = s.action === 'release' ? { id: 'bounce', objectId: 'ball', field: 'restitution', min: 0, max: 0.95, default: s.restitution } :
    s.action === 'push' ? { id: 'strength', objectId: 'chog', field: 'impulse', min: 1, max: 8, default: s.impulse } :
      s.action === 'lift' ? { id: 'lift-strength', objectId: 'chog', field: 'acceleration', min: 12, max: 24, default: s.acceleration } :
        { id: 'bounce', objectId: 'ball', field: 'restitution', min: 0, max: 0.95, default: s.restitution };
  if (s.action === 'laser') Object.assign(control, { id: 'aim', objectId: 'chog', field: 'angle', min: -0.6, max: 0.6, default: s.angle });
  const isBody = s.action === 'lift' || s.action === 'portal';
  const output = { push: 'pushed', release: 'released', laser: 'fired', lift: 'lifted', portal: 'teleported' }[s.action];
  const content: PartContent = {
    kind: 'part', schemaVersion: 1, engineVersion: ENGINE_VERSION, rulesVersion: TRAIT_RULES_VERSION,
    partId: s.partId, author, source: source.pin, reuseAllowed: s.reuseAllowed, bounds: { width: 6, height: 6 },
    props: s.action === 'laser' ? [{ id: 'balloon', type: 'balloon', x: 4, y: 2, radius: 0.4 }] :
      [{ id: 'ball', type: 'ball', x: s.ballX, y: s.action === 'push' ? 0.5 : s.action === 'lift' ? 1 : s.ballY, radius: 0.18, restitution: s.restitution },
        ...(s.ramp ? [{ id: 'ramp', type: 'ramp' as const, x: 3, y: 1, width: 2, height: 0.15, angle: -0.35 }] : [])],
    actions: [action],
    sockets: [{ id: 'in', direction: 'input', kind: isBody ? 'body' : 'event', target: { objectId: 'chog', socket: isBody ? 'body' : 'trigger' } },
      { id: 'out', direction: 'output', kind: s.action === 'laser' ? 'event' : 'body', target: { objectId: 'chog', socket: output } }],
    controls: s.expose ? [control] : [],
    connections: s.action === 'laser' ? [{ from: { objectId: 'chog', socket: 'fired' }, to: { objectId: 'balloon', socket: 'hit' } }] : [],
  };
  return createPartVersion(content, async () => source);
}

export const PART_DRAFT_KEY = 'chogmog.part-draft.v1';
export function loadPartSettings(storage: Pick<Storage, 'getItem'>): { settings: PartSettings; recovered: boolean } {
  try {
    const raw = storage.getItem(PART_DRAFT_KEY);
    return { settings: raw ? parsePartSettings(JSON.parse(raw)) : newPartSettings(), recovered: true };
  } catch { return { settings: newPartSettings(), recovered: false }; }
}
export function savePartSettings(storage: Pick<Storage, 'setItem'>, settings: PartSettings): boolean {
  try { storage.setItem(PART_DRAFT_KEY, JSON.stringify(parsePartSettings(settings))); return true; } catch { return false; }
}
export interface AuthoringSource { pin: SourcePin; metadata: Metadata }
export const PART_SOURCE_KEY = 'chogmog.part-source.v1';
export function loadPartSource(storage: Pick<Storage, 'getItem'>): AuthoringSource {
  try {
    const raw = storage.getItem(PART_SOURCE_KEY);
    if (raw) {
      const value = JSON.parse(raw) as AuthoringSource;
      const pin = parseSourcePin(value.pin);
      return { pin, metadata: parseMetadata(value.metadata, pin.artworkNumber) };
    }
  } catch { /* Local source snapshots carry no ownership authority. */ }
  return { pin: previewSourcePin('533'), metadata: getPreview('533').metadata };
}
export function savePartSource(storage: Pick<Storage, 'setItem'>, source: AuthoringSource): boolean {
  try { storage.setItem(PART_SOURCE_KEY, JSON.stringify(source)); return true; } catch { return false; }
}
