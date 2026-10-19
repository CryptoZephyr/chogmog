import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { describe, expect, test, vi } from 'vitest';
import { getPreview, provenance } from '../src/domain/chog';
import { previewSourcePin } from '../src/domain/documents';
import { holderSourceResponse, publicationSource, sourceLoader, type SourceSnapshot } from '../src/server/holderSource';
import { MemoryAuthStore } from '../src/server/walletAuth';
import { account, chain, origin, request } from './backendFixtures';
import holderEndpoint from '../api/holder-source';

const metadataBytes = await readFile(new URL('../fixtures/genesis/25.json', import.meta.url));
const artBytes = await readFile(new URL('../fixtures/genesis/25.webp', import.meta.url));
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
function fetcher() {
  return vi.fn<typeof fetch>(async (url) => {
    const artwork = String(url).endsWith('.webp');
    return new Response(artwork ? artBytes : metadataBytes, { headers: { 'Content-Type': artwork ? 'image/webp' : 'application/json' } });
  });
}
describe('bounded server-only genuine Genesis source adapter, synthetic ownership', () => {
  test('loads an arbitrary token using the observed artwork URI, never token ID as artwork ID', async () => {
    const fetch = fetcher(), load = sourceLoader(fetch);
    const pin = previewSourcePin('533');
    const snapshot = await load('123', pin.tokenURI, pin.observedAt);
    expect(snapshot.pin.nft.tokenId).toBe('123');
    expect(snapshot.pin.artworkNumber).toBe(25);
    expect(snapshot.pin.metadataSha256).toBe(digest(metadataBytes));
    expect(snapshot.pin.artworkSha256).toBe(digest(artBytes));
    expect(snapshot.metadata).toEqual(getPreview('533').metadata);
    expect(fetch.mock.calls.map(([url]) => String(url))).toEqual([
      `https://ipfs.io/ipfs/${provenance.metadataCid}/25.json`, `https://ipfs.io/ipfs/${provenance.artworkCid}/25.webp`,
    ]);
    for (const [, init] of fetch.mock.calls) expect(init).toMatchObject({ redirect: 'error', credentials: 'omit' });
  });
  test('rejects arbitrary URLs, CIDs, padded IDs, paths and remote images without an open proxy', async () => {
    const fetch = fetcher(), load = sourceLoader(fetch), pin = previewSourcePin('533');
    for (const uri of ['https://evil.test/x', 'http://169.254.169.254/latest', `ipfs://${provenance.metadataCid}/../25.json`,
      `ipfs://${provenance.metadataCid}/025.json`, 'ipfs://fake/25.json']) {
      await expect(load('123', uri, pin.observedAt)).rejects.toThrow();
    }
    expect(fetch).not.toHaveBeenCalled();
    fetch.mockImplementation(async () => Response.json({ ...getPreview('533').metadata, image: 'https://evil.test/image.webp' }));
    await expect(load('123', pin.tokenURI, pin.observedAt)).rejects.toThrow('Invalid metadata');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  test('bounds streaming bytes, MIME, image dimensions and fixed-gateway fallback', async () => {
    const fetch = fetcher(), pin = previewSourcePin('533'), load = sourceLoader(fetch);
    fetch.mockRejectedValueOnce(new Error('gateway unavailable'));
    await load('123', pin.tokenURI, pin.observedAt);
    expect(String(fetch.mock.calls[1][0]).startsWith('https://dweb.link/ipfs/')).toBe(true);
    fetch.mockImplementation(async () => new Response('a'.repeat(16_385), { headers: { 'Content-Type': 'application/json' } }));
    await expect(load('123', pin.tokenURI, pin.observedAt)).rejects.toThrow('unavailable');
    fetch.mockImplementation(async () => new Response('{}', { headers: { 'Content-Type': 'text/html' } }));
    await expect(load('123', pin.tokenURI, pin.observedAt)).rejects.toThrow('unavailable');
    fetch.mockImplementation(async (url) => String(url).endsWith('.json') ? new Response(metadataBytes, { headers: { 'Content-Type': 'application/json' } }) :
      new Response('not webp', { headers: { 'Content-Type': 'image/webp' } }));
    await expect(load('123', pin.tokenURI, pin.observedAt)).rejects.toThrow('Unsupported artwork');
  });
  test('publication re-resolves arbitrary sources and rejects changed metadata or artwork hashes', async () => {
    const load = sourceLoader(fetcher()), pin = previewSourcePin('533');
    const source = await load('123', pin.tokenURI, pin.observedAt);
    const resolve = publicationSource(load);
    expect(await resolve(source.pin)).toEqual(source);
    for (const field of ['metadataSha256', 'artworkSha256'] as const) {
      await expect(resolve({ ...source.pin, [field]: 'a'.repeat(64) })).rejects.toThrow('changed');
    }
    const unused = vi.fn(async (): Promise<SourceSnapshot> => { throw new Error('not used'); });
    expect((await publicationSource(unused)(pin)).metadata).toEqual(getPreview('533').metadata);
    expect(unused).not.toHaveBeenCalled();
  });
  test('only the signed-in current owner can request a source, and sessions are rechecked after I/O', async () => {
    const signer = account(), auth = new MemoryAuthStore(), reader = chain(signer.address), load = sourceLoader(fetcher());
    const { credential } = auth.start(signer.address, origin, Date.now()), cookie = `chogmog_session=${credential}`;
    const call = (req = request('/api/holder-source?token=123', cookie), loader = load) => holderSourceResponse(req, auth, reader, origin, loader);
    expect((await call()).status).toBe(200);
    expect((await call(request('/api/holder-source?token=123'))).status).toBe(401);
    reader.ownerOf = async () => account().address;
    const unused = vi.fn(load);
    expect((await call(undefined, unused)).status).toBe(403); expect(unused).not.toHaveBeenCalled();
    reader.ownerOf = async () => signer.address;
    expect((await call(request('/api/holder-source?token=0123', cookie))).status).toBe(400);
    expect((await call(request('/api/holder-source?token=123&url=evil', cookie))).status).toBe(400);
    expect((await call(request('/api/holder-source/extra?token=123', cookie))).status).toBe(400);
    expect((await call(request('/api/holder-source?token=123', cookie, {}, 'POST'))).status).toBe(405);
    expect((await call(new Request(`${origin}/api/holder-source?token=123`, { headers: { Cookie: cookie, Origin: 'https://evil.test' } }))).status).toBe(403);
    expect((await call(undefined, async (...args) => { const s = await load(...args); auth.revoke(credential); return s; })).status).toBe(401);
  });
  test('RPC and source failures stay unavailable without inventing a kit or leaking internals', async () => {
    const signer = account(), auth = new MemoryAuthStore(), reader = chain(signer.address);
    const { credential } = auth.start(signer.address, origin, Date.now()), req = () => request('/api/holder-source?token=123', `chogmog_session=${credential}`);
    const unavailable = async () => { throw new Error('private upstream details'); };
    const sourceFailure = await holderSourceResponse(req(), auth, reader, origin, unavailable);
    expect(sourceFailure.status).toBe(503); expect(await sourceFailure.text()).not.toContain('private');
    reader.ownerOf = unavailable;
    expect((await holderSourceResponse(req(), auth, reader, origin, sourceLoader(fetcher()))).status).toBe(503);
    expect((await holderEndpoint.fetch(req())).status).toBe(503);
  });
});
