import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { Pool } from 'pg';
import { migrate } from '../scripts/migrate';
import { PostgresStore } from '../src/server/postgresStore';
import { databasePool } from '../src/server/database';
import { authResponse, digest } from '../src/server/walletAuth';
import { publicationResponse } from '../src/server/publicationRoute';
import { resolvePreviewSource } from '../src/domain/documents';
import { account, chain, key, origin, part, request, scene } from './backendFixtures';
import { authoredPart, newPartSettings } from '../src/domain/partAuthoring';
import { getPreview } from '../src/domain/chog';
import { previewSourcePin } from '../src/domain/documents';
import { MACHINE_ATTEMPT_KEY, prepareMachine, preparePart, publicationAttempt, publishMachine, publishPart, type MachineVersion, type PublicationContext } from '../src/ui/partPublication';
import { publicationSource } from '../src/server/holderSource';
import { MachineLibrary, machineCredits } from '../src/domain/machineLibrary';
import { discoveryResponse } from '../src/server/discoveryRoute';
import { discoveryUrl, parseDiscovery, type DiscoveryQuery } from '../src/domain/discovery';
import { canonicalJson, contentId } from '../src/domain/canonical';

const connection = process.env.CHOGMOG_TEST_DATABASE_URL;
if (process.env.CI === 'true' && !connection) throw new Error('CI must supply its isolated Postgres service');

