import { Application, Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
import { compileKit, getPreview, PREVIEWS, type Ability, type Preview } from '../domain/chog';
import { loadArtwork } from '../domain/artwork';
import type { ChainScene } from '../domain/chainScene';
import { MAX_TICKS, WORLD_HEIGHT } from '../domain/fallingScene';
import { abilityTone, fontFamily, hexToNumber, laserTone, loadFonts, pixiTheme as theme } from '../ui/tokens';
import { ChainSimulation, GEOMETRY, type ChainSnapshot, type EventType } from './chain';
import { FixedStepClock } from './fixedStepClock';
import { activeWords, bobOffset, newCues, pathPrefix, pulseProgress, separateWords, shakeOffset, SOUND_WORD, WORD_TICKS, wireSpent, type Point } from './stageFx';

export interface ChainView {
  snapshot: ChainSnapshot;
  running: boolean;
  artwork: Record<string, 'loading' | 'ready' | 'unavailable'>;
  bitmaps: Record<string, ImageBitmap>;
}
export interface ChainStage {
  run(): void;
  pause(): void;
  reset(scene: ChainScene): void;
  setLabels(visible: boolean): void;
  dispose(): void;
}

export type StopPoint = 'trigger' | 'laser' | 'lift' | 'portal' | 'lever';
export function stopPoint(snapshot: ChainSnapshot): StopPoint {
  const seen = (type: string) => snapshot.events.some((e) => e.type === type);
  if (!seen('sensor')) return 'trigger';
  if (!snapshot.balloonPopped) return 'laser';
  if (!seen('lifted')) return 'lift';
  if (!seen('teleported')) return 'portal';
  return 'lever';
}

const SCALE = 80;
const px = (x: number) => x * SCALE;
const py = (y: number) => (WORLD_HEIGHT - y) * SCALE;
const PORTRAIT = { '533': { x: 0.3, y: 0.5 }, '846': { x: 6.1, y: 4.4 } } as const;
const PORTRAIT_SIZE = 1.4;
const NEEDS: Record<'laser' | 'lift' | 'portal', string> = { laser: 'Needs laser eyes', lift: 'Needs a Fire aura', portal: 'Needs a Wizard hat' };
const eyes = (source: Preview) => source.metadata.attributes.find((t) => t.trait_type === 'Eyes')?.value;
const powerTraits = (source: Preview) => source.metadata.attributes
  .filter((trait) => compileKit({ ...source.metadata, attributes: [trait] }).some((a: Ability) => a === 'lift' || a === 'portal' || a === 'laser'))
  .map((trait) => `${trait.trait_type}: ${trait.value}`);
const shortName = (source: Preview) => `#${source.artworkNumber}`;

function dashedLine(g: Graphics, x1: number, y1: number, x2: number, y2: number, dash = 8, gap = 6) {
  const length = Math.hypot(x2 - x1, y2 - y1);
  const ux = (x2 - x1) / length, uy = (y2 - y1) / length;
  for (let d = 0; d < length; d += dash + gap) {
    const end = Math.min(d + dash, length);
    g.moveTo(x1 + ux * d, y1 + uy * d).lineTo(x1 + ux * end, y1 + uy * end);
  }
}
function dashedRect(g: Graphics, x: number, y: number, w: number, h: number) {
  dashedLine(g, x, y, x + w, y); dashedLine(g, x + w, y, x + w, y + h);
  dashedLine(g, x + w, y + h, x, y + h); dashedLine(g, x, y + h, x, y);
}
function dashedCircle(g: Graphics, cx: number, cy: number, r: number, segments = 12) {
  const step = (Math.PI * 2) / segments;
  for (let i = 0; i < segments; i++) {
    const a = i * step;
    g.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r).arc(cx, cy, r, a, a + step * 0.55);
  }
}
function plug(g: Graphics, x: number, y: number) {
  g.moveTo(x, y).bezierCurveTo(x + 10, y + 10, x + 4, y + 22, x + 12, y + 30).stroke({ color: theme.ink, width: 2 });
  g.roundRect(x + 5, y + 30, 14, 12, 2).fill(theme.white).stroke({ color: theme.ink, width: 2 });
  g.moveTo(x + 9, y + 42).lineTo(x + 9, y + 48).moveTo(x + 15, y + 42).lineTo(x + 15, y + 48).stroke({ color: theme.ink, width: 2 });
}
function path(g: Graphics, points: [number, number][], color: number, width: number, alpha = 1) {
  g.moveTo(px(points[0][0]), py(points[0][1]));
  for (const [x, y] of points.slice(1)) g.lineTo(px(x), py(y));
  g.stroke({ color, width, alpha, cap: 'round', join: 'round' });
}
const BANNER_TEXT = { width: 408, height: 80 };
const WORD_AT: Partial<Record<keyof typeof SOUND_WORD, (scene: ChainScene) => Point>> = {
  released: (scene) => [scene.ballX + 0.75, 6.2],
  sensor: () => [3.3, 2.2],
  laser: () => [3.25, 3.6],
  popped: () => [5, 3],
  lifted: () => [3.4, 4.6],
  teleported: (scene) => [9.35, scene.portalExitY + 0.55],
  'portal-blocked': (scene) => [9.35, scene.portalExitY - 0.55],
  lever: () => [10.6, 1.6],
};
function nozzle(g: Graphics, x: number, y: number, color: number) {
  g.circle(px(x), py(y), 6).fill(color).stroke({ color: theme.ink, width: 2 });
}

