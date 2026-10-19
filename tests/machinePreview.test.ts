import { describe, expect, test } from 'vitest';
import { PreviewCatalog, newMachineDraft } from '../src/domain/machineDraft';
import { createPartVersion, resolvePreviewSource, type Scene } from '../src/domain/documents';
import { MachinePreview } from '../src/game/machinePreview';

async function play(scene: Scene, catalog: PreviewCatalog, ticks = 180) {
  const simulation = await MachinePreview.create(scene, catalog.resolvePart, resolvePreviewSource);
  try { return simulation.step(ticks); } finally { simulation.dispose(); }
}

describe('free machine shared-world sandbox', () => {
  test('runs a physical cross-part chain and repeats on Reset, without a wallet', async () => {
    const catalog = await PreviewCatalog.create();
    const scene = newMachineDraft(catalog);
    const simulation = await MachinePreview.create(scene, catalog.resolvePart, resolvePreviewSource);
    try {
      const first = simulation.step(180);
      expect(first.events.map((e) => e.text).join('\n')).toMatch(/physical ball released/);
      expect(first.events.map((e) => e.text).join('\n')).toMatch(/crossed sensor/);
      expect(first.events.map((e) => e.text).join('\n')).toMatch(/ray hit a balloon/);
      expect(first.popped).toEqual(['laser/balloon']);
      expect(first.bodies.length).toBe(13);
      expect(first.bannerOpen).toBe(true);
      simulation.reset();
      expect(simulation.snapshot()).toMatchObject({ tick: 0, bodyCount: 1, popped: [], bannerOpen: false });
      expect(simulation.step(180).events).toEqual(first.events);
      expect(simulation.step(720).tick).toBe(720);
      expect(() => simulation.step(721)).toThrow(/Invalid tick/);
    } finally { simulation.dispose(); }
    expect(() => simulation.snapshot()).toThrow(/disposed/);
  });

  test('disconnected event wire, moved sensor and exposed aim miss break the chain', async () => {
    const catalog = await PreviewCatalog.create();
    const base = newMachineDraft(catalog);
    const immediate = structuredClone(base);
    immediate.inputs.push({ id: 'immediate-laser', tick: 0, target: { objectId: 'laser', socket: 'in' } });
    expect((await play(immediate, catalog, 1)).popped).toEqual(['laser/balloon']);
    const disconnected = structuredClone(base);
    disconnected.connections = disconnected.connections.filter((c) => c.from.objectId !== 'sensor');
    const noWire = await play(disconnected, catalog);
    expect(noWire.events.some((e) => e.text.includes('crossed sensor'))).toBe(true);
    expect(noWire.events.some((e) => e.text.includes('ray hit'))).toBe(false);
    expect(noWire.bannerOpen).toBe(false);
    const moved = structuredClone(base);
    moved.props.find((p) => p.id === 'sensor')!.x = 7;
    const noSensor = await play(moved, catalog);
    expect(noSensor.popped).toEqual([]);
    const missed = structuredClone(base);
    missed.parts.find((p) => p.id === 'laser')!.values.aim = 0.5;
    const noHit = await play(missed, catalog);
    expect(noHit.events.map((e) => e.text).join(' ')).toMatch(/ray missed/);
    expect(noHit.popped).toEqual([]);
    expect(noHit.bannerOpen).toBe(false);
  });

  test('can add a Fire lift and Wizard portal without granting action authority to token 533', async () => {
    const catalog = await PreviewCatalog.create();
    const scene = structuredClone(newMachineDraft(catalog));
    scene.parts.push({ id: 'lift', versionId: catalog.get('lift').id, x: 0, y: 4, values: { strength: 24 } });
    const lift = await play(scene, catalog, 100);
    expect(lift.events.some((event) => event.text.includes('Fire lifted'))).toBe(true);
    expect(lift.bodyCount).toBeLessThanOrEqual(80);
    const withPortal = structuredClone(newMachineDraft(catalog));
    withPortal.parts.push({ id: 'portal', versionId: catalog.get('portal').id, x: 0.4, y: 3.8, values: {} });
    const portal = await play(withPortal, catalog, 100);
    expect(portal.events.some((event) => event.text.includes('Wizard portal moved'))).toBe(true);
    expect(portal.events.length).toBeLessThanOrEqual(200);
    const swapped = structuredClone(scene);
    swapped.parts.find((p) => p.id === 'lift')!.versionId = catalog.get('push').id;
    await expect(play(swapped, catalog)).rejects.toThrow(/Unexposed/);
  });

  test('body wiring gates only eligible physical bodies and still requires proximity', async () => {
    const catalog = await PreviewCatalog.create();
    const base = structuredClone(newMachineDraft(catalog));
    base.parts.push({ id: 'lift', versionId: catalog.get('lift').id, x: 0, y: 4, values: {} });
    base.connections.push({ from: { objectId: 'release', socket: 'out' }, to: { objectId: 'lift', socket: 'in' } });
    expect((await play(base, catalog, 100)).events.some((e) => e.text.includes('Fire lifted'))).toBe(true);
    const wrongBodies = structuredClone(base);
    wrongBodies.connections = wrongBodies.connections.filter((c) => c.to.objectId !== 'lift');
    wrongBodies.connections.push({ from: { objectId: 'laser', socket: 'confetti' }, to: { objectId: 'lift', socket: 'in' } });
    expect((await play(wrongBodies, catalog, 100)).events.some((e) => e.text.includes('Fire lifted'))).toBe(false);
    const away = structuredClone(base);
    away.parts.find((p) => p.id === 'lift')!.x = 8;
    expect((await play(away, catalog, 100)).events.some((e) => e.text.includes('Fire lifted'))).toBe(false);
  });

  test('holds a prepared body until its scheduled input and bounds cyclic event wiring', async () => {
    const catalog = await PreviewCatalog.create();
    const scene = structuredClone(newMachineDraft(catalog));
    scene.inputs[0].tick = 100;
    scene.connections.push({ from: { objectId: 'lever', socket: 'activated' }, to: { objectId: 'lever', socket: 'hit' } });
    const simulation = await MachinePreview.create(scene, catalog.resolvePart, resolvePreviewSource);
    try {
      const held = simulation.step(100);
      expect(held.bodies[0].y).toBeCloseTo(7);
      expect(held.events).toEqual([]);
      const released = simulation.step(200);
      expect(released.bannerOpen).toBe(true);
      expect(released.events.filter((event) => event.text.includes('lever activated'))).toHaveLength(1);
      expect(released.events.length).toBeLessThanOrEqual(200);
    } finally { simulation.dispose(); }
  });

  test('timestamps late laser rays relative to firing, not the absolute scene start', async () => {
    const catalog = await PreviewCatalog.create(), scene = structuredClone(newMachineDraft(catalog));
    scene.connections = []; scene.inputs = [{ id: 'late', tick: 100, target: { objectId: 'laser', socket: 'in' } }];
    const simulation = await MachinePreview.create(scene, catalog.resolvePart, resolvePreviewSource);
    try {
      expect(simulation.step(100).rays).toEqual([]);
      const fired = simulation.step(1);
      expect(fired.rays).toHaveLength(1); expect(fired.rays[0].tick).toBe(100);
      expect(fired.tick - fired.rays[0].tick).toBeLessThan(50);
      const expired = simulation.step(50);
      expect(expired.tick - expired.rays[0].tick).toBeGreaterThanOrEqual(50);
      simulation.reset(); expect(simulation.snapshot().rays).toEqual([]);
    } finally { simulation.dispose(); }
  });

  test('treats portal destinations beyond the enclosing walls as blocked for each body radius', async () => {
    const catalog = await PreviewCatalog.create(), content = structuredClone(catalog.get('portal').content);
    content.bounds.width = 12;
    const portal = content.actions[0];
    if (portal.type !== 'portal') throw new Error('Expected portal');
    portal.x = 1; portal.exitX = 11.6; portal.radius = 0.4;
    const version = await createPartVersion(content, resolvePreviewSource);
    const scene = structuredClone(newMachineDraft(catalog));
    scene.parts.push({ id: 'portal', versionId: version.id, x: 0, y: 3.8, values: {} });
    const simulation = await MachinePreview.create(scene, async (id) => id === version.id ? { version, origin: 'public-data-preview' } : catalog.resolvePart(id), resolvePreviewSource);
    try {
      const snapshot = simulation.step(100);
      expect(snapshot.events.some((e) => e.text.includes('portal exit blocked'))).toBe(true);
      expect(snapshot.events.some((e) => e.text.includes('Wizard portal moved'))).toBe(false);
      expect(snapshot.bodies.every((body) => body.x + body.radius < 12)).toBe(true);
    } finally { simulation.dispose(); }
  });
});
