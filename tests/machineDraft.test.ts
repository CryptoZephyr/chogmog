import { describe, expect, test } from 'vitest';
import { addPreviewPartToDraft, placePreviewPartInDraft, PreviewCatalog, loadMachineDraft, loadPreviewParts, MACHINE_DRAFT_KEY, newMachineDraft, parsePreviewParts,
  PREVIEW_PARTS_KEY, PREVIEW_PART_LIMIT, saveMachineDraft, savePreviewPart } from '../src/domain/machineDraft';
import { createPartVersion, previewSourcePin, resolvePreviewSource, validateMachine, type PartContent, type PartVersion, type Scene } from '../src/domain/documents';
import { contentId } from '../src/domain/canonical';
import { MachineLibrary } from '../src/domain/machineLibrary';
import { PART_DRAFT_KEY } from '../src/domain/partAuthoring';

const edit = (scene: Scene): Scene => structuredClone(scene);
const memoryStorage = () => {
  const data = new Map<string, string>();
  return { data, storage: { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } } };
};
const rejectingCatalog = (versionId: string) => async () => {
  const catalog = await PreviewCatalog.create();
  return {
    get: catalog.get.bind(catalog),
    resolvePart: catalog.resolvePart,
    resolveSource: catalog.resolveSource,
    validate: (scene: Scene, purpose?: 'draft' | 'publication') => {
      if (scene.parts.some((part) => part.versionId === versionId)) throw new Error('Preview part exceeds the scene limit');
      return catalog.validate(scene, purpose);
    },
    addLocalPreviewPart: catalog.addLocalPreviewPart.bind(catalog),
  };
};

