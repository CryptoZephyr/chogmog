import { describe, expect, test, vi } from 'vitest';
import { createPartVersion, resolvePreviewSource } from '../src/domain/documents';
import { MachineLibrary, PUBLISHED_DRAFT_KEY, machineCredits } from '../src/domain/machineLibrary';
import { loadMachineDraft, newMachineDraft, saveMachineDraft } from '../src/domain/machineDraft';
import { MachinePreview } from '../src/game/machinePreview';
import { publicationResponse } from '../src/server/publicationRoute';
import type { PublicationStore, PublishedVersion, PublishGrant } from '../src/server/publicationStore';
import { authResponse, MemoryAuthStore } from '../src/server/walletAuth';
import { MACHINE_ATTEMPT_KEY, prepareMachine, publicationAttempt, publishMachine, type MachineVersion, type PublicationContext } from '../src/ui/partPublication';
import type { InjectedWallet } from '../src/ui/walletClient';
import { account, chain, key, origin, part, request, scene } from './backendFixtures';

// These API/store/chain fixtures prove application behavior, never genuine holder evidence.
async function harness() {
  const holder = account(), creator = account(), auth = new MemoryAuthStore();
  const reader = chain(holder.address);
  const ownerOf = vi.fn(reader.ownerOf); reader.ownerOf = ownerOf;
  const grants = new Map<string, PublishGrant>(), versions = new Map<string, PublishedVersion>(), receipts = new Map<string, PublishedVersion>();
  const store: PublicationStore = {
    prepare: async (nonce, grant) => { grants.set(nonce, grant); }, grant: async (nonce) => grants.get(nonce) ?? null,
    receipt: async (address, id) => receipts.get(`${address}:${id}`) ?? null, version: async (id) => versions.get(id) ?? null,
    commit: vi.fn(async (_nonce, grant, version) => {
      const saved = { ...version, publishedAt: new Date().toISOString() };
      versions.set(saved.id, saved); receipts.set(`${grant.address}:${grant.key}`, saved); return saved;
    }),
  };
  const holderSession = auth.start(holder.address, origin, Date.now());
  const holderCookie = `chogmog_session=${holderSession.credential}`;
  const call = async (path: string, cookie?: string, content?: unknown, method?: string) => {
    const req = request(path, cookie, content, method);
    const response = path === '/api/auth' ? await authResponse(req, auth, origin) : await publicationResponse(req, auth, store, reader, resolvePreviewSource, origin);
    const result = await response.json() as Record<string, unknown>;
    if (!response.ok) throw new Error(String(result.error));
    return result;
  };
  const content = part(holder.address), source = await createPartVersion(content, resolvePreviewSource), partKey = key();
  const approval = await call('/api/publish?op=prepare', holderCookie, { content, key: partKey });
  await call('/api/publish?op=commit', holderCookie, { content, key: partKey, nonce: approval.nonce, signature: await holder.signMessage({ message: String(approval.message) }) });
  const creatorSession = auth.start(creator.address, origin, Date.now()), creatorCookie = `chogmog_session=${creatorSession.credential}`;
  const api = vi.fn(async (path: string, method?: string, body?: unknown) => call(path, creatorCookie, body, method));
  const lookup = vi.fn((id: string, withSource?: boolean) => call(`/api/versions?id=${encodeURIComponent(id)}${withSource ? '&source=1' : ''}`));
  const library = await MachineLibrary.create(lookup);
  const machine = await library.validate(scene(source, creator.address), 'publication');
  const version: MachineVersion = { id: machine.id, content: machine.scene, credits: machineCredits(machine) };
  const wallet = { request: vi.fn<InjectedWallet['request']>(async ({ method, params }) => {
    if (method === 'eth_accounts') return [creator.address];
    if (method === 'eth_chainId') return '0x8f';
    if (method === 'personal_sign') return creator.signMessage({ message: String(params![0]) });
    throw new Error('Forbidden wallet action');
  }) };
  let active = true;
  const context: PublicationContext = { api, wallet, origin, active: () => active };
  const data = new Map<string, string>();
  const storage = { getItem: (id: string) => data.get(id) ?? null, setItem: (id: string, value: string) => { data.set(id, value); } };
  const attempt = publicationAttempt(storage, version.id, undefined, MACHINE_ATTEMPT_KEY);
  const prepare = async () => {
    const result = await prepareMachine(context, version, attempt.key);
    if (!('approval' in result)) throw new Error('Expected approval');
    return result.approval;
  };
  ownerOf.mockClear();
  return { holder, creator, reader, auth, creatorSession, creatorCookie, source, machine, version, library, lookup, api, context, wallet, store, versions, storage, data, attempt, prepare, call, deactivate: () => { active = false; } };
}