describe.skipIf(!connection)('real Postgres integration, isolated CI database and synthetic chain only', () => {
  let pool: Pool, otherPool: Pool, store: PostgresStore, other: PostgresStore;
  beforeAll(async () => {
    pool = databasePool(connection!, true); otherPool = databasePool(connection!, true);
    store = new PostgresStore(pool); other = new PostgresStore(otherPool);
    await pool.query("create role anon; create role authenticated;");
    await migrate(pool); await migrate(otherPool);
  });
  afterAll(async () => { await Promise.all([pool?.end(), otherPool?.end()]); });

  test('T6 editor baseline for a non-fixture token publishes through the actual client/API/SQL path and reads back', async () => {
    const signer = account(), reader = chain(signer.address), id = key();
    const snapshot = { pin: { ...previewSourcePin('533'), nft: { ...previewSourcePin('533').nft, tokenId: '123' } }, metadata: getPreview('533').metadata };
    let sourceOnline = true;
    const resolver = publicationSource(async () => { if (!sourceOnline) throw new Error('Source gateway unavailable'); return snapshot; });
    const version = await authoredPart({ ...newPartSettings(), reuseAllowed: true }, signer.address, snapshot);
    const session = await store.start(signer.address, origin, Date.now()), cookie = `chogmog_session=${session.credential}`;
    const context: PublicationContext = {
      origin, active: () => true,
      wallet: { request: async ({ method, params }) => {
        if (method === 'eth_accounts') return [signer.address];
        if (method === 'eth_chainId') return '0x8f';
        if (method === 'personal_sign') return signer.signMessage({ message: String(params![0]) });
        throw new Error('Unexpected wallet method');
      } },
      api: async (path, method, body) => {
        const req = request(path, cookie, body, method);
        const reply = path === '/api/auth' ? await authResponse(req, other, origin) : await publicationResponse(req, other, other, reader, resolver, origin);
        const result = await reply.json() as Record<string, unknown>;
        if (!reply.ok) throw new Error(String(result.error));
        return result;
      },
    };
    const prepared = await preparePart(context, version, id);
    if (!('approval' in prepared)) throw new Error('Expected scoped approval');
    const saved = await publishPart(context, version, prepared.approval);
    expect(saved.id).toBe(version.id);
    expect((await store.version(saved.id))?.content).toEqual(version.content);
    reader.ownerOf = async () => account().address;
    expect(await preparePart(context, version, id)).toHaveProperty('published.id', saved.id);
    await expect(preparePart(context, version, key())).rejects.toThrow('owner');
    sourceOnline = false;
    expect(await preparePart(context, version, id)).toHaveProperty('published.id', saved.id);
  });

  async function harness() {
    const signer = account(), reader = chain(signer.address), content = part(signer.address), id = key();
    const session = await store.start(signer.address, origin, Date.now()), cookie = `chogmog_session=${session.credential}`;
    const call = (body: unknown, op = 'prepare', selected = other) => publicationResponse(request(`/api/publish?op=${op}`, cookie, body), selected, selected, reader, resolvePreviewSource, origin);
    const response = await call({ content, key: id }); expect(response.status).toBe(200);
    const p = await response.json() as { nonce: string; message: string; versionId: string };
    const body = { content, key: id, nonce: p.nonce, signature: await signer.signMessage({ message: p.message }) };
    return { signer, reader, content, id, session, cookie, call, p, body };
  }

  test('T11 bounded discovery uses exact versions, stable timestamp ties, search and no private fields', async () => {
    const h = await harness();
    await h.call(h.body, 'commit');
    const prefix = `browse-${key()}`;
    const publishedAt = '2026-10-18T00:00:00.123456Z';
    const ids: string[] = [];
    // Isolated SQL fixtures test tied timestamps. They are not genuine holder evidence.
    for (let i = 0; i < 15; i++) {
      const content = { ...h.content, partId: `${prefix}-${i}`, reuseAllowed: i !== 14 };
      const id = await contentId(content); ids.push(id);
      await pool.query('insert into chogmog.works (kind, id, author, nft) values ($1,$2,$3,$4)',
        ['part', content.partId, content.author, content.source.nft]);
      await pool.query(`insert into chogmog.versions (id,kind,work_id,author,content,canonical,ownership,published_at)
        values ($1,'part',$2,$3,$4,$5,$6,$7)`,
      [id, content.partId, content.author, content, canonicalJson(content), { isOwner: true }, publishedAt]);
    }
    const query: DiscoveryQuery = { kind: 'part', q: prefix, after: null };
    const call = async (selected: DiscoveryQuery) => {
      const response = await discoveryResponse(request(discoveryUrl(selected)), new PostgresStore(otherPool), origin);
      expect(response.status).toBe(200);
      return parseDiscovery(await response.json(), selected.kind);
    };
    const page = await call(query);
    expect(page.items).toHaveLength(12); expect(page.next).toBe(page.items.at(-1)!.id);
    const next = await call({ ...query, after: page.next });
    expect(next.items).toHaveLength(2); expect(next.next).toBeNull();
    expect([...page.items, ...next.items].map((v) => v.id)).toEqual(ids.slice(0, 14).sort().reverse());
    const summary = page.items[0];
    expect(Object.keys(summary).sort()).toEqual(['author', 'description', 'id', 'kind', 'publishedAt', 'tokenId', 'workId']);
    expect(summary.description).toBe('laser'); expect(summary.tokenId).toBe('533');
    expect((await store.version(summary.id))?.content.kind).toBe('part');
    expect((await call({ ...query, q: `${prefix}-14` })).items).toHaveLength(0);
    expect((await call({ ...query, q: "'); delete from chogmog.versions; --" })).items).toHaveLength(0);
    expect((await call({ ...query, q: '%' })).items).toHaveLength(0);
    expect((await call({ ...query, q: '_no_wildcard_' })).items).toHaveLength(0);
    expect((await call({ ...query, q: prefix, after: `sha256:${'f'.repeat(64)}` })).items).toHaveLength(0);
    expect((await call({ ...query, q: `${prefix}-0` })).items.map((v) => v.id)).toEqual([ids[0]]);
    const index = await pool.query("select indexname from pg_indexes where schemaname='chogmog' and indexname='versions_discovery'");
    expect(index.rowCount).toBe(1);
  });

  test('T11 API publication appears in discovery and durable remix lineage survives new pools and retry', async () => {
    const h = await harness();
    const source = await (await h.call(h.body, 'commit')).json();
    const creator = account(), session = await other.start(creator.address, origin, Date.now());
    const cookie = `chogmog_session=${session.credential}`;
    const save = async (content: unknown) => {
      const retry = key();
      const prepare = await publicationResponse(request('/api/publish?op=prepare', cookie, { content, key: retry }),
        other, other, h.reader, resolvePreviewSource, origin);
      expect(prepare.status).toBe(200);
      const approval = await prepare.json(), body = { content, key: retry, nonce: approval.nonce, signature: await creator.signMessage({ message: approval.message }) };
      const commit = () => publicationResponse(request('/api/publish?op=commit', cookie, body), store, store, h.reader, resolvePreviewSource, origin);
      const response = await commit(); expect(response.status).toBe(200);
      return { saved: await response.json(), commit };
    };
    const parent = await save(scene(source, creator.address));
    const library = await MachineLibrary.create(async (id, withSource) => {
      const response = await publicationResponse(request(`/api/versions?id=${encodeURIComponent(id)}${withSource ? '&source=1' : ''}`),
        other, other, h.reader, resolvePreviewSource, origin);
      return response.json();
    });
    const reopened = await library.reopen(parent.saved.id), content = { ...library.remix(reopened.machine), author: creator.address.toLowerCase() };
    const child = await save(content);
    expect(child.saved.content.remixOf).toBe(parent.saved.id);
    h.reader.ownerOf = async () => { throw new Error('No current-owner read for discovery or historical reuse'); };
    expect(await (await child.commit()).json()).toEqual(child.saved);
    const response = await discoveryResponse(request(discoveryUrl({ kind: 'machine', q: content.machineId, after: null })), new PostgresStore(otherPool), origin);
    expect(response.status).toBe(200);
    const discovered = parseDiscovery(await response.json(), 'machine');
    expect(discovered.items.map((item) => [item.id, item.remixOf])).toEqual([[child.saved.id, parent.saved.id]]);
    const restored = await library.reopen(discovered.items[0].id);
    expect(restored.machine.scene.remixOf).toBe(parent.saved.id);
    expect(restored.credits).toEqual([{ versionId: source.id, author: source.content.author }]);
    expect((await library.reopen(parent.saved.id)).machine.scene).toEqual(parent.saved.content);
    const parts = await store.discover({ kind: 'part', q: h.content.partId, after: null });
    expect(parts.items.map((item) => item.id)).toEqual([source.id]);
    const count = await pool.query('select count(*)::int n from chogmog.versions where id = $1', [child.saved.id]);
    expect(count.rows[0].n).toBe(1);
  });

  test('one nonce is consumed atomically across independent pools and failed verification cannot replay', async () => {
    const signer = account(), now = Date.now(), c = await store.issue(signer.address, origin, now);
    const takes = await Promise.all(Array.from({ length: 8 }, (_, i) => (i % 2 ? store : other).take(c.nonce, now)));
    expect(takes.filter(Boolean)).toHaveLength(1);
    const invalid = await store.issue(signer.address, origin, now);
    const payload = { nonce: invalid.nonce, message: invalid.message, signature: await account().signMessage({ message: invalid.message }) };
    expect((await authResponse(request('/api/auth?op=verify', undefined, payload), store, origin)).status).toBe(401);
    payload.signature = await signer.signMessage({ message: invalid.message });
    expect((await authResponse(request('/api/auth?op=verify', undefined, payload), other, origin)).status).toBe(401);
    const expired = await store.issue(signer.address, origin, now - 301_000);
    expect(await other.take(expired.nonce, now)).toBeNull();
  });

  test('sessions survive new server instances, bind origins, expire and revoke without storing credentials', async () => {
    const signer = account(), now = Date.now(), session = await store.start(signer.address, origin, now);
    expect((await new PostgresStore(otherPool).read(session.credential, origin, now))?.address).toBe(signer.address);
    expect(await other.read(session.credential, 'https://other.test', now)).toBeNull();
    expect(await other.read(session.credential, origin, now + 1_800_001)).toBeNull();
    const data = await pool.query('select hash, data from chogmog.sessions where hash = $1', [digest(session.credential)]);
    expect(JSON.stringify(data.rows).includes(session.credential)).toBe(false);
    await other.revoke(session.credential);
    expect(await store.read(session.credential, origin, now)).toBeNull();
  });

  test('signed API commit converges under concurrent retry and survives replacement pools', async () => {
    const h = await harness();
    const responses = await Promise.all(Array.from({ length: 8 }, (_, i) => h.call(h.body, 'commit', i % 2 ? store : other)));
    expect(responses.map((r) => r.status)).toEqual(Array(8).fill(200));
    const saved = await responses[0].json();
    for (const response of responses.slice(1)) expect(await response.json()).toEqual(saved);
    expect(await new PostgresStore(otherPool).version(saved.id)).toEqual(saved);
    const counts = await pool.query('select count(*)::int n from chogmog.versions where id = $1', [saved.id]);
    expect(counts.rows[0].n).toBe(1);
    const changed = { ...h.body, content: { ...h.content, reuseAllowed: false } };
    expect((await h.call(changed, 'commit')).status).toBe(409);
    await pool.query('delete from chogmog.publish_grants where hash = $1', [digest(h.p.nonce)]);
    expect(await (await h.call(h.body, 'commit')).json()).toEqual(saved);
    const data = await pool.query('select content, ownership from chogmog.versions where id = $1', [saved.id]);
    expect(JSON.stringify(data.rows).includes(h.body.signature)).toBe(false);
  });

  test('uncertain response recovers the original durable result without a duplicate', async () => {
    const h = await harness(), uncertain = Object.create(store) as PostgresStore;
    uncertain.commit = async (...args) => { await store.commit(...args); throw new Error('Simulated lost response'); };
    expect((await h.call(h.body, 'commit', uncertain)).status).toBe(503);
    const recovered = await h.call(h.body, 'commit'); expect(recovered.status).toBe(200);
    expect((await recovered.json()).id).toBe(h.p.versionId);
  });

  test('transaction rollback leaves the grant retryable and no half-written publication', async () => {
    const h = await harness(), grant = (await store.grant(h.p.nonce))!;
    const validated = await import('../src/domain/documents').then((d) => d.createPartVersion(h.content, resolvePreviewSource));
    const ownership = await import('../src/chain/genesisOwnership').then((d) => d.freshOwnership(h.reader, h.signer.address, '533', Date.now(), h.content.source));
    await expect(store.commit(h.p.nonce, grant, { ...validated, ownership, credits: [{ versionId: `sha256:${'a'.repeat(64)}`, author: h.content.author }] })).rejects.toThrow();
    expect(await other.version(validated.id)).toBeNull();
    expect(await other.receipt(h.signer.address, h.id)).toBeNull();
    const pending = await pool.query('select consumed from chogmog.publish_grants where hash = $1', [digest(h.p.nonce)]);
    expect(pending.rows[0].consumed).toBe(false);
    expect((await h.call(h.body, 'commit')).status).toBe(200);
  });

  test('database checks expiration and session revocation at commit', async () => {
    const h = await harness();
    await pool.query("update chogmog.publish_grants set expires_at = clock_timestamp() - interval '1 second' where hash = $1", [digest(h.p.nonce)]);
    expect((await h.call(h.body, 'commit')).status).toBe(401);
    expect(await store.version(h.p.versionId)).toBeNull();
    const revoked = await harness();
    revoked.reader.ownerOf = async () => { await other.revoke(revoked.session.credential); return revoked.signer.address; };
    expect((await revoked.call(revoked.body, 'commit')).status).toBe(401);
    expect(await store.version(revoked.p.versionId)).toBeNull();
  });

  test('former owner is rejected and old versions remain intact after transfer', async () => {
    const h = await harness();
    expect((await h.call(h.body, 'commit')).status).toBe(200);
    const saved = await store.version(h.p.versionId);
    h.reader.ownerOf = async () => account().address;
    expect((await h.call({ content: { ...h.content, reuseAllowed: false }, key: key() })).status).toBe(403);
    expect(await other.version(h.p.versionId)).toEqual(saved);
    const pending = await harness(); pending.reader.ownerOf = h.reader.ownerOf;
    expect((await pending.call(pending.body, 'commit')).status).toBe(403);
    expect(await store.version(pending.p.versionId)).toBeNull();
  });

  test('non-holder machine persistence preserves exact source credits once per version', async () => {
    const h = await harness();
    const source = await (await h.call(h.body, 'commit')).json();
    const creator = account(), session = await other.start(creator.address, origin, Date.now());
    const content = scene({ id: source.id, content: source.content }, creator.address), id = key(), cookie = `chogmog_session=${session.credential}`;
    const call = (body: unknown, op: string) => publicationResponse(request(`/api/publish?op=${op}`, cookie, body), store, store, chain(h.signer.address), resolvePreviewSource, origin);
    const prepared = await call({ content, key: id }, 'prepare'); expect(prepared.status).toBe(200);
    const p = await prepared.json(), body = { content, key: id, nonce: p.nonce, signature: await creator.signMessage({ message: p.message }) };
    const committed = await call(body, 'commit'); expect(committed.status).toBe(200);
    const saved = await committed.json();
    expect(saved.credits).toEqual([{ versionId: source.id, author: h.content.author }]);
    expect(await new PostgresStore(otherPool).version(saved.id)).toEqual(saved);
    expect(await (await call(body, 'commit')).json()).toEqual(saved);
    const copies = await pool.query('select count(*)::int n from chogmog.credits where machine_version = $1', [saved.id]);
    expect(copies.rows[0].n).toBe(1);
  });

  test('immutable database triggers and hash constraints reject direct mutation', async () => {
    const h = await harness(); await h.call(h.body, 'commit');
    await expect(pool.query("update chogmog.versions set author = '0x1111111111111111111111111111111111111111' where id = $1", [h.p.versionId])).rejects.toThrow(/immutable/);
    await expect(pool.query('delete from chogmog.versions where id = $1', [h.p.versionId])).rejects.toThrow(/immutable/);
    await expect(pool.query('update chogmog.receipts set key = $1 where version_id = $2', [key(), h.p.versionId])).rejects.toThrow(/immutable/);
    const saved = (await store.version(h.p.versionId))!;
    await expect(pool.query(`insert into chogmog.versions (id, kind, work_id, author, content, canonical, ownership)
      select $1, kind, work_id, author, content, canonical, ownership from chogmog.versions where id = $2`, [`sha256:${'b'.repeat(64)}`, saved.id])).rejects.toThrow();
    expect(await other.version(saved.id)).toEqual(saved);
  });

  test('T9 non-holder client signs a machine, recovers a lost SQL save response and reopens exact sources/credits through new pools', async () => {
    const h = await harness();
    const source = await (await h.call(h.body, 'commit')).json();
    const creator = account(), session = await other.start(creator.address, origin, Date.now());
    const cookie = `chogmog_session=${session.credential}`;
    h.reader.ownerOf = async () => { throw new Error('Historical reuse never needs a current owner check'); };
    const call = async (path: string, method?: string, body?: unknown, authenticated = true) => {
      const req = request(path, authenticated ? cookie : undefined, body, method);
      const replaced = new PostgresStore(otherPool);
      const reply = path === '/api/auth' ? await authResponse(req, replaced, origin) : await publicationResponse(req, replaced, replaced, h.reader, resolvePreviewSource, origin);
      const value = await reply.json() as Record<string, unknown>;
      if (!reply.ok) throw new Error(String(value.error));
      return value;
    };
    const lookup = (id: string, withSource?: boolean) => call(`/api/versions?id=${encodeURIComponent(id)}${withSource ? '&source=1' : ''}`, undefined, undefined, false);
    const library = await MachineLibrary.create(lookup);
    const machine = await library.validate(scene(source, creator.address), 'publication');
    const version: MachineVersion = { id: machine.id, content: machine.scene, credits: machineCredits(machine) };
    let signatures = 0;
    const context: PublicationContext = { origin, active: () => true, api: call,
      wallet: { request: async ({ method, params }) => {
        if (method === 'eth_accounts') return [creator.address];
        if (method === 'eth_chainId') return '0x8f';
        if (method === 'personal_sign') { signatures++; return creator.signMessage({ message: String(params![0]) }); }
        throw new Error('Forbidden wallet action');
      } },
    };
    const data = new Map<string, string>();
    const storage = { getItem: (id: string) => data.get(id) ?? null, setItem: (id: string, value: string) => { data.set(id, value); } };
    const attempt = publicationAttempt(storage, machine.id, undefined, MACHINE_ATTEMPT_KEY);
    const prepared = await prepareMachine(context, version, attempt.key);
    if (!('approval' in prepared)) throw new Error('Expected approval');
    expect(signatures).toBe(0);
    context.api = async (...args) => { const value = await call(...args); if (args[0].includes('op=commit')) throw new Error('Lost SQL response'); return value; };
    await expect(publishMachine(context, version, prepared.approval)).rejects.toThrow('Lost SQL response');
    context.api = call;
    const restoredKey = publicationAttempt(storage, machine.id, undefined, MACHINE_ATTEMPT_KEY);
    const recovered = await prepareMachine(context, version, restoredKey.key);
    expect(recovered).toHaveProperty('published.id', machine.id); expect(signatures).toBe(1);
    expect(restoredKey.key).toBe(attempt.key);
    const fresh = await MachineLibrary.create(lookup), reopened = await fresh.reopen(machine.id);
    expect(reopened.machine.scene).toEqual(machine.scene);
    expect(reopened.credits).toEqual([{ versionId: source.id, author: h.content.author }]);
    expect(reopened.machine.expanded[0].version.content).toEqual(source.content);
    const copies = await pool.query('select count(*)::int n from chogmog.credits where machine_version = $1', [machine.id]);
    expect(copies.rows[0].n).toBe(1);
    expect((await new PostgresStore(pool).version(machine.id))?.credits).toEqual(reopened.credits);
    expect(Object.keys(JSON.parse(data.get(MACHINE_ATTEMPT_KEY)!))).toEqual(['id', 'key']);
  });

  test('anonymous/authenticated database roles cannot read private state or mutate publications', async () => {
    for (const role of ['anon', 'authenticated']) {
      const db = await pool.connect();
      try {
        await db.query(`set role ${role}`);
        for (const table of ['auth_challenges', 'sessions', 'publish_grants', 'works', 'versions', 'credits', 'receipts', 'schema_migrations']) {
          await expect(db.query(`select * from chogmog.${table}`)).rejects.toThrow(/permission denied/);
          await expect(db.query(`delete from chogmog.${table}`)).rejects.toThrow(/permission denied/);
        }
      } finally { await db.query('reset role'); db.release(); }
    }
    const policies = await pool.query("select bool_and(relrowsecurity) enabled from pg_class where relnamespace = 'chogmog'::regnamespace and relkind = 'r'");
    expect(policies.rows[0].enabled).toBe(true);
  });
});
