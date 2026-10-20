import { describe, expect, it } from 'vitest';
import type { ChainEvent } from '../src/game/chain';
import { activeWords, pathPrefix, pulseProgress, PULSE_TICKS, WORD_TICKS } from '../src/game/stageFx';

const event = (tick: number, type: ChainEvent['type'], target = 'x'): ChainEvent => ({ tick, type, actor: 'a', target });

describe('stage effects', () => {
  it('shows one sound word per event kind for a bounded time after its first occurrence', () => {
    const events = [event(0, 'released'), event(40, 'sensor'), event(41, 'laser'), event(60, 'lifted', 'c1'), event(70, 'lifted', 'c2')];
    expect(activeWords(events, 45).map((w) => w.type)).toEqual(['sensor', 'laser']);
    expect(activeWords(events, 80)).toEqual([{ type: 'lifted', age: 20 }]);
    expect(activeWords(events, 60 + WORD_TICKS)).toEqual([]);
  });

  it('leaves the banner word to the banner itself', () => {
    expect(activeWords([event(300, 'lever'), event(300, 'banner')], 301).map((w) => w.type)).toEqual(['lever']);
  });

  it('runs a signal pulse from the first event to the end of its wire', () => {
    const events = [event(40, 'sensor')];
    expect(pulseProgress(events, 'sensor', 39)).toBeNull();
    expect(pulseProgress(events, 'sensor', 40)).toBeCloseTo(1 / PULSE_TICKS);
    expect(pulseProgress(events, 'sensor', 40 + PULSE_TICKS - 1)).toBe(1);
    expect(pulseProgress(events, 'sensor', 40 + PULSE_TICKS)).toBeNull();
    expect(pulseProgress(events, 'lever', 45)).toBeNull();
  });

  it('cuts a polyline at a fraction of its length', () => {
    const wire = [[0, 0], [2, 0], [2, 2]] as const;
    expect(pathPrefix(wire, 0)).toEqual([[0, 0], [0, 0]]);
    expect(pathPrefix(wire, 0.25)).toEqual([[0, 0], [1, 0]]);
    expect(pathPrefix(wire, 0.75)).toEqual([[0, 0], [2, 0], [2, 1]]);
    expect(pathPrefix(wire, 1)).toEqual([[0, 0], [2, 0], [2, 2]]);
    expect(pathPrefix(wire, 3)).toEqual([[0, 0], [2, 0], [2, 2]]);
  });
});
