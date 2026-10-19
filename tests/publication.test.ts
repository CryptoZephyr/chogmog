import { describe, expect, test, vi } from 'vitest';
import { AuthError, MemoryAuthStore } from '../src/server/walletAuth';
import { publicationResponse } from '../src/server/publicationRoute';
import type { PublicationStore, PublishedVersion, PublishGrant } from '../src/server/publicationStore';
import { backendConfiguration } from '../src/server/backend';
import { databasePool } from '../src/server/database';
import { resolvePreviewSource } from '../src/domain/documents';
import { account, chain, key, origin, part, request, scene } from './backendFixtures';

async function harness() {
  const signer = account(), auth = new MemoryAuthStore(), reader = chain(signer.address);
  const { credential } = auth.start(signer.address, origin, Date.now()), cookie = `chogmog_session=${credential}`;
  const grants = new Map<string, PublishGrant>(), versions = new Map<string, PublishedVersion>(), receipts = new Map<string, PublishedVersion>();
  const store: PublicationStore = {
    prepare: vi.fn(async (nonce, grant) => { grants.set(nonce, grant); }),
    grant: vi.fn(async (nonce) => grants.get(nonce) ?? null),
    receipt: vi.fn(async (author, id) => receipts.get(`${author.toLowerCase()}:${id}`) ?? null),
    version: vi.fn(async (id) => versions.get(id) ?? null),
    commit: vi.fn(async (nonce, grant, version) => {
      if (!auth.read(credential, origin, Date.now())) throw new AuthError(401, 'Sign-in required');
      grants.delete(nonce);
      const result = { ...version, publishedAt: new Date().toISOString() };
      versions.set(version.id, result); receipts.set(`${grant.address.toLowerCase()}:${grant.key}`, result);
      return result;
    }),
  };
  const call = (body: unknown, op = 'prepare', selectedCookie = cookie) => publicationResponse(request(`/api/publish?op=${op}`, selectedCookie, body), auth, store, reader, resolvePreviewSource, origin);
  const content = part(signer.address), id = key();
  const sign = async (value: unknown = content) => {
    const response = await call({ content: value, key: id }); expect(response.status).toBe(200);
    const prepared = await response.json() as { nonce: string; message: string; versionId: string };
    return { content: value, key: id, nonce: prepared.nonce, signature: await signer.signMessage({ message: prepared.message }) };
  };
  return { signer, auth, store, grants, versions, reader, credential, cookie, content, id, call, sign };
}

