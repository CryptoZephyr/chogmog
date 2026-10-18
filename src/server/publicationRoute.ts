import { randomBytes } from 'node:crypto';
import { recoverMessageAddress } from 'viem';
import { createSiweMessage } from 'viem/siwe';
import { MAX_DOCUMENT_BYTES } from '../domain/canonical.ts';
import { createPartVersion, validateMachine, type SourceResolver } from '../domain/documents.ts';
import { freshOwnership, OwnershipError, type OwnershipReader } from '../chain/genesisOwnership.ts';
import { AuthError, digest, errorResponse, jsonResponse, readSession, sessionCookie, type AuthStore } from './walletAuth.ts';
import type { PublicationStore, PublishedVersion, PublishGrant } from './publicationStore.ts';

async function input(request: Request): Promise<Record<string, unknown>> {
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new AuthError(415, 'JSON required');
  const reader = request.body?.getReader();
  if (!reader) throw new AuthError(400, 'Missing body');
  let bytes = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    bytes += chunk.value.byteLength;
    if (bytes > MAX_DOCUMENT_BYTES + 2048) { await reader.cancel(); throw new AuthError(413, 'Request too large'); }
    chunks.push(chunk.value);
  }
  try {
    const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch { throw new AuthError(400, 'Invalid JSON'); }
}