export async function createChainStage(host: HTMLElement, initial: ChainScene, signal: AbortSignal, notify: (view: ChainView) => void, cue: (type: EventType) => void = () => undefined): Promise<ChainStage> {
  const [simulation] = await Promise.all([ChainSimulation.create(initial), loadFonts()]);
  if (signal.aborted) { simulation.dispose(); throw new DOMException('Cancelled', 'AbortError'); }
  const app = new Application();
  try {
    await app.init({ width: 960, height: 640, background: theme.stage, antialias: true,
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
  const g = GEOMETRY;
  const base = new Graphics();
  const portraits = new Container();
  const tethers = new Graphics();
  const props = new Graphics();
  const bodies = new Graphics();
  const beam = new Graphics();
  const overlay = new Container();
  const pulses = new Graphics();
  const words = new Container();
  const stamp = new Graphics();
  const shaker = new Container();
  shaker.addChild(portraits, tethers, props, pulses, bodies, beam, overlay, words, stamp);
  app.stage.addChild(base, shaker);
  const motion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');

  const text = (value: string, size: number, options: { family?: string; weight?: '400' | '700'; parent?: Container; wrap?: number; align?: 'left' | 'center' | 'right' } = {}) => {
    const item = new Text({ text: value, style: { fontFamily: options.family ?? fontFamily.ui, fontSize: size, fontWeight: options.weight ?? '700', fill: theme.ink,
      align: options.align ?? 'left', ...(options.wrap ? { wordWrap: true, wordWrapWidth: options.wrap } : {}) } });
    (options.parent ?? overlay).addChild(item);
    return item;
  };
  const chip = (value: string, family: string, parent: Container) => {
    const box = new Container();
    const label = new Text({ text: value, style: { fontFamily: family, fontSize: 17, fontWeight: '700', fill: theme.ink } });
    const back = new Graphics().roundRect(0, 0, label.width + 16, 28, 14).fill(theme.panel).stroke({ color: theme.ink, width: 2 });
    label.position.set(8, 4);
    box.addChild(back, label);
    parent.addChild(box);
    return box;
  };

  base.rect(0, 0, 960, 640).fill(theme.stage);
  for (let x = 1; x < 12; x++) base.moveTo(px(x), 0).lineTo(px(x), py(0.4));
  for (let y = 1; y < 8; y++) base.moveTo(0, py(y)).lineTo(960, py(y));
  base.stroke({ color: theme.stageGrid, width: 1 });
  base.rect(0, py(0.4), 960, px(0.4)).fill(theme.stageGrid);
  base.moveTo(0, py(0.4)).lineTo(960, py(0.4)).stroke({ color: theme.ink, width: 3 });

  const portraitViews = new Map(PREVIEWS.map((source) => {
    const slot = PORTRAIT[source.tokenId as keyof typeof PORTRAIT];
    const group = new Container();
    group.position.set(px(slot.x), py(slot.y + PORTRAIT_SIZE));
    const size = px(PORTRAIT_SIZE);
    const sprite = new Sprite();
    sprite.visible = false;
    const mask = new Graphics().roundRect(0, 0, size, size, 4).fill(theme.white);
    sprite.mask = mask;
    const placeholder = new Graphics().roundRect(0, 0, size, size, 4).fill(theme.panel);
    const missing = new Text({ text: 'Art\nunavailable', style: { fontFamily: fontFamily.ui, fontSize: 14, fontWeight: '700', fill: theme.ink, align: 'center' } });
    missing.anchor.set(0.5); missing.position.set(size / 2, size / 2); missing.visible = false;
    const frame = new Graphics().roundRect(0, 0, size, size, 4).stroke({ color: theme.ink, width: 3 });
    group.addChild(placeholder, sprite, mask, missing, frame);
    const tab = chip(shortName(source), fontFamily.mono, group);
    tab.position.set(-4, -16);
    let offset = size + 6;
    const chips: Container[] = [];
    for (const trait of powerTraits(source)) {
      const item = chip(trait, fontFamily.ui, group);
      item.position.set(0, offset);
      chips.push(item);
      offset += 32;
    }
    portraits.addChild(group);
    return [source.tokenId, { group, sprite, missing, tab, chips }];
  }));

  const labels = [
    { item: text('Ball', 18), at: () => [scene.ballX + 0.45, 6.7] },
    { item: text('Trigger', 18), at: () => [1.45, 3.05] },
    { item: text('Laser', 18), at: () => [2.3, 3.6] },
    { item: text('Balloon', 18), at: () => [5.45, 3.15] },
    { item: text('Lift', 18), at: () => [4.38, 2.55] },
    { item: text('Portal', 18), at: () => [5.4, 6.2] },
    { item: text('Lever', 18), at: () => [9.55, 3.0] },
  ];
  const needs = {
    laser: text(NEEDS.laser, 17, { wrap: 120 }),
    lift: text(NEEDS.lift, 17, { wrap: 100, align: 'center' }),
    portal: text(NEEDS.portal, 17, { wrap: 120, align: 'right' }),
  };
  needs.laser.position.set(px(2.85), py(3.75));
  needs.lift.anchor.set(0.5, 0); needs.lift.position.set(px(5), py(4.6));
  needs.portal.anchor.set(1, 0.5); needs.portal.position.set(px(4.25), py(5.8));
  const banner = text(initial.message, 36, { family: fontFamily.display, weight: '400', wrap: 408, align: 'center' });
  banner.anchor.set(0.5);
  banner.style.breakWords = true;
  const wordViews = new Map(Object.keys(WORD_AT).map((type) => {
    const item = new Text({ text: SOUND_WORD[type as keyof typeof SOUND_WORD], style: { fontFamily: fontFamily.display, fontSize: 30, fill: theme.white,
      stroke: { color: theme.ink, width: 6, join: 'round' } } });
    item.anchor.set(0.5); item.rotation = -0.07; item.visible = false;
    words.addChild(item);
    return [type as keyof typeof SOUND_WORD, item];
  }));
  banner.position.set(px(6), py(7.12));

  const artwork: ChainView['artwork'] = Object.fromEntries(PREVIEWS.map((p) => [p.tokenId, 'loading']));
  const textures = new Map<string, { texture: Texture; bitmap: ImageBitmap }>();
  app.canvas.setAttribute('role', 'img');
  app.canvas.setAttribute('aria-label', 'Starter machine: ball, trigger, laser, balloon, Fire lift, Wizard portal, lever and banner. Each trait power is tethered to the Chog it comes from. Events are listed in the event log.');
  host.appendChild(app.canvas);
  const clock = new FixedStepClock();
  let scene = initial;
  let running = false;
  let disposed = false;
  let showLabels = false;
  const heard = new Set<EventType>();
  const publish = () => notify({ snapshot: simulation.snapshot(), running, artwork: { ...artwork }, bitmaps: Object.fromEntries([...textures].map(([token, entry]) => [token, entry.bitmap])) });

  let fitted: string | null = null;
  const fitBanner = () => {
    if (fitted === scene.message) return;
    fitted = scene.message;
    banner.text = scene.message;
    const fits = () => banner.height <= BANNER_TEXT.height && banner.width <= BANNER_TEXT.width;
    for (const size of [36, 32, 28, 24, 20]) {
      banner.style.fontSize = size;
      if (fits()) return;
    }
    const kept = scene.message.trim().split(/\s+/);
    while (kept.length > 1 && !fits()) { kept.pop(); banner.text = `${kept.join(' ')}…`; }
    while (!fits() && banner.text.length > 2) banner.text = `${banner.text.slice(0, -2)}…`;
  };

  const draw = () => {
    const snapshot = simulation.snapshot();
    const compact = host.clientWidth > 0 && host.clientWidth < 560;
    const laserSource = getPreview(scene.laserToken);
    const laserColours = laserSource.kit.includes('laser') ? laserTone(eyes(laserSource)) : null;
    const liftOn = getPreview(scene.liftToken).kit.includes('lift');
    const portalOn = getPreview(scene.portalToken).kit.includes('portal');
    const lift = { bright: hexToNumber(abilityTone.lift.bright), deep: hexToNumber(abilityTone.lift.deep) };
    const portal = { bright: hexToNumber(abilityTone.portal.bright), deep: hexToNumber(abilityTone.portal.deep) };
    const used = new Set([scene.laserToken, scene.liftToken, scene.portalToken]);
    const still = !!motion?.matches;
    const [shakeX, shakeY] = still ? [0, 0] : shakeOffset(snapshot.events, snapshot.tick);
    shaker.position.set(shakeX, shakeY);
    for (const [token, view] of portraitViews) {
      view.group.visible = used.has(token);
      const slot = PORTRAIT[token as keyof typeof PORTRAIT];
      view.group.position.set(px(slot.x), py(slot.y + PORTRAIT_SIZE) - (still ? 0 : bobOffset(snapshot.events, token, snapshot.tick)));
      const cached = textures.get(token);
      view.sprite.visible = !!cached;
      view.missing.visible = artwork[token] === 'unavailable';
      view.tab.scale.set(compact ? 1.8 : 1);
      view.tab.position.set(-4, compact ? -30 : -16);
      for (const item of view.chips) item.visible = !compact;
      if (cached) { view.sprite.texture = cached.texture; view.sprite.width = px(PORTRAIT_SIZE); view.sprite.height = px(PORTRAIT_SIZE); }
    }

    tethers.clear();
    const wires: { points: Point[]; color: number; after: keyof typeof SOUND_WORD }[] = [
      { points: [[g.sensor.x + g.sensor.halfWidth, g.sensor.y], [g.laser.x - 0.18, g.sensor.y], [g.laser.x - 0.18, g.laser.y]], color: theme.ink, after: 'sensor' },
      { points: [[g.lever.x + g.lever.halfWidth + 0.1, g.lever.y], [11.3, g.lever.y], [11.3, 7.2], [8.95, 7.2]], color: theme.ink, after: 'lever' },
    ];
    if (laserColours) {
      const from = PORTRAIT['533'];
      const deep = hexToNumber(laserColours.deep);
      const points: Point[] = [[from.x + PORTRAIT_SIZE, 1.2], [g.laser.x, 1.2], [g.laser.x, 2.8]];
      path(tethers, points as [number, number][], deep, 4);
      wires.push({ points, color: deep, after: 'laser' });
      nozzle(tethers, g.laser.x, 2.8, deep);
    }
    if (liftOn) {
      const from = PORTRAIT[scene.liftToken as keyof typeof PORTRAIT];
      const right = g.lift.x + g.lift.halfWidth;
      path(tethers, [[from.x, 5], [right, 5]], lift.deep, 4);
      wires.push({ points: [[from.x, 5], [right, 5]], color: lift.deep, after: 'lifted' });
      nozzle(tethers, right, 5, lift.deep);
    }
    if (portalOn) {
      const from = PORTRAIT[scene.portalToken as keyof typeof PORTRAIT];
      const r = g.entrance.radius;
      const entry: Point[] = [[from.x + 0.9, from.y + PORTRAIT_SIZE], [from.x + 0.9, 6.45], [g.entrance.x, 6.45], [g.entrance.x, g.entrance.y + r]];
      path(tethers, entry as [number, number][], portal.deep, 4);
      const ey = scene.portalExitY, joinY = from.y + 0.7, dy = joinY - ey;
      const end: [number, number] = dy >= r ? [g.exitX, ey + r] : dy <= -r ? [g.exitX, ey - r] : [g.exitX - Math.sqrt(r * r - dy * dy), joinY];
      path(tethers, [[from.x + PORTRAIT_SIZE, joinY], [end[0], joinY], end], portal.deep, 4);
      wires.push({ points: entry, color: portal.deep, after: 'teleported' }, { points: [[from.x + PORTRAIT_SIZE, joinY], [end[0], joinY], end], color: portal.deep, after: 'teleported' });
      nozzle(tethers, g.entrance.x, g.entrance.y + r, portal.deep);
      nozzle(tethers, end[0], end[1], portal.deep);
    }

    props.clear();
    const sensed = snapshot.events.find((e) => e.type === 'sensor');
    const flash = !!sensed && snapshot.tick - sensed.tick < 12;
    const plate = { x: px(g.sensor.x - g.sensor.halfWidth), y: py(g.sensor.y + g.sensor.halfHeight), w: px(g.sensor.halfWidth * 2), h: px(g.sensor.halfHeight * 2) };
    props.moveTo(px(1.85), plate.y + plate.h).lineTo(px(1.85), py(0.4)).moveTo(px(2.3), plate.y + plate.h).lineTo(px(2.3), py(0.4)).stroke({ color: theme.ink, width: 3 });
    props.rect(plate.x, plate.y, plate.w, plate.h).fill(flash ? theme.ink : theme.white);
    props.moveTo(plate.x, plate.y).lineTo(plate.x, plate.y + plate.h).lineTo(plate.x + plate.w, plate.y + plate.h).lineTo(plate.x + plate.w, plate.y).stroke({ color: theme.ink, width: 3 });
    if (flash) props.moveTo(plate.x, plate.y).lineTo(plate.x + plate.w, plate.y).stroke({ color: theme.ink, width: 3 });
    else { dashedLine(props, plate.x, plate.y, plate.x + plate.w, plate.y, 6, 5); props.stroke({ color: theme.ink, width: 3 }); }
    path(props, wires[0].points as [number, number][], theme.ink, 2);

    const released = snapshot.tick > 0;
    const jawGap = released ? 0.16 : 0;
    for (const side of [-1, 1]) {
      const cx = px(scene.ballX + side * (0.06 + jawGap)), cy = py(6.5 - (released ? -0.08 : 0));
      const start = side < 0 ? Math.PI * 0.62 : -Math.PI * 0.38;
      props.moveTo(cx + Math.cos(start) * 22, cy + Math.sin(start) * 22).arc(cx, cy, 22, start, start + Math.PI * 0.76).stroke({ color: theme.ink, width: 4, cap: 'round' });
    }

    props.roundRect(px(g.laser.x) - 14, py(g.laser.y) - 11, 30, 22, 6).fill(theme.white).stroke({ color: laserColours ? hexToNumber(laserColours.deep) : theme.ink, width: 3 });
    props.rect(px(g.laser.x) + 16, py(g.laser.y) - 5, 8, 10).fill(theme.ink);
    if (!laserColours) { dashedCircle(props, px(g.laser.x) + 1, py(g.laser.y), 24, 10); props.stroke({ color: theme.ink, width: 2 }); plug(props, px(g.laser.x) - 4, py(g.laser.y) + 12); }

    if (!snapshot.balloonPopped) {
      const bx = px(g.balloon.x), by = py(g.balloon.y), br = px(g.balloon.radius);
      props.moveTo(bx, by + br + 6).bezierCurveTo(bx - 8, by + br + 60, bx + 8, by + br + 120, bx, py(0.4)).stroke({ color: theme.ink, width: 1.5 });
      props.poly([bx, py(0.4) - 8, bx - 6, py(0.4), bx + 6, py(0.4)]).fill(theme.ink);
      props.poly([bx, by + br - 2, bx - 6, by + br + 7, bx + 6, by + br + 7]).fill(theme.white).stroke({ color: theme.ink, width: 2 });
      props.circle(bx, by, br).fill(theme.white).stroke({ color: theme.ink, width: 3 });
      props.moveTo(bx + br * 0.2, by + br * 0.85).arc(bx, by, br - 2, Math.PI * 0.42, Math.PI * 0.05, true).stroke({ color: theme.ink, width: 6, alpha: 0.12 });
    }

    const col = { x: px(g.lift.x - g.lift.halfWidth), y: py(g.lift.y + g.lift.halfHeight), w: px(g.lift.halfWidth * 2), h: px(g.lift.halfHeight * 2) };
    if (liftOn) {
      const bands = 6;
      for (let i = 0; i < bands; i++) {
        const t = i / (bands - 1);
        const mix = (a: number, b: number, shift: number) => Math.round(((a >> shift) & 255) * (1 - t) + ((b >> shift) & 255) * t) << shift;
        const colourValue = mix(lift.bright, lift.deep, 16) | mix(lift.bright, lift.deep, 8) | mix(lift.bright, lift.deep, 0);
        props.rect(col.x, col.y + (col.h / bands) * i, col.w, col.h / bands + 1).fill({ color: colourValue, alpha: 0.25 });
      }
      for (let i = 0; i < 7; i++) {
        const rise = ((i * 53 + snapshot.tick * 1.6) % col.h);
        const ex = col.x + 14 + ((i * 37) % (col.w - 28));
        props.circle(ex, col.y + col.h - rise, 3 + (i % 3)).fill(lift.bright).stroke({ color: lift.deep, width: 1.5 });
      }
      props.rect(col.x, col.y, col.w, col.h).stroke({ color: lift.deep, width: 3 });
    } else {
      dashedRect(props, col.x, col.y, col.w, col.h); props.stroke({ color: theme.ink, width: 2 });
      plug(props, col.x + col.w, py(5));
    }

    const rings: [number, number][] = [[g.entrance.x, g.entrance.y], [g.exitX, scene.portalExitY]];
    rings.forEach(([x, y], index) => {
      const cx = px(x), cy = py(y), r = px(g.entrance.radius);
      if (portalOn) {
        props.circle(cx, cy, r).fill(theme.white).stroke({ color: portal.deep, width: 4 });
        props.circle(cx, cy, r - 7).stroke({ color: portal.bright, width: 2 });
        const spin = (snapshot.tick / 20) * (index === 0 ? 1 : -1);
        for (const offset of [0, Math.PI]) {
          const a = spin + offset;
          props.moveTo(cx + Math.cos(a) * (r - 13), cy + Math.sin(a) * (r - 13)).arc(cx, cy, r - 13, a, a + 1.6).stroke({ color: portal.deep, width: 2 });
        }
      } else {
        dashedCircle(props, cx, cy, r); props.stroke({ color: theme.ink, width: 2 });
      }
    });
    if (!portalOn) plug(props, px(g.entrance.x + g.entrance.radius) - 4, py(g.entrance.y));
    const blocked = [...snapshot.events].reverse().find((e) => e.type === 'portal-blocked');
    if (portalOn && blocked && snapshot.tick - blocked.tick < 10) {
      const cx = px(g.exitX), cy = py(scene.portalExitY);
      for (let i = -2; i <= 2; i++) props.moveTo(cx + i * 9 - 12, cy + 14).lineTo(cx + i * 9 + 12, cy - 14);
      props.stroke({ color: theme.ink, width: 2 });
    }

    const lever = { x: px(g.lever.x), y: py(g.lever.y), hw: px(g.lever.halfWidth), hh: px(g.lever.halfHeight) };
    props.moveTo(lever.x, py(0.4)).lineTo(lever.x, lever.y + lever.hh + 6).stroke({ color: theme.ink, width: 3 });
    props.poly([lever.x, lever.y + lever.hh - 2, lever.x - 9, lever.y + lever.hh + 12, lever.x + 9, lever.y + lever.hh + 12]).fill(theme.white).stroke({ color: theme.ink, width: 2 });
    const angle = snapshot.bannerOpen ? -0.26 : 0.26;
    const corner = (dx: number, dy: number): [number, number] => [lever.x + dx * Math.cos(angle) - dy * Math.sin(angle), lever.y + dx * Math.sin(angle) + dy * Math.cos(angle)];
    props.poly([...corner(-lever.hw, -lever.hh), ...corner(lever.hw, -lever.hh), ...corner(lever.hw, lever.hh), ...corner(-lever.hw, lever.hh)]).fill(theme.white);
    props.poly([...corner(-lever.hw, lever.hh * 0.2), ...corner(lever.hw, lever.hh * 0.2), ...corner(lever.hw, lever.hh), ...corner(-lever.hw, lever.hh)]).fill({ color: theme.ink, alpha: 0.12 });
    props.poly([...corner(-lever.hw, -lever.hh), ...corner(lever.hw, -lever.hh), ...corner(lever.hw, lever.hh), ...corner(-lever.hw, lever.hh)]).stroke({ color: theme.ink, width: 3 });
    path(props, wires[1].points as [number, number][], theme.ink, 2);

    if (snapshot.bannerOpen) {
      props.rect(px(3.3), py(7.7), px(5.4), px(1.1)).fill(theme.white).stroke({ color: theme.ink, width: 3 });
      props.roundRect(px(3.2), py(6.68), px(5.6), 12, 6).fill(theme.white).stroke({ color: theme.ink, width: 3 });
    }
    props.roundRect(px(3.2), py(7.85), px(5.6), 14, 7).fill(theme.white).stroke({ color: theme.ink, width: 3 });
    props.circle(px(3.2), py(7.85) + 7, 9).fill(theme.white).stroke({ color: theme.ink, width: 3 });
    props.circle(px(8.8), py(7.85) + 7, 9).fill(theme.white).stroke({ color: theme.ink, width: 3 });

    const lastPower = new Map<string, typeof lift>();
    for (const event of snapshot.events) {
      if (event.type === 'lifted') lastPower.set(event.target, lift);
      else if (event.type === 'teleported') lastPower.set(event.target, portal);
    }
    bodies.clear();
    for (const body of snapshot.bodies) {
      const x = px(body.x), y = py(body.y);
      if (body.id === 'ball') {
        bodies.circle(x, y, 16).fill(theme.white).stroke({ color: theme.ink, width: 3 });
        bodies.moveTo(x + 4, y + 12).arc(x, y, 12, Math.PI * 0.4, Math.PI * 0.02, true).stroke({ color: theme.ink, width: 4, alpha: 0.12 });
        continue;
      }
      const tone = lastPower.get(body.id);
      bodies.circle(x, y, 5).fill(tone ? tone.bright : theme.white).stroke({ color: tone ? tone.deep : theme.ink, width: tone ? 2 : 1.5 });
    }

    beam.clear();
    const fired = snapshot.events.find((e) => e.type === 'laser');
    if (laserColours && fired && snapshot.tick - fired.tick < 24 && snapshot.laserEnd) {
      const from = [px(g.laser.x) + 24, py(g.laser.y)] as const, to = [px(snapshot.laserEnd.x), py(snapshot.laserEnd.y)] as const;
      const bright = hexToNumber(laserColours.bright);
      beam.moveTo(...from).lineTo(...to).stroke({ color: bright, width: 14, alpha: 0.35, cap: 'round' });
      beam.moveTo(...from).lineTo(...to).stroke({ color: bright, width: 7, cap: 'round' });
      beam.moveTo(...from).lineTo(...to).stroke({ color: theme.white, width: 2.5, cap: 'round' });
    }

    const labelsOn = showLabels || (snapshot.tick === 0 && !running);
    for (const label of labels) {
      label.item.visible = labelsOn && (!compact || showLabels) && !(label.item.text === 'Laser' && !laserColours);
      label.item.scale.set(compact ? 1.6 : 1);
      const [x, y] = label.at();
      label.item.position.set(px(x), py(y));
    }
    for (const item of Object.values(needs)) item.scale.set(compact ? 1.5 : 1);
    needs.laser.visible = !laserColours;
    needs.lift.visible = !liftOn;
    needs.portal.visible = !portalOn;
    fitBanner();
    banner.visible = snapshot.bannerOpen;

    pulses.clear();
    for (const wire of wires) {
      if (wireSpent(snapshot.events, wire.after, snapshot.tick)) { path(pulses, wire.points as [number, number][], wire.color, 6, 0.4); continue; }
      const progress = pulseProgress(snapshot.events, wire.after, snapshot.tick);
      if (progress === null) continue;
      const lit = pathPrefix(wire.points, still ? 1 : progress);
      path(pulses, lit as [number, number][], wire.color, 6);
      const [hx, hy] = lit[lit.length - 1];
      pulses.circle(px(hx), py(hy), 7).fill(theme.white).stroke({ color: wire.color, width: 3 });
    }
    const live = activeWords(snapshot.events, snapshot.tick).filter(({ type }) => !(type === 'laser' && !laserColours));
    for (const item of wordViews.values()) item.visible = false;
    const shown: { item: Text; box: { x: number; y: number; halfW: number; halfH: number } }[] = [];
    for (const { type, age } of live) {
      const item = wordViews.get(type);
      if (!item) continue;
      item.visible = true;
      const tone = type === 'laser' && laserColours ? hexToNumber(laserColours.bright) : type === 'lifted' ? lift.bright : type === 'teleported' || type === 'portal-blocked' ? portal.bright : theme.white;
      item.style.fill = tone;
      const [wx, wy] = WORD_AT[type]!(scene);
      item.scale.set((compact ? 1.5 : 1) * (still || age >= 6 ? 1 : 1.3 - age * 0.05));
      const bounds = item.getBounds();
      const halfW = bounds.width / 2 + 6, halfH = bounds.height / 2 + 6;
      shown.push({ item, box: { x: Math.min(Math.max(px(wx), halfW), app.screen.width - halfW), y: py(wy), halfW, halfH } });
      item.alpha = age > WORD_TICKS - 10 ? (WORD_TICKS - age) / 10 : 1;
    }
    separateWords(shown.map(({ box }) => box), app.screen.height).forEach(({ x, y }, index) => shown[index].item.position.set(x, y));

    stamp.clear();
    if (snapshot.tick >= MAX_TICKS && !snapshot.bannerOpen) {
      const where = { trigger: [g.sensor.x, g.sensor.y + 0.55], laser: [g.laser.x + 0.65, g.laser.y - 0.05], lift: [g.lift.x, 3.9], portal: [g.entrance.x, g.entrance.y - 0.7], lever: [g.lever.x, g.lever.y + 0.6] }[stopPoint(snapshot)];
      const sx = px(where[0]), sy = py(where[1]);
      stamp.circle(sx, sy, 22).fill(theme.white).stroke({ color: theme.ink, width: 3 });
      stamp.moveTo(sx - 9, sy - 9).lineTo(sx + 9, sy + 9).moveTo(sx + 9, sy - 9).lineTo(sx - 9, sy + 9).stroke({ color: theme.ink, width: 4, cap: 'round' });
    }
  };
  const render = () => { draw(); app.render(); };
  const pause = () => {
    if (disposed) return;
    running = false; clock.reset(); app.stop(); render(); publish();
  };
  const visibility = () => { if (document.hidden) pause(); };
  const resize = () => { if (!running && !disposed) render(); };
  document.addEventListener('visibilitychange', visibility);
  window.addEventListener('resize', resize);
  app.ticker.add((ticker) => {
    if (!running || disposed) return;
    const snapshot = simulation.step(clock.consume(ticker.elapsedMS / 1000));
    for (const type of newCues(snapshot.events, heard)) cue(type);
    draw();
    if (snapshot.tick >= MAX_TICKS) pause();
    else if (snapshot.tick % 6 === 0) publish();
  });
  render(); publish();
  for (const source of PREVIEWS) {
    void loadArtwork(source, signal).then((bitmap) => {
      if (disposed || signal.aborted) { bitmap.close(); return; }
      try { textures.set(source.tokenId, { texture: Texture.from(bitmap), bitmap }); }
      catch (error) { bitmap.close(); throw error; }
      artwork[source.tokenId] = 'ready'; render(); publish();
    }).catch(() => {
      if (disposed || signal.aborted) return;
      artwork[source.tokenId] = 'unavailable'; render(); publish();
    });
  }
  return {
    run() { if (disposed || running || simulation.snapshot().tick >= MAX_TICKS) return; running = true; clock.reset(); app.start(); publish(); },
    pause,
    reset(next) { if (disposed) return; simulation.reset(next); scene = next; heard.clear(); pause(); },
    setLabels(visible) { if (disposed) return; showLabels = visible; if (!running) render(); },
    dispose() {
      if (disposed) return;
      disposed = true;
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('resize', resize);
      app.stop(); app.destroy(true, { children: true });
      for (const { texture, bitmap } of textures.values()) { texture.destroy(true); bitmap.close(); }
      simulation.dispose();
    },
  };
}
