import { createHash } from 'node:crypto';
import { artworkSize, MAX_ARTWORK_BYTES, readBoundedBody } from '../domain/artwork.ts';
import { canonicalJson } from '../domain/canonical.ts';
import { parseMetadata, provenance, type Metadata } from '../domain/chog.ts';
import { parseSourcePin, resolvePreviewSource, type SourcePin, type SourceResolver } from '../domain/documents.ts';
import { freshOwnership, OwnershipError, tokenId, type OwnershipReader } from '../chain/genesisOwnership.ts';
import { AuthError, errorResponse, jsonResponse, readSession, type AuthStore } from './walletAuth.ts';

const gateways = ['https://ipfs.io/ipfs/', 'https://dweb.link/ipfs/'];
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
export interface SourceSnapshot { pin: SourcePin; metadata: Metadata }
export type SnapshotLoader = (token: string, uri: string, observedAt: string) => Promise<SourceSnapshot>;

export function sourceLoader(fetcher: typeof fetch = fetch): SnapshotLoader {
  return async (token, uri, observedAt) => {
    const match = uri.match(new RegExp(`^ipfs://${provenance.metadataCid}/(0|[1-9][0-9]{0,5})\\.json$`));
    if (!match) throw new Error('Unsupported Genesis URI');
    const artworkNumber = Number(match[1]);
    const read = async (cid: string, extension: string, limit: number, type: string) => {
      for (const gateway of gateways) {
        try {
          const response = await fetcher(`${gateway}${cid}/${artworkNumber}.${extension}`, {
            signal: AbortSignal.timeout(4000), redirect: 'error', credentials: 'omit',
          });
          if (response.headers.get('content-type')?.split(';')[0] !== type) {
            await response.body?.cancel(); throw new Error('Unexpected source type');
          }
          return await readBoundedBody(response, limit);
        } catch { /* Try only the next fixed gateway, never a caller-supplied URL. */ }
      }
      throw new Error('Genesis source unavailable');
    };
    const bytes = await read(provenance.metadataCid, 'json', 16_384, 'application/json');
    const metadata = parseMetadata(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)), artworkNumber);
    const artwork = await read(provenance.artworkCid, 'webp', MAX_ARTWORK_BYTES, 'image/webp');
    artworkSize(artwork);
    return { metadata, pin: parseSourcePin({ nft: { chainId: 143, collection: provenance.collection, tokenId: token },
      tokenURI: uri, metadataSha256: hash(bytes), artworkNumber, imageURI: metadata.image, artworkSha256: hash(artwork), observedAt }) };
  };
}

export const loadGenesisSource = sourceLoader();
export function publicationSource(loader: SnapshotLoader = loadGenesisSource): SourceResolver {
  return async (input) => {
    const pin = parseSourcePin(input);
    try { return await resolvePreviewSource(pin); } catch { /* Other Genesis tokens use the same bounded loader. */ }
    const resolved = await loader(pin.nft.tokenId, pin.tokenURI, pin.observedAt);
    if (canonicalJson(resolved.pin) !== canonicalJson(pin)) throw new Error('Source snapshot changed');
    return resolved;
  };
}

export async function holderSourceResponse(request: Request, auth: AuthStore, reader: OwnershipReader,
  origin: string, loader: SnapshotLoader = loadGenesisSource): Promise<Response> {
  try {
    const url = new URL(request.url);
    if (url.origin !== origin || request.headers.get('sec-fetch-site') === 'cross-site' ||
        (request.headers.has('origin') && request.headers.get('origin') !== origin)) throw new AuthError(403, 'Origin denied');
    if (url.pathname !== '/api/holder-source' || url.searchParams.size !== 1 || !url.searchParams.has('token')) throw new AuthError(400, 'Expected one Genesis token ID');
    if (request.method !== 'GET') throw new AuthError(405, 'Method not allowed');
    const session = await readSession(request, auth);
    if (!session) throw new AuthError(401, 'Sign-in required');
    const ownership = await freshOwnership(reader, session.address, tokenId(url.searchParams.get('token')));
    if (!ownership.isOwner) throw new AuthError(403, 'Current Genesis owner required');
    const source = await loader(ownership.tokenId, ownership.tokenURI, ownership.observedAt);
    if (!await readSession(request, auth)) throw new AuthError(401, 'Sign-in required');
    return jsonResponse({ ...source, ownership });
  } catch (error) {
    if (error instanceof OwnershipError) return jsonResponse({ error: error.message }, error.kind === 'invalid-input' ? 400 : 503);
    return errorResponse(error);
  }
}
