import { getPreview } from '../domain/chog';
import type { ChainEvent, EventType } from '../game/chain';
import { abilityTone, colour, laserTone } from './tokens';

export interface StripPanel { key: string; word: string; caption: string; tone: string; count: number; stopped?: boolean }

const WORD: Record<EventType, string> = {
  released: 'DROP', sensor: 'CLICK', laser: 'ZAP', popped: 'POP!', lifted: 'WHOOSH',
  teleported: 'BLOOP', 'portal-blocked': 'BONK', lever: 'CLUNK', banner: 'TA-DA',
};

const chog = (token?: string) => (token ? `Chog #${getPreview(token).artworkNumber}` : 'A Chog');
const laserColour = (token?: string) =>
  (token && laserTone(getPreview(token).metadata.attributes.find((t) => t.trait_type === 'Eyes')?.value)?.deep) || colour.ink;

function caption(event: ChainEvent, count: number, message: string, laserToken?: string): Pick<StripPanel, 'caption' | 'tone'> {
  switch (event.type) {
    case 'released': return { caption: `${chog(event.sourceToken)} releases the ball.`, tone: colour.ink };
    case 'sensor': return { caption: 'The ball crosses the trigger.', tone: colour.ink };
    case 'laser': return { caption: `${chog(event.sourceToken)}'s laser eyes fire.`, tone: laserColour(event.sourceToken) };
    case 'popped': return { caption: 'The laser pops the balloon into confetti.', tone: laserColour(laserToken) };
    case 'lifted': return { caption: `${chog(event.sourceToken)}'s Fire aura lifts ${count === 1 ? 'a piece' : `${count} pieces`}.`, tone: abilityTone.lift.deep };
    case 'teleported': return { caption: `${chog(event.sourceToken)}'s Wizard hat portals ${count === 1 ? 'a piece' : `${count} pieces`} across.`, tone: abilityTone.portal.deep };
    case 'portal-blocked': return { caption: 'The portal exit is blocked.', tone: abilityTone.portal.deep };
    case 'lever': return { caption: 'Confetti tips the lever.', tone: colour.ink };
    case 'banner': return { caption: `The banner opens: "${message}"`, tone: colour.ink };
  }
}

/** One panel per kind of causal event, in first-occurrence order, ending on the stop panel if the chain stalled. */
export function comicStrip(events: readonly ChainEvent[], message: string, stopped: string | null): StripPanel[] {
  const counts = new Map<EventType, number>();
  for (const event of events) counts.set(event.type, (counts.get(event.type) ?? 0) + 1);
  const laserToken = events.find((e) => e.type === 'laser')?.sourceToken;
  const seen = new Set<EventType>();
  const panels: StripPanel[] = [];
  for (const event of events) {
    if (seen.has(event.type)) continue;
    if (event.type === 'portal-blocked' && counts.has('teleported')) continue;
    seen.add(event.type);
    const count = counts.get(event.type)!;
    panels.push({ key: event.type, word: WORD[event.type], count, ...caption(event, count, message, laserToken) });
  }
  if (stopped) panels.push({ key: 'stopped', word: 'STOP', caption: `The chain stops at the ${stopped}.`, tone: colour.ink, count: 0, stopped: true });
  return panels;
}
