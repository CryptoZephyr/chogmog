import { expect, test } from 'vitest';
import { FIXED_STEP } from '../src/domain/fallingScene';
import { FixedStepClock } from '../src/game/fixedStepClock';

test.each([30, 60, 120, 144])('advances 60 fixed ticks per second at %i display Hz', (hz) => {
  const clock = new FixedStepClock();
  let ticks = 0;
  for (let frame = 0; frame < hz; frame++) ticks += clock.consume(1 / hz);
  expect(ticks).toBe(60);
});

test('caps catch-up work after a long stall', () => {
  const clock = new FixedStepClock();
  expect(clock.consume(20)).toBe(6);
  expect(clock.consume(FIXED_STEP)).toBe(1);
});

test('reset clears fractional elapsed time', () => {
  const clock = new FixedStepClock();
  expect(clock.consume(FIXED_STEP * 0.9)).toBe(0);
  clock.reset();
  expect(clock.consume(FIXED_STEP * 0.2)).toBe(0);
});

test('ignores invalid elapsed time without poisoning the clock', () => {
  const clock = new FixedStepClock();
  for (const value of [NaN, Infinity, -1, 0]) expect(clock.consume(value)).toBe(0);
  expect(clock.consume(FIXED_STEP)).toBe(1);
});
