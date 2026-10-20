import { describe, expect, it } from 'vitest';
import { comicStrip } from '../src/ui/comicStrip';
import type { ChainEvent } from '../src/game/chain';
import { abilityTone, colour } from '../src/ui/tokens';

const events: ChainEvent[] = [
  { tick: 0, type: 'released', actor: 'token-533', target: 'ball', sourceToken: '533' },
  { tick: 40, type: 'sensor', actor: 'ball', target: 'laser-input' },
  { tick: 40, type: 'laser', actor: 'laser', target: 'ray', sourceToken: '533' },
  { tick: 41, type: 'popped', actor: 'balloon', target: 'confetti' },
  { tick: 60, type: 'lifted', actor: 'lift', target: 'confetti-0', sourceToken: '846' },
  { tick: 61, type: 'lifted', actor: 'lift', target: 'confetti-1', sourceToken: '846' },
];

describe('comicStrip', () => {
  it('collapses repeated events into one panel per kind in causal order', () => {
    const panels = comicStrip(events, 'gm', null);
    expect(panels.map((p) => p.word)).toEqual(['DROP', 'CLICK', 'ZAP', 'POP!', 'WHOOSH']);
    expect(panels[4]).toMatchObject({ count: 2, tone: abilityTone.lift.deep, caption: "Chog #338's Fire aura lifts 2 pieces." });
  });

  it('colours trait steps only and gives the pop the laser colour that moved it', () => {
    const [drop, click, zap, pop] = comicStrip(events, 'gm', null);
    expect(drop.tone).toBe(colour.ink);
    expect(click.tone).toBe(colour.ink);
    expect(zap.tone).not.toBe(colour.ink);
    expect(pop.tone).toBe(zap.tone);
  });

  it('ends a stalled chain on a stop panel', () => {
    const panels = comicStrip(events.slice(0, 4), 'gm', 'lift');
    expect(panels.at(-1)).toMatchObject({ stopped: true, caption: 'The chain stops at the lift.' });
  });

  it('drops portal-blocked noise once the portal has worked', () => {
    const portal: ChainEvent[] = [
      { tick: 90, type: 'teleported', actor: 'portal', target: 'confetti-0', sourceToken: '846' },
      { tick: 91, type: 'portal-blocked', actor: 'confetti-1', target: 'portal-exit', sourceToken: '846' },
    ];
    expect(comicStrip(portal, 'gm', null).map((p) => p.word)).toEqual(['BLOOP']);
    expect(comicStrip(portal.slice(1), 'gm', 'portal').map((p) => p.word)).toEqual(['BONK', 'STOP']);
  });

  it('quotes the banner message', () => {
    expect(comicStrip([{ tick: 300, type: 'banner', actor: 'lever', target: 'message' }], 'hello', null)[0].caption).toBe('The banner opens: "hello"');
  });
});