describe('T9 non-holder machine publication, actual client/API with explicit synthetic infrastructure', () => {
  test('loads exact reusable holder records without sign-in, reviews without signing and reads back credits', async () => {
    const h = await harness(), approval = await h.prepare();
    expect(h.lookup).toHaveBeenCalledWith(h.source.id, true);
    expect(h.wallet.request.mock.calls.some(([r]) => r.method === 'personal_sign')).toBe(false);
    expect(approval.message).toContain(`Publish Chogmog machine ${h.machine.scene.machineId}`);
    const saved = await publishMachine(h.context, h.version, approval);
    expect(saved.content).toEqual(h.machine.scene);
    expect(saved.credits).toEqual([{ versionId: h.source.id, author: h.holder.address.toLowerCase() }]);
    expect(h.reader.ownerOf).not.toHaveBeenCalled();
    expect(h.wallet.request.mock.calls.every(([r]) => ['eth_accounts', 'eth_chainId', 'personal_sign'].includes(r.method))).toBe(true);
    expect(h.api.mock.calls.some(([path]) => path.startsWith('/api/versions?id='))).toBe(true);
  });
  test('fresh library and replay preserve exact versions, original credits and reused permissions after NFT transfer', async () => {
    const h = await harness();
    await publishMachine(h.context, h.version, await h.prepare());
    h.reader.ownerOf = async () => { throw new Error('No current owner read permitted for historical reuse'); };
    const fresh = await MachineLibrary.create(h.lookup), reopened = await fresh.reopen(h.version.id);
    expect(reopened.machine.id).toBe(h.machine.id); expect(reopened.credits).toEqual(h.version.credits);
    expect(reopened.machine.expanded[0].version).toEqual(h.source);
    const run = await MachinePreview.create(reopened.machine.scene, fresh.resolvePart, fresh.resolveSource);
    run.step(120); const result = run.snapshot(); run.reset(); run.step(120);
    expect(run.snapshot()).toEqual(result); run.dispose();
    const retry = await prepareMachine(h.context, h.version, h.attempt.key);
    expect(retry).toHaveProperty('published.id', h.version.id);
  });
  test('uncertain commit recovers the same durable result with the same saved key and no extra signature', async () => {
    const h = await harness(), approval = await h.prepare(), original = h.context.api;
    h.context.api = async (...args) => { const result = await original(...args); if (args[0].includes('op=commit')) throw new Error('Lost response'); return result; };
    await expect(publishMachine(h.context, h.version, approval)).rejects.toThrow('Lost response');
    h.context.api = original;
    const attempt = publicationAttempt(h.storage, h.version.id, undefined, MACHINE_ATTEMPT_KEY);
    expect(attempt.key).toBe(h.attempt.key);
    expect(await prepareMachine(h.context, h.version, attempt.key)).toHaveProperty('published.id', h.version.id);
    expect(h.wallet.request.mock.calls.filter(([r]) => r.method === 'personal_sign')).toHaveLength(1);
    expect(h.versions.size).toBe(2);
    expect(Object.keys(JSON.parse(h.data.get(MACHINE_ATTEMPT_KEY)!))).toEqual(['id', 'key']);
    expect([...h.data.values()].join('')).not.toMatch(/signature|nonce|message|credential|session/);
  });
  test('signature rejection and expired sessions never commit and keep retry/draft data', async () => {
    const h = await harness(), approval = await h.prepare();
    const original = h.wallet.request.getMockImplementation()!;
    h.wallet.request.mockImplementation((args) => args.method === 'personal_sign' ? Promise.reject(new Error('Rejected')) : original(args));
    await expect(publishMachine(h.context, h.version, approval)).rejects.toThrow('cancelled');
    expect(h.versions.size).toBe(1);
    await h.auth.revoke(h.creatorSession.credential);
    await expect(publishMachine(h.context, h.version, approval)).rejects.toThrow('Session');
    expect(h.versions.size).toBe(1);
    expect(publicationAttempt(h.storage, h.version.id, undefined, MACHINE_ATTEMPT_KEY).key).toBe(h.attempt.key);
  });
  test('draft/unmount, account and chain changes during signature cannot commit the stale review', async () => {
    for (const change of ['draft', 'account', 'chain']) {
      const h = await harness(), approval = await h.prepare(), original = h.wallet.request.getMockImplementation()!;
      let signed = false;
      h.wallet.request.mockImplementation(async (args) => {
        if (args.method === 'personal_sign') { signed = true; if (change === 'draft') h.deactivate(); }
        if (signed && change === 'account' && args.method === 'eth_accounts') return [h.holder.address];
        if (signed && change === 'chain' && args.method === 'eth_chainId') return '0x1';
        return original(args);
      });
      await expect(publishMachine(h.context, h.version, approval)).rejects.toThrow();
      expect(h.versions.size).toBe(1);
    }
  });
  test('forged scope, mismatched readback credits and missing registry versions fail closed', async () => {
    const h = await harness(), original = h.context.api;
    h.context.api = async (...args) => {
      const result = await original(...args);
      return args[0].includes('op=prepare') ? { ...result, message: String(result.message).replace('Publish Chogmog machine', 'Publish Chogmog part') } : result;
    };
    await expect(h.prepare()).rejects.toThrow('does not match');
    h.context.api = original;
    const approval = await h.prepare();
    h.context.api = async (...args) => {
      const result = await original(...args);
      return args[0].startsWith('/api/versions?') ? { ...result, credits: [{ versionId: h.source.id, author: h.creator.address }] } : result;
    };
    await expect(publishMachine(h.context, h.version, approval)).rejects.toThrow('credits');
    h.context.api = original;
    h.versions.delete(h.source.id);
    await expect(prepareMachine(h.context, h.version, key())).rejects.toThrow('Published source required');
  });
  test('unknown, preview, altered, non-reusable and source-mismatched versions cannot become published library entries', async () => {
    const h = await harness();
    await expect(h.library.loadPart('https://outside.test')).rejects.toThrow('exact');
    const preview = h.library.get('laser');
    await expect(h.library.loadPart(preview.id)).rejects.toThrow('Preview parts');
    const response = await h.lookup(h.source.id, true);
    const modified = structuredClone(response) as { version: PublishedVersion; source: { pin: unknown } };
    modified.version.content.author = h.creator.address.toLowerCase();
    const changed = await MachineLibrary.create(async () => modified);
    await expect(changed.loadPart(h.source.id)).rejects.toThrow('Exact reusable');
    const noReuse = structuredClone(response) as { version: PublishedVersion };
    if (noReuse.version.content.kind === 'part') noReuse.version.content.reuseAllowed = false;
    await expect((await MachineLibrary.create(async () => noReuse)).loadPart(h.source.id)).rejects.toThrow();
    const sourceMismatch = structuredClone(response) as { source: { pin: { artworkSha256: string } } };
    sourceMismatch.source.pin.artworkSha256 = 'a'.repeat(64);
    await expect((await MachineLibrary.create(async () => sourceMismatch)).loadPart(h.source.id)).rejects.toThrow('pin mismatch');
    const unverified = structuredClone(response) as { version: PublishedVersion };
    unverified.version.ownership = null;
    await expect((await MachineLibrary.create(async () => unverified)).loadPart(h.source.id)).rejects.toThrow('Holder-published');
    const raw = await publicationResponse(request(`/api/versions?id=${h.source.id}&source=0`), h.auth, h.store, h.reader, resolvePreviewSource, origin);
    expect(raw.status).toBe(400);
  });
  test('preview scenes and hidden controls cannot publish, even with forged client flags', async () => {
    const h = await harness(), preview = newMachineDraft(h.library);
    await expect(h.library.validate(preview, 'publication')).rejects.toThrow('Preview');
    await expect(h.call('/api/publish?op=prepare', h.creatorCookie, { content: { ...preview, author: h.creator.address.toLowerCase() }, key: key() })).rejects.toThrow('Published source required');
    const hidden = structuredClone(h.machine.scene); hidden.parts[0].values.hidden = 1;
    await expect(h.library.validate(hidden, 'publication')).rejects.toThrow('Unexposed');
    await expect(h.library.validate({ ...h.machine.scene, holderVerified: true } as never)).rejects.toThrow();
  });
  test('separate local draft reload re-resolves published sources and does not overwrite on invalid or unavailable input', async () => {
    const h = await harness();
    expect(await saveMachineDraft(h.storage, h.library, h.machine.scene, PUBLISHED_DRAFT_KEY)).toBe(true);
    const raw = h.data.get(PUBLISHED_DRAFT_KEY);
    const fresh = await MachineLibrary.create(h.lookup);
    const restored = await loadMachineDraft(h.storage, fresh, () => fresh.newPublishedDraft(), PUBLISHED_DRAFT_KEY);
    expect(restored.machine.id).toBe(h.machine.id); expect(restored.recovered).toBe(true);
    const invalid = structuredClone(h.machine.scene); invalid.parts[0].values.hidden = 1;
    expect(await saveMachineDraft(h.storage, fresh, invalid, PUBLISHED_DRAFT_KEY)).toBe(false);
    expect(h.data.get(PUBLISHED_DRAFT_KEY)).toBe(raw);
    const unavailable = await MachineLibrary.create(async () => { throw new Error('503'); });
    expect((await loadMachineDraft(h.storage, unavailable, () => unavailable.newPublishedDraft(), PUBLISHED_DRAFT_KEY)).recovered).toBe(false);
    expect(h.data.get(PUBLISHED_DRAFT_KEY)).toBe(raw);
    const denied = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
    expect(publicationAttempt(denied, h.version.id, h.attempt, MACHINE_ATTEMPT_KEY)).toMatchObject({ key: h.attempt.key, saved: false });
    expect(await saveMachineDraft(denied, fresh, h.machine.scene, PUBLISHED_DRAFT_KEY)).toBe(false);
  });
  test('source lookup coalesces concurrent requests and failed lookups stay retryable', async () => {
    const h = await harness(), fresh = await MachineLibrary.create(h.lookup);
    h.lookup.mockClear();
    expect(await Promise.all([fresh.loadPart(h.source.id), fresh.loadPart(h.source.id)])).toEqual([h.source, h.source]);
    expect(h.lookup).toHaveBeenCalledTimes(1);
    let available = false;
    const recovered = await MachineLibrary.create((...args) => available ? h.lookup(...args) : Promise.reject(new Error('503')));
    await expect(recovered.loadPart(h.source.id)).rejects.toThrow('503');
    available = true;
    expect(await recovered.loadPart(h.source.id)).toEqual(h.source);
  });

  test('published-only loading, resolution, edits and draft recovery never admit public previews', async () => {
    const h = await harness(), published = await MachineLibrary.create(h.lookup);
    await saveMachineDraft(h.storage, published, h.machine.scene, PUBLISHED_DRAFT_KEY);
    const saved = h.data.get(PUBLISHED_DRAFT_KEY);
    h.lookup.mockClear();
    for (const preview of published.previews.entries.values()) {
      await expect(published.loadPart(preview.id)).rejects.toThrow(/Preview parts/);
      await expect(published.resolvePart(preview.id)).rejects.toThrow(/Holder-published/);
      const changed = structuredClone(h.machine.scene);
      changed.parts.push({ id: 'preview', versionId: preview.id, x: 0, y: 0, values: {} });
      await expect(published.validate(changed)).rejects.toThrow(/Preview parts/);
      expect(await saveMachineDraft(h.storage, published, changed, PUBLISHED_DRAFT_KEY)).toBe(false);
      expect(h.data.get(PUBLISHED_DRAFT_KEY)).toBe(saved);
    }
    expect(h.lookup).not.toHaveBeenCalled();
    const contaminated = JSON.stringify(newMachineDraft(published));
    h.data.set(PUBLISHED_DRAFT_KEY, contaminated);
    const recovered = await loadMachineDraft(h.storage, published, () => published.newPublishedDraft(), PUBLISHED_DRAFT_KEY);
    expect(recovered.recovered).toBe(false); expect(recovered.machine.scene.parts).toEqual([]);
    expect(h.data.get(PUBLISHED_DRAFT_KEY)).toBe(contaminated);
    const previews = await MachineLibrary.create(h.lookup, 'preview');
    expect((await previews.validate(newMachineDraft(previews))).scene.parts).toHaveLength(2);
    expect((await previews.resolvePart(previews.get('laser').id)).origin).toBe('public-data-preview');
    await expect(previews.validate(newMachineDraft(previews), 'publication')).rejects.toThrow(/Preview parts/);
  });
});
