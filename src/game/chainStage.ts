import { Application, Graphics, Sprite, Text, Texture } from 'pixi.js';
import { getPreview, PREVIEWS } from '../domain/chog';
import { loadArtwork } from '../domain/artwork';
import type { ChainScene } from '../domain/chainScene';
import { MAX_TICKS, WORLD_HEIGHT } from '../domain/fallingScene';
import { ChainSimulation, GEOMETRY, type ChainSnapshot } from './chain';
import { FixedStepClock } from './fixedStepClock';

export interface ChainView {
  snapshot: ChainSnapshot;
  running: boolean;
  artwork: Record<string, 'loading' | 'ready' | 'unavailable'>;
}
export interface ChainStage {
  run(): void;
  pause(): void;
  reset(scene: ChainScene): void;
  dispose(): void;
}

export async function createChainStage(host: HTMLElement, initial: ChainScene, signal: AbortSignal, notify: (view: ChainView) => void): Promise<ChainStage> {
  const simulation = await ChainSimulation.create(initial);
  if (signal.aborted) { simulation.dispose(); throw new DOMException('Cancelled', 'AbortError'); }
  const app = new Application();
  try {
    await app.init({ width: 960, height: 640, background: 0xffffff, antialias: true,
      autoStart: false, preference: 'webgl', resolution: Math.min(globalThis.devicePixelRatio || 1, 2), autoDensity: true });
  } catch (error) {
    simulation.dispose();
    if (app.renderer) app.destroy(true, { children: true });
    throw error;
  }
  if (signal.aborted) {
    simulation.dispose(); app.destroy(true, { children: true });
    throw new DOMException('Cancelled', 'AbortError');
  }
  const scale = 80;
  const y = (worldY: number) => (WORLD_HEIGHT - worldY) * scale;
  const geometry = new Graphics();
  const particles = new Graphics();
  const ray = new Graphics();
  app.stage.addChild(geometry, particles, ray);
  const label = (text: string, x: number, worldY: number) => {
    const item = new Text({ text, style: { fontFamily: 'system-ui', fontSize: 14, fill: 0x333333 } });
    item.position.set(x * scale, y(worldY));
    app.stage.addChild(item);
    return item;
  };
  label('Ball release', 0.5, 7.4);
  label('Input sensor', 0.5, 2.3);
  label('Balloon', 5.5, 3.2);
  label('Lift region', 5.8, 4.5);
  label('Portal entrance', 3.2, 6.6);
  label('Portal exit', 7.6, 6.6);
  label('Lever', 9.5, 2.2);
  const banner = new Text({ text: initial.message, style: { fontFamily: 'system-ui', fontSize: 22, fill: 0x222222, wordWrap: true, wordWrapWidth: 580 } });
  banner.position.set(280, 60);
  app.stage.addChild(banner);
  const artwork: ChainView['artwork'] = Object.fromEntries(PREVIEWS.map((p) => [p.tokenId, 'loading']));
  const textures = new Map<string, { texture: Texture; bitmap: ImageBitmap }>();
  const slots = [
    { field: 'laserToken' as const, x: 1.2, worldY: 1.2 },
    { field: 'liftToken' as const, x: 4.8, worldY: 1.2 },
    { field: 'portalToken' as const, x: 6.7, worldY: 6.1 },
  ].map((part) => {
    const sprite = new Sprite();
    sprite.width = 64; sprite.height = 64;
    sprite.position.set(part.x * scale, y(part.worldY));
    sprite.visible = false;
    app.stage.addChild(sprite);
    const caption = label('', part.x, part.worldY - 0.85);
    return { ...part, sprite, caption };
  });
  app.canvas.setAttribute('role', 'img');
  app.canvas.setAttribute('aria-label', 'Preview chain: ball, laser, balloon, lift, portal and lever. Tick-level events are listed below.');
  host.appendChild(app.canvas);
  const clock = new FixedStepClock();
  let scene = initial;
  let running = false;
  let disposed = false;
  const publish = () => notify({ snapshot: simulation.snapshot(), running, artwork: { ...artwork } });
  const draw = () => {
    const snapshot = simulation.snapshot();
    const g = GEOMETRY;
    geometry.clear().rect(0, y(0.4), 960, 32).fill(0x999999);
    geometry.rect((g.sensor.x - g.sensor.halfWidth) * scale, y(g.sensor.y + g.sensor.halfHeight), g.sensor.halfWidth * 2 * scale, g.sensor.halfHeight * 2 * scale).stroke({ color: 0x333333, width: 2 });
    geometry.moveTo(g.sensor.x * scale, y(g.sensor.y)).lineTo(g.laser.x * scale, y(g.laser.y)).stroke({ color: 0x999999, width: 1 });
    geometry.circle(g.laser.x * scale, y(g.laser.y), 6).fill(0x337788);
    geometry.rect((g.lift.x - g.lift.halfWidth) * scale, y(g.lift.y + g.lift.halfHeight), g.lift.halfWidth * 2 * scale, g.lift.halfHeight * 2 * scale).stroke({ color: getPreview(scene.liftToken).kit.includes('lift') ? 0x995511 : 0xbbbbbb, width: 2 });
    const portalColor = getPreview(scene.portalToken).kit.includes('portal') ? 0x665588 : 0xbbbbbb;
    geometry.circle(g.entrance.x * scale, y(g.entrance.y), g.entrance.radius * scale).stroke({ color: portalColor, width: 4 });
    geometry.circle(g.exitX * scale, y(scene.portalExitY), g.entrance.radius * scale).stroke({ color: portalColor, width: 4 });
    geometry.rect((g.lever.x - g.lever.halfWidth) * scale, y(g.lever.y + g.lever.halfHeight), g.lever.halfWidth * 2 * scale, g.lever.halfHeight * 2 * scale).fill(snapshot.bannerOpen ? 0x448844 : 0x555555);
    if (!snapshot.balloonPopped) geometry.circle(g.balloon.x * scale, y(g.balloon.y), g.balloon.radius * scale).fill(0x999999);
    particles.clear();
    for (const body of snapshot.bodies) {
      particles.circle(body.x * scale, y(body.y), body.id === 'ball' ? 16 : 5).fill(body.id === 'ball' ? 0x222222 : 0x995511);
    }
    ray.clear();
    const fired = snapshot.events.find((e) => e.type === 'laser');
    if (fired && snapshot.tick - fired.tick < 24 && snapshot.laserEnd) {
      ray.moveTo(g.laser.x * scale, y(g.laser.y)).lineTo(snapshot.laserEnd.x * scale, y(snapshot.laserEnd.y)).stroke({ color: 0x337788, width: 3 });
    }
    banner.text = scene.message;
    banner.visible = snapshot.bannerOpen;
    for (const slot of slots) {
      const token = scene[slot.field];
      const cached = textures.get(token);
      slot.caption.text = `Token ${token}${cached ? '' : ' (no art)'}`;
      slot.sprite.visible = !!cached;
      if (cached) { slot.sprite.texture = cached.texture; slot.sprite.width = 64; slot.sprite.height = 64; }
    }
  };
  const pause = () => {
    if (disposed) return;
    running = false; clock.reset(); app.stop(); draw(); app.render(); publish();
  };
  const visibility = () => { if (document.hidden) pause(); };
  document.addEventListener('visibilitychange', visibility);
  app.ticker.add((ticker) => {
    if (!running || disposed) return;
    const snapshot = simulation.step(clock.consume(ticker.elapsedMS / 1000));
    draw();
    if (snapshot.tick >= MAX_TICKS) pause();
    else if (snapshot.tick % 6 === 0) publish();
  });
  draw(); app.render(); publish();
  for (const source of PREVIEWS) {
    void loadArtwork(source, signal).then((bitmap) => {
      if (disposed || signal.aborted) { bitmap.close(); return; }
      try { textures.set(source.tokenId, { texture: Texture.from(bitmap), bitmap }); }
      catch (error) { bitmap.close(); throw error; }
      artwork[source.tokenId] = 'ready'; draw(); app.render(); publish();
    }).catch(() => {
      if (disposed || signal.aborted) return;
      artwork[source.tokenId] = 'unavailable'; publish();
    });
  }
  return {
    run() { if (disposed || running || simulation.snapshot().tick >= MAX_TICKS) return; running = true; clock.reset(); app.start(); publish(); },
    pause,
    reset(next) { if (disposed) return; simulation.reset(next); scene = next; pause(); },
    dispose() {
      if (disposed) return;
      disposed = true;
      document.removeEventListener('visibilitychange', visibility);
      app.stop(); app.destroy(true, { children: true });
      for (const { texture, bitmap } of textures.values()) { texture.destroy(true); bitmap.close(); }
      simulation.dispose();
    },
  };
}
