import { describe, expect, test, vi } from 'vitest';
import { authoredPart, newPartSettings, savePartSettings } from '../src/domain/partAuthoring';
import { getPreview } from '../src/domain/chog';
import { previewSourcePin, resolvePreviewSource } from '../src/domain/documents';
import { preparePart, publicationAttempt, publishPart, ATTEMPT_KEY, type PublicationContext } from '../src/ui/partPublication';
import type { InjectedWallet, Api } from '../src/ui/walletClient';
import { publicationResponse } from '../src/server/publicationRoute';
import type { PublicationStore, PublishedVersion, PublishGrant } from '../src/server/publicationStore';
import { MemoryAuthStore, AuthError } from '../src/server/walletAuth';
import { account, chain, origin, request } from './backendFixtures';

async function harness() {
  const signer = account(), auth = new MemoryAuthStore(), reader = chain(signer.address);
  const { credential, expiresAt } = auth.start(signer.address, origin, Date.now()), cookie = `chogmog_session=${credential}`;
  const grants = new Map<string, PublishGrant>(), versions = new Map<string, PublishedVersion>(), receipts = new Map<string, PublishedVersion>();
  const store: PublicationStore = {
    prepare: async (nonce, grant) => { grants.set(nonce, grant); }, grant: async (nonce) => grants.get(nonce) ?? null,
    receipt: async (_address, key) => receipts.get(key) ?? null, version: async (id) => versions.get(id) ?? null,
    commit: vi.fn(async (_nonce, grant, value) => {
      if (!auth.read(credential, origin, Date.now())) throw new AuthError(401, 'Sign-in required');
      const saved = { ...value, publishedAt: new Date().toISOString() };
      versions.set(value.id, saved); receipts.set(grant.key, saved); return saved;
    }),
  };
  const settings = { ...newPartSettings(), reuseAllowed: true };
  const version = await authoredPart(settings, signer.address, { pin: previewSourcePin('533'), metadata: getPreview('533').metadata });
  let active = true;
  const api = vi.fn<Api>(async (path, method, value) => {
    if (path === '/api/auth') return { address: auth.read(credential, origin, Date.now())?.address ?? null, expiresAt: new Date(expiresAt).toISOString() };
    const reply = await publicationResponse(request(path, cookie, value, method), auth, store, reader, resolvePreviewSource, origin);
    const body = await reply.json() as Record<string, unknown>;
    if (!reply.ok) throw new Error(String(body.error));
    return body;
  });
  const wallet = { request: vi.fn<InjectedWallet['request']>(async ({ method, params }) => {
    if (method === 'eth_accounts') return [signer.address];
    if (method === 'eth_chainId') return '0x8f';
    if (method === 'personal_sign') return signer.signMessage({ message: String(params![0]) });
    throw new Error('Forbidden wallet method');
  }) };
  const context: PublicationContext = { api, wallet, origin, active: () => active };
  const storageData = new Map<string, string>();
  const storage = { getItem: (k: string) => storageData.get(k) ?? null, setItem: (k: string, v: string) => { storageData.set(k, v); } };
  const attempt = publicationAttempt(storage, version.id);
  const approval = async () => {
    const p = await preparePart(context, version, attempt.key);
    if (!('approval' in p)) throw new Error('Expected approval');
    return p.approval;
  };
  return { context, wallet, api, version, settings, storage, storageData, attempt, approval, store, reader, auth, credential, grants, versions, deactivate: () => { active = false; } };
}

