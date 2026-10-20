import { discoveryQuery, parseDiscovery, type DiscoveryPage, type DiscoveryQuery } from '../domain/discovery.ts';
import { AuthError, errorResponse, jsonResponse } from './walletAuth.ts';

export interface DiscoveryStore { discover(query: DiscoveryQuery): Promise<DiscoveryPage> }

export async function discoveryResponse(request: Request, store: DiscoveryStore, origin: string): Promise<Response> {
  try {
    const url = new URL(request.url);
    if (url.origin !== origin || request.headers.get('sec-fetch-site') === 'cross-site' ||
        (request.headers.has('origin') && request.headers.get('origin') !== origin)) throw new AuthError(403, 'Origin denied');
    if (url.pathname !== '/api/discover') throw new AuthError(404, 'Unknown discovery route');
    if (request.method !== 'GET') throw new AuthError(405, 'Method not allowed');
    let query: DiscoveryQuery;
    try { query = discoveryQuery(url.searchParams); }
    catch { throw new AuthError(400, 'Expected kind, bounded search and exact cursor'); }
    return jsonResponse(parseDiscovery(await store.discover(query), query.kind));
  } catch (error) { return errorResponse(error); }
}
