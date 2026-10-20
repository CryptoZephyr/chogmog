import { describe, expect, it } from 'vitest';
import type { ChainEvent } from '../src/game/chain';
import { activeWords, BOB_TICKS, bobOffset, pathPrefix, pulseProgress, PULSE_TICKS, SHAKE_TICKS, shakeOffset, WORD_TICKS, wireSpent } from '../src/game/stageFx';

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

  it('bobs a Chog once per power kind it fires, never past 4px', () => {
    const events: ChainEvent[] = [{ ...event(40, 'laser'), sourceToken: '533' }, { ...event(60, 'lifted'), sourceToken: '846' }, { ...event(62, 'lifted'), sourceToken: '846' }];
    expect(bobOffset(events, '533', 39)).toBe(0);
    expect(bobOffset(events, '533', 45)).toBeGreaterThan(3);
    expect(bobOffset(events, '533', 40 + BOB_TICKS)).toBe(0);
    expect(bobOffset(events, '846', 60 + BOB_TICKS)).toBe(0);
    for (let tick = 0; tick < 100; tick++) expect(bobOffset(events, '846', tick)).toBeLessThanOrEqual(4);
  });

  it('shakes the stage only for a short decaying window after the first pop', () => {
    const events = [event(50, 'popped'), event(70, 'popped')];
    expect(shakeOffset(events, 49)).toEqual([0, 0]);
    expect(Math.abs(shakeOffset(events, 50)[0])).toBe(4);
    expect(Math.abs(shakeOffset(events, 54)[0])).toBeLessThan(4);
    expect(shakeOffset(events, 50 + SHAKE_TICKS)).toEqual([0, 0]);
    expect(shakeOffset(events, 70)).toEqual([0, 0]);
  });

  it('keeps a wire tinted once its pulse has passed', () => {
    const events = [event(40, 'sensor')];
    expect(wireSpent(events, 'sensor', 40 + PULSE_TICKS - 1)).toBe(false);
    expect(wireSpent(events, 'sensor', 40 + PULSE_TICKS)).toBe(true);
    expect(wireSpent(events, 'lever', 500)).toBe(false);
  });
});
