import type { Scene } from '../domain/documents';
import { resolvePreviewSource } from '../domain/documents';
import { MAX_TICKS, WORLD_HEIGHT, WORLD_WIDTH } from '../domain/fallingScene';
import type { PreviewCatalog } from '../domain/machineDraft';
import { FixedStepClock } from './fixedStepClock';
import { MachinePreview, type MachineSnapshot } from './machinePreview';

export interface MachineStage {
  run(): void; pause(): void; reset(): void; dispose(): void;
}

export async function createMachineStage(canvas: HTMLCanvasElement, scene: Scene, catalog: PreviewCatalog, signal: AbortSignal,
  notify: (snapshot: MachineSnapshot, running: boolean) => void): Promise<MachineStage> {
  const simulation = await MachinePreview.create(scene, catalog.resolvePart, resolvePreviewSource);
  if (signal.aborted) { simulation.dispose(); throw new DOMException('Cancelled', 'AbortError'); }
  const ctx = canvas.getContext('2d');
  if (!ctx) { simulation.dispose(); throw new Error('Canvas unavailable'); }
  const clock = new FixedStepClock();
  let running = false, disposed = false, frame = 0, previous = 0;
  const scale = canvas.width / WORLD_WIDTH, y = (n: number) => (WORLD_HEIGHT - n) * scale;
  const circle = (x: number, valueY: number, radius: number, color: string) => {
    ctx.beginPath(); ctx.arc(x * scale, y(valueY), radius * scale, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill();
  };
  const draw = (snapshot: MachineSnapshot) => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#aaa'; ctx.fillRect(0, y(0.2), canvas.width, 12);
    for (const part of scene.parts) {
      const content = simulation.machine.expanded.find((p) => p.instanceId === part.id)!.configured;
      ctx.strokeStyle = '#888';
      ctx.strokeRect(part.x * scale, y(part.y + content.bounds.height), content.bounds.width * scale, content.bounds.height * scale);
      ctx.fillStyle = '#222'; ctx.font = '11px system-ui';
      ctx.fillText(`${part.id}: ${content.actions.map((a) => a.type).join(', ')}`, part.x * scale + 3, y(part.y + content.bounds.height) + 13);
    }
    for (const node of simulation.nodes.values()) {
      if (node.type === 'balloon' && !snapshot.popped.includes(node.id)) circle(node.x, node.y, node.radius, '#888');
      if (node.type === 'ramp') {
        ctx.save(); ctx.translate(node.x * scale, y(node.y)); ctx.rotate(-node.angle);
        ctx.fillStyle = '#777'; ctx.fillRect(-node.width * scale / 2, -node.height * scale / 2, node.width * scale, node.height * scale); ctx.restore();
      }
      if (node.type === 'sensor' || node.type === 'lever') {
        ctx.strokeStyle = node.type === 'sensor' ? '#555' : '#777';
        ctx.strokeRect((node.x - node.width / 2) * scale, y(node.y + node.height / 2), node.width * scale, node.height * scale);
      }
      if (node.type === 'lift') {
        ctx.strokeStyle = '#777';
        ctx.strokeRect((node.x - node.width / 2) * scale, y(node.y + node.height / 2), node.width * scale, node.height * scale);
      }
      if (node.type === 'portal') { circle(node.x, node.y, node.radius, '#aaa'); circle(node.exitX, node.exitY, node.radius, '#aaa'); }
      if (node.type === 'banner') {
        ctx.fillStyle = '#444'; ctx.font = '13px system-ui';
        ctx.fillText(snapshot.bannerOpen ? scene.message : 'Message closed', node.x * scale - 65, y(node.y));
      }
    }
    ctx.strokeStyle = '#444'; ctx.lineWidth = 2;
    if (snapshot.tick < 50) for (const ray of snapshot.rays) {
      ctx.beginPath(); ctx.moveTo(ray.x * scale, y(ray.y)); ctx.lineTo(ray.toX * scale, y(ray.toY)); ctx.stroke();
    }
    for (const body of snapshot.bodies) circle(body.x, body.y, body.radius, '#222');
  };
  const publish = () => { const snapshot = simulation.snapshot(); draw(snapshot); notify(snapshot, running); };
  const pause = () => { if (disposed) return; running = false; cancelAnimationFrame(frame); clock.reset(); publish(); };
  const loop = (time: number) => {
    if (disposed || !running) return;
    const snapshot = simulation.step(clock.consume((time - previous) / 1000)); previous = time; draw(snapshot);
    if (snapshot.tick >= MAX_TICKS) { pause(); return; }
    if (snapshot.tick % 6 === 0) notify(snapshot, running);
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
