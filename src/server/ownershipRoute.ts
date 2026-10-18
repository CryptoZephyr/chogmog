import { freshOwnership, OwnershipError, tokenId, type OwnershipReader } from '../chain/genesisOwnership.ts';
import { AuthError, type MemoryAuthStore, errorResponse, jsonResponse, readSession } from './walletAuth.ts';

export async function ownerResponse(request: Request, store: MemoryAuthStore, reader: OwnershipReader, expectedOrigin: string, now = Date.now()) {
  try {
    const url = new URL(request.url);
    if (url.origin !== expectedOrigin || request.headers.get('sec-fetch-site') === 'cross-site' ||
        (request.headers.has('origin') && request.headers.get('origin') !== expectedOrigin)) throw new AuthError(403, 'Origin denied');
    if (request.method !== 'GET') throw new AuthError(405, 'Method not allowed');
    if (url.pathname !== '/api/owner' || url.searchParams.size !== 1 || !url.searchParams.has('token')) {
      throw new AuthError(400, 'Expected one token ID');
    }
    const session = readSession(request, store, now);
    if (!session) throw new AuthError(401, 'Sign-in required');
    const observation = await freshOwnership(reader, session.address, tokenId(url.searchParams.get('token')), now);
    if (!readSession(request, store)) throw new AuthError(401, 'Sign-in required');
    return jsonResponse(observation);
  } catch (error) {
    if (error instanceof OwnershipError) return jsonResponse({ error: error.message }, error.kind === 'invalid-input' ? 400 : 503);
    return errorResponse(error);
  }
}
