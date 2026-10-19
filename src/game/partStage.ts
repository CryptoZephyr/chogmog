import type { PartVersion } from '../domain/documents';
import { MAX_TICKS } from '../domain/fallingScene';
import { FixedStepClock } from './fixedStepClock';
import { PartPreview, type PartSnapshot } from './partPreview';

export interface PartStage {
  run(): void; pause(): void; reset(): void; dispose(): void;
}
export async function createPartStage(canvas: HTMLCanvasElement, version: PartVersion, signal: AbortSignal,
  notify: (snapshot: PartSnapshot, running: boolean) => void): Promise<PartStage> {
  const simulation = await PartPreview.create(version);
  if (signal.aborted) { simulation.dispose(); throw new DOMException('Cancelled', 'AbortError'); }
  const ctx = canvas.getContext('2d');
  if (!ctx) { simulation.dispose(); throw new Error('Canvas unavailable'); }
  const clock = new FixedStepClock();
  let running = false, disposed = false, frame = 0, previous = 0;
  const scale = 90, y = (n: number) => 540 - n * scale;
  const circle = (x: number, worldY: number, radius: number, color: string) => {
    ctx.beginPath(); ctx.arc(x * scale, y(worldY), radius * scale, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill();
  };
  const draw = (s: PartSnapshot) => {
    ctx.clearRect(0, 0, 540, 540); ctx.fillStyle = '#999'; ctx.fillRect(0, y(0.2), 540, 18);
    for (const p of version.content.props) {
      if (p.type === 'balloon' && !s.balloonPopped) circle(p.x, p.y, p.radius, '#999');
      if (p.type === 'ramp') {
        ctx.save(); ctx.translate(p.x * scale, y(p.y)); ctx.rotate(-p.angle); ctx.fillStyle = '#666'; ctx.fillRect(-p.width * scale / 2, -p.height * scale / 2, p.width * scale, p.height * scale); ctx.restore();
      }
    }
    const a = version.content.actions[0];
    ctx.strokeStyle = '#666'; ctx.lineWidth = 2;
    if (a.type === 'lift') ctx.strokeRect((a.x - a.width / 2) * scale, y(a.y + a.height / 2), a.width * scale, a.height * scale);
    if (a.type === 'portal') { circle(a.x, a.y, a.radius, '#aab'); circle(a.exitX, a.exitY, a.radius, '#aab'); }
    if (s.ray && s.tick < 45) { ctx.beginPath(); ctx.moveTo(a.x * scale, y(a.y)); ctx.lineTo(s.ray.x * scale, y(s.ray.y)); ctx.stroke(); }
    for (const b of s.bodies) circle(b.x, b.y, b.radius, '#222');
    ctx.fillStyle = '#222'; ctx.font = '14px system-ui'; ctx.fillText(`Token ${version.content.source.nft.tokenId}: ${a.type}`, 12, 22);
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
