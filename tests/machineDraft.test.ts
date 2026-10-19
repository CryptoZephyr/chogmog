import { describe, expect, test } from 'vitest';
import { PreviewCatalog, loadMachineDraft, MACHINE_DRAFT_KEY, newMachineDraft, saveMachineDraft } from '../src/domain/machineDraft';
import { previewSourcePin, resolvePreviewSource, validateMachine, type Scene } from '../src/domain/documents';

const edit = (scene: Scene): Scene => structuredClone(scene);

describe('free machine composition', () => {
  test('pins exact public-data sources and a useful preview chain without holder authority', async () => {
    const catalog = await PreviewCatalog.create();
    for (const [kind, token] of [['release', '533'], ['laser', '533'], ['push', '533'], ['lift', '846'], ['portal', '846']] as const) {
      const version = catalog.get(kind);
      expect(version.content.source).toEqual(previewSourcePin(token));
      expect(version.content.actions[0].type).toBe(kind);
      expect((await catalog.resolvePart(version.id)).origin).toBe('public-data-preview');
    }
    const machine = await catalog.validate(newMachineDraft(catalog));
    expect(machine.scene.parts).toHaveLength(2);
    expect(machine.expanded.map((p) => p.configured.actions[0].type)).toEqual(['laser', 'release']);
    await expect(validateMachine(machine.scene, catalog.resolvePart, resolvePreviewSource, 'publication')).rejects.toThrow(/Preview parts/);
  });

  test('exposed controls, placements and budgets are checked on the whole machine', async () => {
    const catalog = await PreviewCatalog.create();
    const draft = newMachineDraft(catalog);
    const changed = edit(draft);
    const laser = changed.parts.find((p) => p.id === 'laser')!;
    laser.values.aim = 0.4;
    const configured = (await catalog.validate(changed)).expanded.find((p) => p.instanceId === 'laser')!.configured;
    expect(configured.actions[0]).toMatchObject({ type: 'laser', angle: 0.4 });
    expect(catalog.get('laser').content.actions[0]).toMatchObject({ angle: 0 });
    laser.values.hidden = 0.1;
    await expect(catalog.validate(changed)).rejects.toThrow(/Unexposed/);
    delete laser.values.hidden;
    laser.values.aim = 1;
    await expect(catalog.validate(changed)).rejects.toThrow(/bounds/);
    laser.values.aim = 0;
    laser.x = 10;
    await expect(catalog.validate(changed)).rejects.toThrow(/placement/);
    laser.x = 3;
    laser.versionId = 'sha256:' + 'f'.repeat(64);
    await expect(catalog.validate(changed)).rejects.toThrow(/pinned public preview/);
  });

  test('reloads a valid draft and recovers safely from corrupt or denied storage', async () => {
    const catalog = await PreviewCatalog.create();
    const data = new Map<string, string>();
    const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
    const draft = edit(newMachineDraft(catalog));
    draft.message = 'My own reaction'; draft.parts.find((p) => p.id === 'laser')!.values.aim = 0.3;
    expect(await saveMachineDraft(storage, catalog, draft)).toBe(true);
    const saved = data.get(MACHINE_DRAFT_KEY);
    expect(saved).toBeTruthy();
    const loaded = await loadMachineDraft(storage, catalog);
    expect(loaded.recovered).toBe(true);
    expect(loaded.machine.scene.message).toBe('My own reaction');
    expect(loaded.machine.scene.parts.find((p) => p.id === 'laser')!.values).toEqual({ aim: 0.3 });
    const tampered = edit(draft);
    tampered.parts.find((p) => p.id === 'laser')!.values.notExposed = 1;
    expect(await saveMachineDraft(storage, catalog, tampered)).toBe(false);
    expect(data.get(MACHINE_DRAFT_KEY)).toBe(saved);
    data.set(MACHINE_DRAFT_KEY, '{');
    expect((await loadMachineDraft(storage, catalog)).recovered).toBe(false);
    data.set(MACHINE_DRAFT_KEY, JSON.stringify({ ...draft, parts: [{ ...draft.parts[0], versionId: 'sha256:' + '0'.repeat(64) }] }));
    expect((await loadMachineDraft(storage, catalog)).recovered).toBe(false);
    expect(await saveMachineDraft({ setItem: () => { throw new Error('Storage denied'); } }, catalog, draft)).toBe(false);
    expect((await loadMachineDraft({ getItem: () => { throw new Error('Storage denied'); } }, catalog)).recovered).toBe(false);
  });

  test('checks expanded balloon body budgets and rejects ownership flags or oversized drafts', async () => {
    const catalog = await PreviewCatalog.create();
    const scene = edit(newMachineDraft(catalog));
    scene.parts = Array.from({ length: 6 }, (_, i) => ({ id: `laser-${i}`, versionId: catalog.get('laser').id, x: 0, y: 0, values: {} }));
    scene.connections = []; scene.inputs = [];
    for (let i = 0; i < 9; i++) scene.props.push({ id: `ball-${i}`, type: 'ball', x: 1, y: 5, radius: 0.18, restitution: 0.5 });
    await expect(catalog.validate(scene)).rejects.toThrow(/budget/);
    const forged = { ...newMachineDraft(catalog), holderVerified: true };
    const bad = { getItem: () => JSON.stringify(forged) };
    expect((await loadMachineDraft(bad, catalog)).recovered).toBe(false);
    expect((await loadMachineDraft({ getItem: () => ' '.repeat(100_000) }, catalog)).recovered).toBe(false);
  });
});
