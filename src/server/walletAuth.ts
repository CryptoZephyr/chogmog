import { createHash, randomBytes } from 'node:crypto';
import { getAddress, isAddress, recoverMessageAddress, type Address } from 'viem';
import { createSiweMessage } from 'viem/siwe';
import provenance from '../../fixtures/genesis/provenance.json' with { type: 'json' };

const COOKIE = 'chogmog_session';
const CHALLENGE_MS = 5 * 60_000;
const SESSION_MS = 30 * 60_000;
const MAX_ENTRIES = 512;

export interface Challenge { address: Address; origin: string; message: string; expiresAt: number }
export interface Session { address: Address; origin: string; expiresAt: number }
export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const random = (bytes: number) => randomBytes(bytes).toString('hex');

type Asyncable<T> = T | Promise<T>;
export interface AuthStore {
  issue(address: Address, origin: string, now: number): Asyncable<{ nonce: string; message: string; expiresAt: string }>;
  take(nonce: string, now: number): Asyncable<Challenge | null>;
  start(address: Address, origin: string, now: number): Asyncable<{ credential: string; expiresAt: number }>;
  read(credential: string | null, origin: string, now: number): Asyncable<Session | null>;
  revoke(credential: string | null): Asyncable<void>;
}

export function newChallenge(address: Address, origin: string, now: number) {
  const nonce = random(16), expiresAt = now + CHALLENGE_MS;
  const url = new URL(origin);
  const message = createSiweMessage({ address, domain: url.host, uri: origin, chainId: provenance.chainId,
    version: '1', nonce, issuedAt: new Date(now), expirationTime: new Date(expiresAt),
    statement: 'Sign in to Chogmog. No transaction, NFT approval or ownership claim.' });
  return { nonce, address, origin, message, expiresAt };
}

export function newSession(address: Address, origin: string, now: number) {
  return { credential: random(32), address, origin, expiresAt: now + SESSION_MS };
}

export class MemoryAuthStore implements AuthStore {
  private challenges = new Map<string, Challenge>();
  private sessions = new Map<string, Session>();

  issue(address: Address, origin: string, now: number) {
    for (const [key, entry] of this.challenges) if (entry.expiresAt <= now) this.challenges.delete(key);
    if (this.challenges.size >= MAX_ENTRIES || [...this.challenges.values()].filter((c) => c.address === address).length >= 3) {
      throw new AuthError(429, 'Too many pending sign-ins');
    }
    const { nonce, message, expiresAt } = newChallenge(address, origin, now);
    this.challenges.set(digest(nonce), { address, origin, message, expiresAt });
    return { nonce, message, expiresAt: new Date(expiresAt).toISOString() };
  }

  take(nonce: string, now: number): Challenge | null {
    if (!/^[a-f0-9]{32}$/.test(nonce)) return null;
    const key = digest(nonce), challenge = this.challenges.get(key);
    this.challenges.delete(key);
    return challenge && challenge.expiresAt > now ? challenge : null;
  }

  start(address: Address, origin: string, now: number) {
    for (const [key, entry] of this.sessions) if (entry.expiresAt <= now) this.sessions.delete(key);
    if (this.sessions.size >= MAX_ENTRIES) throw new AuthError(429, 'Too many sessions');
    const { credential, expiresAt } = newSession(address, origin, now);
    this.sessions.set(digest(credential), { address, origin, expiresAt });
    return { credential, expiresAt };
  }

  read(credential: string | null, origin: string, now: number): Session | null {
    if (!credential || !/^[a-f0-9]{64}$/.test(credential)) return null;
    const key = digest(credential), session = this.sessions.get(key);
    if (!session || session.expiresAt <= now) { this.sessions.delete(key); return null; }
    if (session.origin !== origin) return null;
    return session;
  }

  revoke(credential: string | null) {
    if (credential && /^[a-f0-9]{64}$/.test(credential)) this.sessions.delete(digest(credential));
  }
}

export class AuthError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export function jsonResponse(value: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store', 'Pragma': 'no-cache', 'X-Content-Type-Options': 'nosniff', 'Vary': 'Cookie', ...headers } });
}

export function errorResponse(error: unknown): Response {
  if (error instanceof AuthError) return jsonResponse({ error: error.message }, error.status);
  return jsonResponse({ error: 'Service unavailable' }, 503);
}

