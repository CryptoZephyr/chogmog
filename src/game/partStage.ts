import type { PartVersion } from '../domain/documents';
import { MAX_TICKS } from '../domain/fallingScene';
import { FixedStepClock } from './fixedStepClock';
import { PartPreview, type PartSnapshot } from './partPreview';
import { colour, loadFonts } from '../ui/tokens';
import { beam, board, inkCircle, laserFor, liftColumn, plank, portalRing, tag } from './canvasArt';

export interface PartStage {
  run(): void; pause(): void; reset(): void; dispose(): void;
}
export async function createPartStage(canvas: HTMLCanvasElement, version: PartVersion, signal: AbortSignal,
  notify: (snapshot: PartSnapshot, running: boolean) => void): Promise<PartStage> {
  const [simulation] = await Promise.all([PartPreview.create(version), loadFonts()]);
  if (signal.aborted) { simulation.dispose(); throw new DOMException('Cancelled', 'AbortError'); }
  const ctx = canvas.getContext('2d');
  if (!ctx) { simulation.dispose(); throw new Error('Canvas unavailable'); }
  const clock = new FixedStepClock();
  let running = false, disposed = false, frame = 0, previous = 0;
  const scale = 90, y = (n: number) => 540 - n * scale;
  const tone = laserFor(version.content.source.nft.tokenId);
  const draw = (s: PartSnapshot) => {
    board(ctx, 540, 540, scale, y(0.2));
    const a = version.content.actions[0];
    if (a.type === 'lift') liftColumn(ctx, (a.x - a.width / 2) * scale, y(a.y + a.height / 2), a.width * scale, a.height * scale);
    if (a.type === 'portal') { portalRing(ctx, a.x * scale, y(a.y), a.radius * scale); portalRing(ctx, a.exitX * scale, y(a.exitY), a.radius * scale); }
    for (const p of version.content.props) {
      if (p.type === 'balloon' && !s.balloonPopped) inkCircle(ctx, p.x * scale, y(p.y), p.radius * scale);
      if (p.type === 'ramp') plank(ctx, p.x * scale, y(p.y), p.width * scale, p.height * scale, p.angle);
    }
    if (s.ray && s.tick < 45) beam(ctx, a.x * scale, y(a.y), s.ray.x * scale, y(s.ray.y), tone.bright);
    for (const b of s.bodies) inkCircle(ctx, b.x * scale, y(b.y), b.radius * scale, '#FFFFFF', colour.ink, b.radius > 0.1 ? 3 : 1.5);
    tag(ctx, `Chog token ${version.content.source.nft.tokenId}: ${a.type}`, 12, 12, 15);
  };
  const publish = () => { const s = simulation.snapshot(); draw(s); notify(s, running); };
  const pause = () => { if (disposed) return; running = false; cancelAnimationFrame(frame); clock.reset(); publish(); };
  const loop = (time: number) => {
    if (disposed || !running) return;
    const s = simulation.step(clock.consume((time - previous) / 1000)); previous = time; draw(s);
    if (s.tick >= MAX_TICKS) { pause(); return; }
    if (s.tick % 6 === 0) notify(s, running);
    frame = requestAnimationFrame(loop);
  };
  const hidden = () => { if (document.hidden) pause(); };
  document.addEventListener('visibilitychange', hidden);
  publish();
  return {
    run() { if (disposed || running || simulation.snapshot().tick >= MAX_TICKS) return; running = true; previous = performance.now(); clock.reset(); publish(); frame = requestAnimationFrame(loop); },
    pause, reset() { if (disposed) return; simulation.reset(); pause(); },
    dispose() { if (disposed) return; disposed = true; cancelAnimationFrame(frame); document.removeEventListener('visibilitychange', hidden); simulation.dispose(); },
  };
}