describe('holder editor publication client against actual API, synthetic ownership and storage', () => {
  test('reviews without signing, signs only a scoped message, then reads back the exact immutable version', async () => {
    const h = await harness(), approval = await h.approval();
    expect(h.wallet.request.mock.calls.some(([r]) => r.method === 'personal_sign')).toBe(false);
    const saved = await publishPart(h.context, h.version, approval);
    expect(saved.id).toBe(h.version.id); expect(saved.content).toEqual(h.version.content);
    expect(h.api.mock.calls.some(([path]) => path.startsWith('/api/versions?id='))).toBe(true);
    expect(h.wallet.request.mock.calls.map(([r]) => r.method)).not.toEqual(expect.arrayContaining(['eth_sendTransaction', 'eth_signTransaction', 'wallet_sendCalls']));
    expect(h.store.commit).toHaveBeenCalledTimes(1);
  });
  test('same key survives a fresh client and uncertain commit response without another signature or duplicate save', async () => {
    const h = await harness(), approval = await h.approval();
    const api = h.context.api;
    h.context.api = async (...args) => {
      const value = await api(...args);
      if (args[0].includes('op=commit')) throw new Error('Response lost');
      return value;
    };
    await expect(publishPart(h.context, h.version, approval)).rejects.toThrow('Response lost');
    expect(h.versions.size).toBe(1);
    expect(publicationAttempt(h.storage, h.version.id).key).toBe(h.attempt.key);
    h.context.api = api;
    const recovered = await preparePart(h.context, h.version, h.attempt.key);
    expect(recovered).toHaveProperty('published.id', h.version.id);
    expect(h.store.commit).toHaveBeenCalledTimes(1);
    expect(h.wallet.request.mock.calls.filter(([r]) => r.method === 'personal_sign')).toHaveLength(1);
    expect([...h.storageData.values()].join()).not.toMatch(/signature|nonce|message|credential|session/);
  });
  test('changed content gets a new key, malformed stored state and denied storage recover safely', async () => {
    const h = await harness();
    expect(publicationAttempt(h.storage, `sha256:${'a'.repeat(64)}`, h.attempt).key).not.toBe(h.attempt.key);
    h.storageData.set(ATTEMPT_KEY, '{bad');
    expect(publicationAttempt(h.storage, h.version.id).saved).toBe(true);
    const denied = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
    const inTab = publicationAttempt(denied, h.version.id);
    expect(inTab.saved).toBe(false); expect(publicationAttempt(denied, h.version.id, inTab).key).toBe(inTab.key);
    expect(savePartSettings(h.storage, h.settings)).toBe(true);
  });
  test('wallet rejection keeps settings and retry identity, and never sends a commit', async () => {
    const h = await harness(), p = await h.approval();
    h.wallet.request.mockImplementation(async ({ method }) => {
      if (method === 'eth_accounts') return [h.version.content.author]; if (method === 'eth_chainId') return '0x8f'; throw new Error('Rejected');
    });
    await expect(publishPart(h.context, h.version, p)).rejects.toThrow('cancelled');
    expect(h.store.commit).not.toHaveBeenCalled();
    expect(publicationAttempt(h.storage, h.version.id).key).toBe(h.attempt.key);
    expect(savePartSettings(h.storage, h.settings)).toBe(true);
  });
  test('draft, wallet or chain change while signing cannot send the stale commit', async () => {
    for (const change of ['draft', 'account', 'chain']) {
      const h = await harness(), p = await h.approval(), original = h.wallet.request.getMockImplementation()!;
      let signed = false;
      h.wallet.request.mockImplementation(async (args) => {
        const value = await original(args);
        if (args.method === 'personal_sign') { signed = true; if (change === 'draft') h.deactivate(); }
        if (signed && change === 'account' && args.method === 'eth_accounts') return [account().address];
        if (signed && change === 'chain' && args.method === 'eth_chainId') return '0x1';
        return value;
      });
      await expect(publishPart(h.context, h.version, p)).rejects.toThrow();
      expect(h.store.commit).not.toHaveBeenCalled();
    }
  });
  test('wrong session, no reusable permission, missing owner, transfer and expired grants are denied', async () => {
    const h = await harness(), p = await h.approval();
    h.reader.ownerOf = async () => account().address;
    await expect(publishPart(h.context, h.version, p)).rejects.toThrow('owner');
    await expect(preparePart(h.context, h.version, h.attempt.key)).rejects.toThrow('owner');
    h.reader.ownerOf = async () => h.version.content.author as `0x${string}`;
    await expect(publishPart(h.context, h.version, { ...p, expiresAt: new Date(0).toISOString() })).rejects.toThrow('expired');
    h.auth.revoke(h.credential);
    await expect(preparePart(h.context, h.version, h.attempt.key)).rejects.toThrow('Session expired');
    await expect(preparePart(h.context, { ...h.version, content: { ...h.version.content, reuseAllowed: false } }, h.attempt.key)).rejects.toThrow('permission');
    expect(h.store.commit).not.toHaveBeenCalled();
  });
  test('server message scope substitution never reaches personal_sign', async () => {
    for (const modify of [(s: string) => s.replace(origin, 'https://evil.test'), (s: string) => s.replace('Chain ID: 143', 'Chain ID: 1'),
      (s: string) => s.replace('No transaction, payment or NFT approval.', 'Send funds.'), (s: string) => s.replace('urn:chogmog:sha256:', 'urn:fake:sha256:')]) {
      const h = await harness(), api = h.context.api;
      h.context.api = async (...args) => {
        const r = await api(...args); return typeof r.message === 'string' ? { ...r, message: modify(r.message) } : r;
      };
      await expect(preparePart(h.context, h.version, h.attempt.key)).rejects.toThrow('does not match');
      expect(h.wallet.request.mock.calls.some(([r]) => r.method === 'personal_sign')).toBe(false);
    }
  });
  test('readback failure or altered persisted content cannot become a successful UI result', async () => {
    for (const mode of ['offline', 'changed']) {
      const h = await harness(), p = await h.approval(), api = h.context.api;
      h.context.api = async (...args) => {
        const r = await api(...args);
        if (args[0].startsWith('/api/versions')) {
          if (mode === 'offline') throw new Error('Storage unavailable');
          return { ...r, content: { ...h.version.content, reuseAllowed: false } };
        }
        return r;
      };
      await expect(publishPart(h.context, h.version, p)).rejects.toThrow();
      expect(h.versions.size).toBe(1);
      h.context.api = api;
      expect(await preparePart(h.context, h.version, h.attempt.key)).toHaveProperty('published.id', h.version.id);
    }
  });
});
