import type { ChainEvent, EventType } from './chain';

export const SOUND_WORD: Record<EventType, string> = {
  released: 'DROP',
  sensor: 'CLICK',
  laser: 'ZAP',
  popped: 'POP!',
  lifted: 'WHOOSH',
  teleported: 'BLOOP',
  'portal-blocked': 'BONK',
  lever: 'CLUNK',
  banner: 'TA-DA',
};
export const WORD_TICKS = 36;
export const PULSE_TICKS = 12;

export type Point = readonly [number, number];

export function firstTick(events: readonly ChainEvent[], type: EventType): number | undefined {
  return events.find((event) => event.type === type)?.tick;
}

/** Sound words on stage: the first event of each kind, for WORD_TICKS after it happens. */
export function activeWords(events: readonly ChainEvent[], tick: number): { type: EventType; age: number }[] {
  const first = new Map<EventType, number>();
  for (const event of events) if (!first.has(event.type)) first.set(event.type, event.tick);
  return [...first]
    .map(([type, at]) => ({ type, age: tick - at }))
    .filter(({ type, age }) => type !== 'banner' && age >= 0 && age < WORD_TICKS);
}

/** How far a signal pulse has travelled along its wire, from 0 to 1, or null when no pulse is live. */
export function pulseProgress(events: readonly ChainEvent[], type: EventType, tick: number): number | null {
  const at = firstTick(events, type);
  if (at === undefined) return null;
  const age = tick - at;
  return age >= 0 && age < PULSE_TICKS ? (age + 1) / PULSE_TICKS : null;
}

/** The part of a polyline from its start to fraction t of its length. The last point is the pulse head. */
export function pathPrefix(points: readonly Point[], t: number): Point[] {
  const clamped = Math.min(1, Math.max(0, t));
  const lengths = points.slice(1).map((point, i) => Math.hypot(point[0] - points[i][0], point[1] - points[i][1]));
  let remaining = clamped * lengths.reduce((sum, length) => sum + length, 0);
  const prefix: Point[] = [points[0]];
  for (let i = 0; i < lengths.length; i++) {
    const [ax, ay] = points[i], [bx, by] = points[i + 1];
    if (remaining >= lengths[i]) { prefix.push(points[i + 1]); remaining -= lengths[i]; continue; }
    const f = lengths[i] === 0 ? 0 : remaining / lengths[i];
    prefix.push([ax + (bx - ax) * f, ay + (by - ay) * f]);
    break;
  }
  return prefix;
}
