import type { Pool, PoolClient } from 'pg';
import type { Address } from 'viem';
import { canonicalJson } from '../domain/canonical.ts';
import { AuthError, digest, newChallenge, newSession, type AuthStore, type Challenge, type Session } from './walletAuth.ts';
import type { PublicationStore, PublishedVersion, PublishGrant } from './publicationStore.ts';
import { DISCOVERY_PAGE_SIZE, type DiscoveryPage, type DiscoveryQuery, type WorkSummary } from '../domain/discovery.ts';
import type { DiscoveryStore } from './discoveryRoute.ts';

type Queryable = Pick<PoolClient, 'query'>;
const live = 'expires_at > clock_timestamp()';
const isHash = (value: string | null): value is string => !!value && /^[a-f0-9]{64}$/.test(value);
const isNonce = (value: string) => /^[a-f0-9]{32}$/.test(value);

export class PostgresStore implements AuthStore, PublicationStore, DiscoveryStore {
  constructor(readonly pool: Pool) {}

  private async transaction<T>(run: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const result = await run(client);
      await client.query('commit');
      return result;
    } catch (error) { await client.query('rollback'); throw error; }
    finally { client.release(); }
  }

  async issue(address: Address, origin: string, now: number) {
    const challenge = newChallenge(address, origin, now);
    await this.transaction(async (db) => {
      await db.query("select pg_advisory_xact_lock(hashtextextended('chogmog-auth-challenges', 0))");
      await db.query(`delete from chogmog.auth_challenges where not (${live})`);
      const { rows } = await db.query("select count(*)::int total, count(*) filter (where data->>'address' = $1)::int wallet from chogmog.auth_challenges", [address]);
      if (rows[0].total >= 512 || rows[0].wallet >= 3) throw new AuthError(429, 'Too many pending sign-ins');
      const data: Challenge = { address, origin, message: challenge.message, expiresAt: challenge.expiresAt };
      await db.query('insert into chogmog.auth_challenges values ($1, $2, $3)', [digest(challenge.nonce), data, new Date(challenge.expiresAt)]);
    });
    return { nonce: challenge.nonce, message: challenge.message, expiresAt: new Date(challenge.expiresAt).toISOString() };
  }

  async take(nonce: string, now: number): Promise<Challenge | null> {
    if (!isNonce(nonce)) return null;
    const { rows } = await this.pool.query('delete from chogmog.auth_challenges where hash = $1 returning data, expires_at > clock_timestamp() live', [digest(nonce)]);
    return rows[0]?.live && rows[0].data.expiresAt > now ? rows[0].data : null;
  }

  async start(address: Address, origin: string, now: number) {
    const session = newSession(address, origin, now);
    await this.transaction(async (db) => {
      await db.query("select pg_advisory_xact_lock(hashtextextended('chogmog-auth-sessions', 0))");
      await db.query(`delete from chogmog.sessions where not (${live})`);
      const { rows } = await db.query('select count(*)::int total from chogmog.sessions');
      if (rows[0].total >= 512) throw new AuthError(429, 'Too many sessions');
      const data: Session = { address, origin, expiresAt: session.expiresAt };
      await db.query('insert into chogmog.sessions values ($1, $2, $3)', [digest(session.credential), data, new Date(session.expiresAt)]);
    });
    return { credential: session.credential, expiresAt: session.expiresAt };
  }

  async read(credential: string | null, origin: string, now: number): Promise<Session | null> {
    if (!isHash(credential)) return null;
    const { rows } = await this.pool.query(`select data from chogmog.sessions where hash = $1 and ${live}`, [digest(credential)]);
    const data: Session | undefined = rows[0]?.data;
    return data && data.origin === origin && data.expiresAt > now ? data : null;
  }

  async revoke(credential: string | null) {
    if (isHash(credential)) await this.pool.query('delete from chogmog.sessions where hash = $1', [digest(credential)]);
  }

  async prepare(nonce: string, grant: PublishGrant) {
    await this.transaction(async (db) => {
      await db.query("select pg_advisory_xact_lock(hashtextextended('chogmog-publish-grants', 0))");
      await db.query(`delete from chogmog.publish_grants where not (${live})`);
      const { rows } = await db.query("select count(*)::int total, count(*) filter (where data->>'address' = $1)::int wallet from chogmog.publish_grants", [grant.address]);
      if (rows[0].total >= 512 || rows[0].wallet >= 8) throw new AuthError(429, 'Too many publication requests');
      await db.query('insert into chogmog.publish_grants (hash, data, expires_at) values ($1, $2, $3)', [digest(nonce), grant, new Date(grant.expiresAt)]);
    });
  }

  async grant(nonce: string): Promise<PublishGrant | null> {
    if (!isNonce(nonce)) return null;
    const { rows } = await this.pool.query('select data from chogmog.publish_grants where hash = $1', [digest(nonce)]);
    return rows[0]?.data ?? null;
  }

  private async load(db: Queryable, id: string): Promise<PublishedVersion | null> {
    const { rows } = await db.query('select id, content, ownership, published_at from chogmog.versions where id = $1', [id]);
    if (!rows.length) return null;
    const credits = await db.query('select part_version as "versionId", author from chogmog.credits where machine_version = $1 order by part_version', [id]);
    return { id: rows[0].id, content: rows[0].content, ownership: rows[0].ownership,
      publishedAt: rows[0].published_at.toISOString(), credits: credits.rows };
  }

  version(id: string) { return this.load(this.pool, id); }

  async discover({ kind, q, after }: DiscoveryQuery): Promise<DiscoveryPage> {
    const { rows } = await this.pool.query(`
      select v.id, v.kind, v.work_id as "workId", v.author, v.published_at,
        case when v.kind = 'machine' then v.content->>'message'
          else (select string_agg(distinct a->>'type', ', ' order by a->>'type') from jsonb_array_elements(v.content->'actions') a) end as description,
        v.content->'source'->'nft'->>'tokenId' as "tokenId", v.content->>'remixOf' as "remixOf"
      from chogmog.versions v
      where v.kind = $1
        and (v.kind = 'machine' or (v.ownership->>'isOwner' = 'true' and v.content->>'reuseAllowed' = 'true'))
        and ($2 = '' or position($2 in lower(v.work_id || ' ' || v.author || ' ' ||
          coalesce(v.content->>'message', '') || ' ' || coalesce(v.content->'source'->'nft'->>'tokenId', ''))) > 0)
        and ($3::text is null or (v.published_at, v.id) <
          (select published_at, id from chogmog.versions where id = $3 and kind = $1))
      order by v.published_at desc, v.id desc limit $4`, [kind, q, after, DISCOVERY_PAGE_SIZE + 1]);
    const items: WorkSummary[] = rows.slice(0, DISCOVERY_PAGE_SIZE).map((row) => ({
      id: row.id, kind: row.kind, workId: row.workId, author: row.author,
      publishedAt: row.published_at.toISOString(), description: row.description || 'Reusable part',
      ...(kind === 'part' ? { tokenId: row.tokenId } : row.remixOf ? { remixOf: row.remixOf } : {}),
    }));
    return { items, next: rows.length > DISCOVERY_PAGE_SIZE ? items.at(-1)!.id : null };
  }

  async receipt(address: string, key: string) {
    const { rows } = await this.pool.query('select version_id from chogmog.receipts where author = $1 and key = $2', [address.toLowerCase(), key]);
    return rows.length ? this.load(this.pool, rows[0].version_id) : null;
  }

  async commit(nonce: string, grant: PublishGrant, version: Omit<PublishedVersion, 'publishedAt'>) {
    return this.transaction(async (db) => {
      const author = grant.address.toLowerCase();
      await db.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [`chogmog-write:${author}:${grant.key}`]);
      const session = await db.query(`select data from chogmog.sessions where hash = $1 and ${live} for share`, [grant.sessionHash]);
      if (session.rows[0]?.data.address.toLowerCase() !== author || session.rows[0]?.data.origin !== grant.origin) throw new AuthError(401, 'Sign-in required');
      const prior = await db.query('select version_id from chogmog.receipts where author = $1 and key = $2', [author, grant.key]);
      if (prior.rows.length) {
        if (prior.rows[0].version_id !== version.id) throw new AuthError(409, 'Idempotency key already used for different content');
        return (await this.load(db, version.id))!;
      }
      const pending = await db.query(`select data, consumed, ${live} live from chogmog.publish_grants where hash = $1 for update`, [digest(nonce)]);
      if (!pending.rows[0]?.live || pending.rows[0].consumed || canonicalJson(pending.rows[0].data) !== canonicalJson(grant) || grant.expiresAt <= Date.now()) {
        throw new AuthError(401, 'Publication authorization expired or consumed');
      }
      if (grant.versionId !== version.id || grant.kind !== version.content.kind || version.content.author !== author) throw new AuthError(403, 'Publication scope mismatch');
      const content = version.content;
      const nft = content.kind === 'part' ? content.source.nft : null;
      if (content.kind === 'part' && (!version.ownership?.isOwner || version.ownership.owner.toLowerCase() !== author ||
          version.ownership.chainId !== nft!.chainId || version.ownership.collection !== nft!.collection || version.ownership.tokenId !== nft!.tokenId ||
          version.ownership.tokenURI !== content.source.tokenURI || !Number.isFinite(Date.parse(version.ownership.observedAt)) ||
          Date.parse(version.ownership.observedAt) > Date.now() || Date.now() - Date.parse(version.ownership.observedAt) > 10_000)) {
        throw new AuthError(503, 'Refresh ownership before publication');
      }
      await db.query('insert into chogmog.works (kind, id, author, nft) values ($1, $2, $3, $4) on conflict do nothing', [grant.kind, grant.workId, author, nft]);
      const work = await db.query('select author, nft from chogmog.works where kind = $1 and id = $2', [grant.kind, grant.workId]);
      if (nft ? canonicalJson(work.rows[0].nft) !== canonicalJson(nft) : work.rows[0].author !== author) throw new AuthError(403, 'Work belongs to another source or author');
      await db.query(`insert into chogmog.versions (id, kind, work_id, author, content, canonical, ownership)
        values ($1, $2, $3, $4, $5, $6, $7) on conflict do nothing`, [version.id, grant.kind, grant.workId, author, content, canonicalJson(content), version.ownership]);
      for (const credit of version.credits) {
        const source = await db.query("select content from chogmog.versions where id = $1 and kind = 'part'", [credit.versionId]);
        if (source.rows[0]?.content.author !== credit.author || !source.rows[0]?.content.reuseAllowed) throw new AuthError(403, 'Source is not reusable');
        await db.query('insert into chogmog.credits values ($1, $2, $3) on conflict do nothing', [version.id, credit.versionId, credit.author]);
      }
      await db.query('insert into chogmog.receipts values ($1, $2, $3)', [author, grant.key, version.id]);
      const consumed = await db.query(`update chogmog.publish_grants set consumed = true where hash = $1 and not consumed and ${live} returning hash`, [digest(nonce)]);
      const active = await db.query(`select hash from chogmog.sessions where hash = $1 and ${live}`, [grant.sessionHash]);
      if (!consumed.rowCount || !active.rowCount) throw new AuthError(401, 'Publication authorization expired');
      return (await this.load(db, version.id))!;
    });
  }
}