describe('free machine composition', () => {
  test('pins exact public-data sources and a useful preview chain without holder authority', async () => {
    const catalog = await PreviewCatalog.create();
    const originalIds = {
      release: 'sha256:fdba40577d211809a17f5b4b25b923e5b7d3bd9e55a03cc41dfbfd441b4f658a',
      laser: 'sha256:2849a67dd3f580e12c61e98efed7ab607b344c25084494b1cb65cab3b9c98d3c',
      push: 'sha256:babf3f238f471bfa4453672af78f3997d4e99e99a15576273f9c39970dfd52f6',
      lift: 'sha256:13eef37356943f1ce598eaf2f568f71816316be18a15a4875f63d779e5ba130f',
      portal: 'sha256:7bcc4fe70ce0e8c7aebb8865052790089c0409d1d2ca510819ef5a755aa2e4ce',
    };
    for (const [kind, token] of [['release', '533'], ['laser', '533'], ['push', '533'], ['lift', '846'], ['portal', '846'], ['shout', '846']] as const) {
      const version = catalog.get(kind);
      expect(version.content.source).toEqual(previewSourcePin(token));
      expect(version.content.actions[0].type).toBe(kind);
      expect((await catalog.resolvePart(version.id)).origin).toBe('public-data-preview');
      if (kind in originalIds) expect(version.id).toBe(originalIds[kind as keyof typeof originalIds]);
    }
    expect(catalog.get('shout').content).toMatchObject({
      partId: 'public-preview-shout',
      source: previewSourcePin('846'),
      actions: [{ id: 'chog', type: 'shout', x: 1, y: 1, impulse: 5, range: 1.5 }],
      sockets: [
        { id: 'in', direction: 'input', kind: 'event', target: { objectId: 'chog', socket: 'trigger' } },
        { id: 'out', direction: 'output', kind: 'body', target: { objectId: 'chog', socket: 'shouted' } },
      ],
      controls: [{ id: 'impulse', objectId: 'chog', field: 'impulse', min: 0, max: 8, default: 5 }],
      props: [],
    });
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

  test('stores only admissible preview parts, keeps six newest, and leaves authoring settings untouched', async () => {
    const catalog = await PreviewCatalog.create(), base = catalog.get('shout');
    const data = new Map<string, string>();
    const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
    expect(await savePreviewPart(storage, base)).toBe(true);
    expect(await loadPreviewParts(storage)).toEqual([base]);
    expect(data.has(PART_DRAFT_KEY)).toBe(false);

    const altered = async (change: (content: PartContent) => void): Promise<PartVersion> => {
      const content = structuredClone(base.content);
      change(content);
      return { id: await contentId(content), content };
    };
    const badId = { ...base, id: `sha256:${'0'.repeat(64)}` };
    const wrongAuthor = await altered((content) => { content.author = '0x0000000000000000000000000000000000000002'; });
    const wrongPin = await altered((content) => { content.source.observedAt = '2025-01-01T00:00:00.000Z'; });
    const wrongKit = await altered((content) => { content.source = previewSourcePin('533'); });
    expect(await parsePreviewParts([badId, wrongAuthor, wrongPin, wrongKit])).toEqual([]);

    const versions = await Promise.all(Array.from({ length: PREVIEW_PART_LIMIT + 1 }, async (_, index) =>
      createPartVersion({ ...base.content, partId: `local-shout-${index}` }, resolvePreviewSource)));
    for (const version of versions) expect(await savePreviewPart(storage, version)).toBe(true);
    const saved = await loadPreviewParts(storage);
    expect(saved).toHaveLength(PREVIEW_PART_LIMIT);
    expect(saved.map((version) => version.id)).toEqual(versions.slice(1).map((version) => version.id));
    expect(data.has(PART_DRAFT_KEY)).toBe(false);
    expect(data.has(PREVIEW_PARTS_KEY)).toBe(true);

    const loaded = await catalog.addLocalPreviewPart(saved[0]);
    expect(await catalog.resolvePart(loaded.id)).toMatchObject({ version: loaded, origin: 'public-data-preview' });
    const machine = structuredClone(newMachineDraft(catalog));
    machine.parts.push({ id: 'local-preview', versionId: loaded.id, x: 6, y: 0, values: {} });
    await expect(catalog.validate(machine, 'publication')).rejects.toThrow(/Preview parts/);
  });

  test('published library rejects local preview IDs before lookup and never resolves them locally', async () => {
    const preview = await PreviewCatalog.create(), part = preview.get('shout');
    let lookups = 0;
    const lookup = async () => { lookups++; throw new Error('Unexpected backend lookup'); };
    const localLibrary = await MachineLibrary.create(lookup, 'preview');
    await localLibrary.addLocalPreviewPart(part);
    expect((await localLibrary.resolvePart(part.id)).origin).toBe('public-data-preview');
    const published = await MachineLibrary.create(lookup, 'published');
    await published.addLocalPreviewPart(part);
    await expect(published.loadPart(part.id)).rejects.toThrow(/Preview parts/);
    await expect(published.resolvePart(part.id)).rejects.toThrow(/Holder-published/);
    expect(lookups).toBe(0);
  });

  test('adds a local preview part at a free spot and leaves a full Build draft unchanged', async () => {
    const catalog = await PreviewCatalog.create(), data = new Map<string, string>();
    const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
    const added = await addPreviewPartToDraft(storage, catalog, catalog.get('shout'));
    expect(added.ok).toBe(true);
    const saved = await loadMachineDraft(storage, catalog);
    expect(saved.machine.scene.parts).toHaveLength(3);
    expect(saved.machine.scene.parts.find((part) => part.versionId === catalog.get('shout').id)).toMatchObject({ x: 0, y: 0 });

    const full = structuredClone(newMachineDraft(catalog));
    full.parts = Array.from({ length: PREVIEW_PART_LIMIT }, (_, index) => ({
      id: `local-${index}`, versionId: catalog.get('release').id, x: (index % 4) * 3, y: Math.floor(index / 4) * 3, values: {},
    }));
    full.connections = []; full.inputs = [];
    expect(await saveMachineDraft(storage, catalog, full)).toBe(true);
    const before = data.get(MACHINE_DRAFT_KEY);
    const rejected = await addPreviewPartToDraft(storage, catalog, catalog.get('shout'));
    expect(rejected).toMatchObject({ ok: false, message: expect.stringContaining('six parts') });
    expect(data.get(MACHINE_DRAFT_KEY)).toBe(before);
  });

  test('rolls back an evicted preview part when adding the new part fails validation', async () => {
    const catalog = await PreviewCatalog.create();
    const source = catalog.get('shout');
    const savedParts = await Promise.all(Array.from({ length: PREVIEW_PART_LIMIT }, (_, index) =>
      createPartVersion({ ...source.content, partId: `local-shout-${index}` }, resolvePreviewSource)));
    const version = await createPartVersion({ ...source.content, partId: 'local-shout-rejected' }, resolvePreviewSource);
    const { data, storage } = memoryStorage();
    data.set(PREVIEW_PARTS_KEY, JSON.stringify(savedParts));
    expect(await saveMachineDraft(storage, catalog, newMachineDraft(catalog))).toBe(true);
    const previousParts = data.get(PREVIEW_PARTS_KEY), previousDraft = data.get(MACHINE_DRAFT_KEY);

    const result = await placePreviewPartInDraft(storage, rejectingCatalog(version.id), version);

    expect(result).toEqual({ ok: false, message: 'This preview part would push your Build draft past its limits, so nothing was changed.' });
    expect(data.get(PREVIEW_PARTS_KEY)).toBe(previousParts);
    expect(data.get(MACHINE_DRAFT_KEY)).toBe(previousDraft);
  });

  test('restores an absent preview store after adding the new part fails validation', async () => {
    const catalog = await PreviewCatalog.create();
    const version = await createPartVersion({ ...catalog.get('shout').content, partId: 'local-shout-rejected' }, resolvePreviewSource);
    const { data, storage } = memoryStorage();
    expect(data.has(PREVIEW_PARTS_KEY)).toBe(false);

    const result = await placePreviewPartInDraft(storage, rejectingCatalog(version.id), version);

    expect(result.ok).toBe(false);
    expect(await loadPreviewParts(storage)).toEqual([]);
  });

  test('stores a preview part and adds it to the Build draft', async () => {
    const catalog = await PreviewCatalog.create();
    const version = await createPartVersion({ ...catalog.get('shout').content, partId: 'local-shout-success' }, resolvePreviewSource);
    const { storage } = memoryStorage();

    const result = await placePreviewPartInDraft(storage, () => PreviewCatalog.create(), version);

    expect(result.ok).toBe(true);
    expect((await loadPreviewParts(storage)).map((part) => part.id)).toContain(version.id);
    const updated = await PreviewCatalog.create();
    for (const part of await loadPreviewParts(storage)) await updated.addLocalPreviewPart(part);
    const draft = await loadMachineDraft(storage, updated);
    expect(draft.machine.scene.parts.map((part) => part.versionId)).toContain(version.id);
  });
});
