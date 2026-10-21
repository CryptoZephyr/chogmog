import type { Scene } from '../domain/documents';
import { MAX_TICKS, WORLD_HEIGHT, WORLD_WIDTH } from '../domain/fallingScene';
import type { DraftCatalog } from '../domain/machineDraft';
import { FixedStepClock } from './fixedStepClock';
import { MachinePreview, type MachineSnapshot } from './machinePreview';
import { colour, loadFonts } from '../ui/tokens';
import { beam, board, displayFont, inkCircle, laserFor, liftColumn, plank, plate, portalRing, tag, uiFont } from './canvasArt';

export interface MachineStage {
  run(): void; pause(): void; reset(): void; dispose(): void;
}

export async function createMachineStage(canvas: HTMLCanvasElement, scene: Scene, catalog: DraftCatalog, signal: AbortSignal,
  notify: (snapshot: MachineSnapshot, running: boolean) => void): Promise<MachineStage> {
  const [simulation] = await Promise.all([MachinePreview.create(scene, catalog.resolvePart, catalog.resolveSource), loadFonts()]);
  if (signal.aborted) { simulation.dispose(); throw new DOMException('Cancelled', 'AbortError'); }
  const ctx = canvas.getContext('2d');
  if (!ctx) { simulation.dispose(); throw new Error('Canvas unavailable'); }
  const clock = new FixedStepClock();
  let running = false, disposed = false, frame = 0, previous = 0;
  const scale = canvas.width / WORLD_WIDTH, y = (n: number) => (WORLD_HEIGHT - n) * scale;
  const unit = scale;
  const laserTones = new Map(simulation.machine.expanded.map((p) => [p.instanceId, laserFor(p.version.content.source.nft.tokenId)]));
  const laserTone = [...laserTones.values()][0] ?? laserFor(undefined);
  const draw = (snapshot: MachineSnapshot) => {
    board(ctx, canvas.width, canvas.height, unit, y(0.2));
    for (const part of scene.parts) {
      const content = simulation.machine.expanded.find((p) => p.instanceId === part.id)!.configured;
      ctx.setLineDash([6, 5]); ctx.strokeStyle = colour.line; ctx.lineWidth = 2;
      ctx.strokeRect(part.x * scale, y(part.y + content.bounds.height), content.bounds.width * scale, content.bounds.height * scale);
      ctx.setLineDash([]);
      tag(ctx, `${part.id}: ${content.actions.map((a) => a.type).join(', ')}`, part.x * scale + 4, y(part.y + content.bounds.height) + 4, 13);
    }
    for (const node of simulation.nodes.values()) {
      if (node.type === 'lift') liftColumn(ctx, (node.x - node.width / 2) * scale, y(node.y + node.height / 2), node.width * scale, node.height * scale);
      if (node.type === 'portal') { portalRing(ctx, node.x * scale, y(node.y), node.radius * scale); portalRing(ctx, node.exitX * scale, y(node.exitY), node.radius * scale); }
      if (node.type === 'shout') {
        inkCircle(ctx, node.x * scale, y(node.y), node.range * scale, 'transparent', colour.ink, 2);
        inkCircle(ctx, node.x * scale, y(node.y), node.range * scale * 0.68, 'transparent', colour.ink, 2);
      }
      if (node.type === 'ramp') plank(ctx, node.x * scale, y(node.y), node.width * scale, node.height * scale, node.angle);
      if (node.type === 'sensor') plate(ctx, (node.x - node.width / 2) * scale, y(node.y + node.height / 2), node.width * scale, node.height * scale);
      if (node.type === 'lever') plank(ctx, node.x * scale, y(node.y), node.width * scale, node.height * scale, snapshot.bannerOpen ? 0.26 : -0.26);
      if (node.type === 'balloon' && !snapshot.popped.includes(node.id)) inkCircle(ctx, node.x * scale, y(node.y), node.radius * scale);
      if (node.type === 'banner') {
        ctx.fillStyle = colour.ink; ctx.textAlign = 'center';
        ctx.font = snapshot.bannerOpen ? displayFont(26) : uiFont(13);
        ctx.fillText(snapshot.bannerOpen ? scene.message : 'Message closed', node.x * scale, y(node.y));
        ctx.textAlign = 'start';
      }
    }
    for (const ray of snapshot.rays.filter((ray) => snapshot.tick - ray.tick < 50)) beam(ctx, ray.x * scale, y(ray.y), ray.toX * scale, y(ray.toY), laserTone.bright);
    for (const body of snapshot.bodies) inkCircle(ctx, body.x * scale, y(body.y), body.radius * scale, '#FFFFFF', colour.ink, body.radius > 0.1 ? 3 : 1.5);
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
