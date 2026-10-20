import { FIXED_STEP } from '../domain/fallingScene';

export class FixedStepClock {
  private accumulated = 0;

  consume(elapsedSeconds: number): number {
    if (!Number.isFinite(elapsedSeconds) || elapsedSeconds <= 0) return 0;
    // Discard excess wall time after stalls rather than freezing the UI to catch up.
    this.accumulated += Math.min(elapsedSeconds, FIXED_STEP * 6);
    const ticks = Math.floor((this.accumulated + 1e-10) / FIXED_STEP);
    this.accumulated = Math.max(0, this.accumulated - ticks * FIXED_STEP);
    return ticks;
  }

  reset(): void {
    this.accumulated = 0;
  }
}