describe('publication API with synthetic chain and test store', () => {
  test('binds exact content separately from sign-in and supports immutable readback/retry', async () => {
    const h = await harness(), body = await h.sign();
    expect(h.grants.get(body.nonce)!.message).toContain(`urn:chogmog:idempotency:${h.id}`);
    expect(h.versions.size).toBe(0);
    const response = await h.call(body, 'commit'); expect(response.status).toBe(200);
    const saved = await response.json();
    expect(saved.ownership.isOwner).toBe(true);
    expect(await (await h.call(body, 'commit')).json()).toEqual(saved);
    const read = await publicationResponse(request(`/api/versions?id=${saved.id}`), h.auth, h.store, h.reader, resolvePreviewSource, origin);
    expect(await read.json()).toEqual(saved);
    expect(h.store.commit).toHaveBeenCalledTimes(1);
  });
  test('rejects changed content, author, signer, key, origin, extra fields and expired grants', async () => {
    const h = await harness(), body = await h.sign();
    expect((await h.call({ ...body, content: { ...h.content, reuseAllowed: false } }, 'commit')).status).toBe(401);
    expect((await h.call({ content: { ...h.content, author: account().address }, key: h.id })).status).toBe(403);
    expect((await h.call({ ...body, key: key() }, 'commit')).status).toBe(401);
    expect((await h.call({ ...body, signature: await account().signMessage({ message: h.grants.get(body.nonce)!.message }) }, 'commit')).status).toBe(401);
    expect((await h.call({ ...body, kit: ['laser'] }, 'commit')).status).toBe(400);
    const cross = new Request('https://evil.test/api/publish?op=commit', { method: 'POST', headers: { Origin: 'https://evil.test' }, body: '{}' });
    expect((await publicationResponse(cross, h.auth, h.store, h.reader, resolvePreviewSource, origin)).status).toBe(403);
    h.grants.get(body.nonce)!.expiresAt = Date.now() - 1;
    expect((await h.call(body, 'commit')).status).toBe(401);
    expect(h.store.commit).not.toHaveBeenCalled();
  });
  test('rejects non-owner, transfer after prepare, stale chain and revoked sessions', async () => {
    const h = await harness(), body = await h.sign();
    h.reader.ownerOf = async () => account().address;
    expect((await h.call(body, 'commit')).status).toBe(403);
    expect((await h.call({ content: h.content, key: key() })).status).toBe(403);
    h.reader.ownerOf = async () => h.signer.address;
    h.reader.block = async () => ({ number: 100n, hash: `0x${'a'.repeat(64)}`, timestamp: 0n });
    expect((await h.call(body, 'commit')).status).toBe(503);
    h.auth.revoke(h.credential);
    expect((await h.call(body, 'commit')).status).toBe(401);
    expect(h.store.commit).not.toHaveBeenCalled();
  });
  test('rejects session revocation during chain I/O without saving', async () => {
    const h = await harness(), body = await h.sign();
    h.reader.ownerOf = async () => { h.auth.revoke(h.credential); return h.signer.address; };
    expect((await h.call(body, 'commit')).status).toBe(401);
    expect(h.versions.size).toBe(0);
  });
  test('permits non-holder machines with original source credits, rejects missing/preview sources', async () => {
    const h = await harness();
    const source = await (await h.call(await h.sign(), 'commit')).json();
    const author = account(), session = h.auth.start(author.address, origin, Date.now());
    const content = scene({ id: source.id, content: source.content }, author.address), id = key(), cookie = `chogmog_session=${session.credential}`;
    const prepared = await h.call({ content, key: id }, 'prepare', cookie); expect(prepared.status).toBe(200);
    const p = await prepared.json();
    const saved = await h.call({ content, key: id, nonce: p.nonce, signature: await author.signMessage({ message: p.message }) }, 'commit', cookie);
    expect(saved.status).toBe(200);
    expect((await saved.json()).credits).toEqual([{ versionId: source.id, author: h.content.author }]);
    source.ownership = null; h.versions.set(source.id, source);
    expect((await h.call({ content, key: key() }, 'prepare', cookie)).status).toBe(403);
  });
  test('rejects source overrides, scripts and key conflicts, preserves work on storage failure', async () => {
    const h = await harness();
    expect((await h.call({ content: { ...h.content, source: { ...h.content.source, metadataSha256: 'a'.repeat(64) } }, key: key() })).status).toBe(400);
    expect((await h.call({ content: { ...h.content, scripts: ['evil'] }, key: key() })).status).toBe(400);
    expect((await h.call(await h.sign(), 'commit')).status).toBe(200);
    expect((await h.call({ content: { ...h.content, reuseAllowed: false }, key: h.id })).status).toBe(409);
    vi.mocked(h.store.prepare).mockRejectedValueOnce(new Error('private database error'));
    const response = await h.call({ content: h.content, key: key() });
    expect(response.status).toBe(503); expect(await response.text()).not.toContain('private database');
    expect(h.versions.size).toBe(1);
  });
  test('bounds HTTP input and exposes no grants in version reads', async () => {
    const h = await harness(); await h.sign();
    const call = (req: Request) => publicationResponse(req, h.auth, h.store, h.reader, resolvePreviewSource, origin);
    expect((await call(request('/api/publish?op=prepare', h.cookie, { content: 'a'.repeat(70_000), key: h.id }))).status).toBe(413);
    expect((await call(new Request(`${origin}/api/publish?op=prepare`, { method: 'POST', headers: { Origin: origin, Cookie: h.cookie }, body: '{}' }))).status).toBe(415);
    expect((await call(request(`/api/versions?id=sha256:${'a'.repeat(64)}`))).status).toBe(404);
    expect((await call(request('/api/versions?nonce=secret'))).status).toBe(400);
    expect((await call(request('/api/publish/extra?op=prepare', h.cookie, {}))).status).toBe(404);
  });

  test('exact receipt recovery works without source gateways or RPC, never creating a new grant or publication', async () => {
    const h = await harness(), body = await h.sign();
    const saved = await (await h.call(body, 'commit')).json();
    const unavailable = vi.fn(async () => { throw new Error('Gateway unavailable'); });
    h.reader.ownerOf = async () => { throw new Error('RPC unavailable'); };
    const retry = (value: unknown, op = 'prepare', cookie = h.cookie) => publicationResponse(request(`/api/publish?op=${op}`, cookie, value), h.auth, h.store, h.reader, unavailable, origin);
    const prepared = await retry({ content: h.content, key: h.id });
    expect(prepared.status).toBe(200); expect(await prepared.json()).toEqual({ published: saved });
    expect(await (await retry(body, 'commit')).json()).toEqual(saved);
    expect(unavailable).not.toHaveBeenCalled(); expect(h.store.commit).toHaveBeenCalledTimes(1);
    expect((await retry({ content: h.content, key: key() })).status).toBe(400);
    expect((await retry({ content: { ...h.content, reuseAllowed: false }, key: h.id })).status).toBe(409);
    const stranger = h.auth.start(account().address, origin, Date.now());
    expect((await retry({ content: h.content, key: h.id }, 'prepare', `chogmog_session=${stranger.credential}`)).status).not.toBe(200);
    h.auth.revoke(h.credential);
    expect((await retry(body, 'commit')).status).toBe(401);
  });
});

test('hosted activation never uses generic secrets or unsafe origins/TLS', () => {
  expect(() => backendConfiguration({ DATABASE_URL: 'must-not-use' })).toThrow();
  for (const APP_ORIGIN of ['http://chogmog.test', 'https://chogmog.test/', 'https://user@chogmog.test']) {
    expect(() => backendConfiguration({ APP_ORIGIN, CHOGMOG_BACKEND_ENABLED: 'true', CHOGMOG_DATABASE_URL: 'dedicated' })).toThrow();
  }
  for (const url of ['postgres://user:password@untrusted.example/db?sslmode=verify-full', 'postgres://user:password@db.test.supabase.co/db?sslmode=no-verify']) {
    expect(() => databasePool(url)).toThrow();
  }
});