export function sessionCookie(request: Request): string | null {
  const match = request.headers.get('cookie')?.match(/(?:^|;\s*)chogmog_session=([a-f0-9]{64})(?:;|$)/);
  return match?.[1] ?? null;
}

function cookie(value: string, origin: string, maxAge: number) {
  return `${COOKIE}=${value}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=${maxAge}${origin.startsWith('https:') ? '; Secure' : ''}`;
}

function sameOrigin(request: Request, expectedOrigin: string) {
  if (new URL(request.url).origin !== expectedOrigin || request.headers.get('origin') !== expectedOrigin ||
      request.headers.get('sec-fetch-site') === 'cross-site') throw new AuthError(403, 'Origin denied');
}

async function body(request: Request, keys: string[]): Promise<Record<string, string>> {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new AuthError(415, 'JSON required');
  const size = Number(request.headers.get('content-length'));
  if (size > 2048) throw new AuthError(413, 'Request too large');
  const reader = request.body?.getReader();
  if (!reader) throw new AuthError(400, 'Missing JSON body');
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > 2048) { await reader.cancel(); throw new AuthError(413, 'Request too large'); }
    chunks.push(value);
  }
  try {
    const parsed: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid JSON object');
    const data = parsed as Record<string, unknown>;
    if (Object.keys(data).length !== keys.length || keys.some((key) => typeof data[key] !== 'string') ||
        Object.keys(data).some((key) => !keys.includes(key))) throw new Error('Unexpected JSON field');
    return data as Record<string, string>;
  } catch { throw new AuthError(400, 'Invalid sign-in request'); }
}

export function parseWalletAddress(value: string): Address {
  if (!isAddress(value)) throw new AuthError(400, 'Invalid wallet address');
  return getAddress(value);
}

export async function readSession(request: Request, store: AuthStore, now = Date.now()) {
  return store.read(sessionCookie(request), new URL(request.url).origin, now);
}

export async function authResponse(request: Request, store: AuthStore, expectedOrigin: string, now = Date.now()): Promise<Response> {
  try {
    if (new URL(request.url).origin !== expectedOrigin || request.headers.get('sec-fetch-site') === 'cross-site') {
      throw new AuthError(403, 'Origin denied');
    }
    const url = new URL(request.url);
    if (url.pathname !== '/api/auth' || url.searchParams.size > 1 ||
        [...url.searchParams.keys()].some((key) => key !== 'op')) throw new AuthError(404, 'Unknown route');
    if (request.method === 'GET' && !url.search) {
      const session = await readSession(request, store, now);
      return jsonResponse({ address: session?.address ?? null, expiresAt: session ? new Date(session.expiresAt).toISOString() : null });
    }
    if (request.method !== 'POST') throw new AuthError(405, 'Method not allowed');
    sameOrigin(request, expectedOrigin);
    switch (url.searchParams.get('op')) {
      case 'challenge': {
        const input = await body(request, ['address']);
        return jsonResponse(await store.issue(parseWalletAddress(input.address), expectedOrigin, now));
      }
      case 'verify': {
        const input = await body(request, ['nonce', 'message', 'signature']);
        const challenge = await store.take(input.nonce, now);
        if (!challenge || challenge.origin !== expectedOrigin || input.message !== challenge.message ||
            !/^0x[a-fA-F0-9]{130}$/.test(input.signature)) throw new AuthError(401, 'Sign-in denied');
        let signer: Address;
        try { signer = await recoverMessageAddress({ message: challenge.message, signature: input.signature as `0x${string}` }); }
        catch { throw new AuthError(401, 'Sign-in denied'); }
        if (signer !== challenge.address) throw new AuthError(401, 'Sign-in denied');
        await store.revoke(sessionCookie(request));
        const session = await store.start(signer, expectedOrigin, now);
        return jsonResponse({ address: signer, expiresAt: new Date(session.expiresAt).toISOString() }, 200,
          { 'Set-Cookie': cookie(session.credential, expectedOrigin, SESSION_MS / 1000) });
      }
      case 'logout': {
        const reader = request.body?.getReader();
        if (reader) while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          if (chunk.value.byteLength) { await reader.cancel(); throw new AuthError(400, 'Logout takes no body'); }
        }
        await store.revoke(sessionCookie(request));
        return jsonResponse({ address: null }, 200, { 'Set-Cookie': cookie('', expectedOrigin, 0) });
      }
      default: throw new AuthError(404, 'Unknown route');
    }
  } catch (error) { return errorResponse(error); }
}