export async function publicationResponse(request: Request, auth: AuthStore, store: PublicationStore,
  reader: OwnershipReader, resolveSource: SourceResolver, origin: string): Promise<Response> {
  try {
    const url = new URL(request.url);
    if (url.origin !== origin || request.headers.get('sec-fetch-site') === 'cross-site' ||
        (request.headers.has('origin') && request.headers.get('origin') !== origin)) throw new AuthError(403, 'Origin denied');
    if (url.pathname === '/api/versions') {
      if (request.method !== 'GET') throw new AuthError(405, 'Method not allowed');
      if (url.searchParams.size !== 1 || !/^sha256:[a-f0-9]{64}$/.test(url.searchParams.get('id') ?? '')) throw new AuthError(400, 'Expected exact version ID');
      const version = await store.version(url.searchParams.get('id')!);
      if (!version) throw new AuthError(404, 'Version not found');
      return jsonResponse(version);
    }
    if (url.pathname !== '/api/publish' || url.searchParams.size !== 1 || !['prepare', 'commit'].includes(url.searchParams.get('op') ?? '')) throw new AuthError(404, 'Unknown publication route');
    if (request.method !== 'POST') throw new AuthError(405, 'Method not allowed');
    if (request.headers.get('origin') !== origin) throw new AuthError(403, 'Origin denied');
    const session = await readSession(request, auth);
    if (!session) throw new AuthError(401, 'Sign-in required');
    const body = await input(request), commit = url.searchParams.get('op') === 'commit';
    const keys = commit ? ['content', 'key', 'nonce', 'signature'] : ['content', 'key'];
    if (Object.keys(body).length !== keys.length || keys.some((k) => !Object.hasOwn(body, k)) ||
        typeof body.key !== 'string' || !/^[a-zA-Z0-9_-]{16,64}$/.test(body.key)) throw new AuthError(400, 'Invalid publication fields');
    let version: Omit<PublishedVersion, 'publishedAt'>;
    try {
      const kind = (body.content as { kind?: string } | null)?.kind;
      if (kind === 'part') {
        const part = await createPartVersion(body.content, resolveSource);
        version = { id: part.id, content: part.content, ownership: null, credits: [] };
      } else if (kind === 'machine') {
        const machine = await validateMachine(body.content, async (id) => {
          let part: PublishedVersion | null;
          try { part = await store.version(id); }
          catch { throw new AuthError(503, 'Published source unavailable'); }
          if (!part || part.content.kind !== 'part' || !part.ownership?.isOwner) throw new AuthError(403, 'Published source required');
          return { version: { id: part.id, content: part.content }, origin: 'holder-published' };
        }, resolveSource, 'publication');
        const credits = [...new Map(machine.expanded.map((p) => [p.version.id, { versionId: p.version.id, author: p.version.content.author }])).values()]
          .sort((a, b) => a.versionId.localeCompare(b.versionId));
        version = { id: machine.id, content: machine.scene, credits, ownership: null };
      } else throw new Error('Unknown content kind');
    } catch (error) {
      if (error instanceof AuthError) throw error;
      throw new AuthError(400, 'Invalid publication content or source');
    }
    if (version.content.author !== session.address.toLowerCase()) throw new AuthError(403, 'Author must match signed-in wallet');
    const prior = await store.receipt(session.address, body.key);
    if (prior && prior.id !== version.id) throw new AuthError(409, 'Idempotency key already used for different content');
    const workId = version.content.kind === 'part' ? version.content.partId : version.content.machineId;
    const sessionHash = digest(sessionCookie(request)!);
    if (commit) {
      if (typeof body.nonce !== 'string' || !/^[a-f0-9]{32}$/.test(body.nonce) || typeof body.signature !== 'string' ||
          !/^0x[a-fA-F0-9]{130}$/.test(body.signature)) throw new AuthError(400, 'Invalid publication authorization');
      if (prior) return jsonResponse(prior);
      const grant = await store.grant(body.nonce);
      if (!grant || grant.sessionHash !== sessionHash || grant.origin !== origin || grant.address !== session.address || grant.kind !== version.content.kind ||
          grant.versionId !== version.id || grant.workId !== workId || grant.key !== body.key || grant.expiresAt <= Date.now()) throw new AuthError(401, 'Publication authorization denied');
      let signer: string;
      try { signer = await recoverMessageAddress({ message: grant.message, signature: body.signature as `0x${string}` }); }
      catch { throw new AuthError(401, 'Publication signature denied'); }
      if (signer !== session.address) throw new AuthError(401, 'Publication signature denied');
      if (version.content.kind === 'part') {
        const source = version.content.source;
        version.ownership = await freshOwnership(reader, session.address, source.nft.tokenId, Date.now(), source);
        if (!version.ownership.isOwner) throw new AuthError(403, 'Current Genesis owner required');
      }
      return jsonResponse(await store.commit(body.nonce, grant, version));
    }
    if (prior) return jsonResponse({ published: prior });
    if (version.content.kind === 'part') {
      const source = version.content.source;
      if (!(await freshOwnership(reader, session.address, source.nft.tokenId, Date.now(), source)).isOwner) throw new AuthError(403, 'Current Genesis owner required');
    }
    if (!await readSession(request, auth)) throw new AuthError(401, 'Sign-in required');
    const nonce = randomBytes(16).toString('hex'), now = Date.now(), expiresAt = now + 300_000;
    const message = createSiweMessage({ address: session.address, domain: new URL(origin).host, uri: origin, chainId: 143, version: '1', nonce,
      issuedAt: new Date(now), expirationTime: new Date(expiresAt),
      statement: `Publish Chogmog ${version.content.kind} ${workId}. No transaction, payment or NFT approval.`,
      resources: [`urn:chogmog:${version.id}`, `urn:chogmog:idempotency:${body.key}`] });
    const grant: PublishGrant = { address: session.address, origin, sessionHash, kind: version.content.kind, workId, versionId: version.id, key: body.key, message, expiresAt };
    await store.prepare(nonce, grant);
    return jsonResponse({ nonce, message, versionId: version.id, expiresAt: new Date(expiresAt).toISOString(),
      summary: { kind: version.content.kind, workId, author: session.address, reuseAllowed: version.content.kind === 'part' ? version.content.reuseAllowed : null } });
  } catch (error) {
    if (error instanceof OwnershipError) return jsonResponse({ error: error.message }, error.kind === 'invalid-input' ? 400 : 503);
    return errorResponse(error);
  }
}
