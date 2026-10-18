import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { createServer } from 'vite';
import { describe, expect, test } from 'vitest';
import { provenance } from '../src/domain/chog';
import { freshOwnership, ownerResponse, type OwnershipReader } from '../src/chain/genesisOwnership';
import { authResponse, MemoryAuthStore } from '../src/server/walletAuth';
import serverlessAuth from '../api/auth';
import serverlessOwner from '../api/owner';

const origin = 'http://127.0.0.1:5173';
const account = () => privateKeyToAccount(generatePrivateKey());
const request = (path: string, method = 'GET', input?: unknown, cookie?: string, site = origin) => new Request(`${origin}${path}`,
  { method, headers: { Origin: site, ...(cookie ? { Cookie: cookie } : {}), ...(input === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
async function challenge(store: MemoryAuthStore, address: string, now = Date.now()) {
  const response = await authResponse(request('/api/auth?op=challenge', 'POST', { address }), store, origin, now);
  expect(response.status).toBe(200);
  return await response.json() as { nonce: string; message: string; expiresAt: string };
}
async function login(store: MemoryAuthStore, signer: ReturnType<typeof account>, now = Date.now()) {
  const c = await challenge(store, signer.address, now);
  const signature = await signer.signMessage({ message: c.message });
  const response = await authResponse(request('/api/auth?op=verify', 'POST', { nonce: c.nonce, message: c.message, signature }), store, origin, now);
  return { response, c, signature };
}
function fakeReader(owner: `0x${string}`, timestamp = BigInt(Math.floor(Date.now() / 1000))) {
  let currentOwner = owner;
  let currentChain = provenance.chainId;
  let reorg = false;
  let unavailable = false;
  let reads = 0;
  const reader: OwnershipReader = {
    chainId: async () => currentChain,
    block: async (blockNumber) => {
      if (unavailable) throw new Error('RPC is down');
      if (blockNumber !== undefined) reads++;
      return { number: 123n, hash: `0x${(reorg && blockNumber !== undefined ? 'f' : 'a').repeat(64)}` as `0x${string}`, timestamp };
    },
    ownerOf: async (collection, tokenId, blockNumber) => {
      if (collection !== provenance.collection || tokenId !== 846n || blockNumber !== 123n) throw new Error('Wrong target');
      if (unavailable) throw new Error('RPC is down');
      return currentOwner;
    },
    tokenURI: async (collection, tokenId, blockNumber) => {
      if (collection !== provenance.collection || tokenId !== 846n || blockNumber !== 123n) throw new Error('Wrong URI target');
      return `ipfs://${provenance.metadataCid}/338.json`;
    },
  };
  return { reader, transfer: (address: `0x${string}`) => { currentOwner = address; },
    wrongChain: () => { currentChain = 1; }, reorg: () => { reorg = true; }, fail: () => { unavailable = true; }, readCount: () => reads };
}

describe('one-time domain-bound wallet authentication', () => {
  test('gas-free EOA signature creates an HttpOnly short session and logout revokes it', async () => {
    const store = new MemoryAuthStore(), signer = account(), now = Date.now();
    const c = await challenge(store, signer.address, now);
    expect(c.message).toContain(`${new URL(origin).host} wants you to sign in with your Ethereum account:`);
    expect(c.message).toContain('Chain ID: 143');
    expect(c.message).toContain(`URI: ${origin}`);
    expect(c.message).toContain('No transaction, NFT approval or ownership claim.');
    const signature = await signer.signMessage({ message: c.message });
    const success = await authResponse(request('/api/auth?op=verify', 'POST', { nonce: c.nonce, message: c.message, signature }), store, origin, now);
    expect(success.status).toBe(200);
    const cookie = success.headers.get('set-cookie')!;
    expect(cookie).toContain('HttpOnly; SameSite=Strict; Path=/api; Max-Age=1800');
    expect(cookie).not.toContain('Secure');
    const session = await authResponse(request('/api/auth', 'GET', undefined, cookie), store, origin, now);
    expect(await session.json()).toEqual({ address: signer.address, expiresAt: new Date(now + 30 * 60_000).toISOString() });
    const replay = await authResponse(request('/api/auth?op=verify', 'POST', { nonce: c.nonce, message: c.message, signature }), store, origin, now);
    expect(replay.status).toBe(401);
    expect((await authResponse(request('/api/auth?op=logout', 'POST', undefined, cookie), store, origin, now)).status).toBe(200);
    expect((await (await authResponse(request('/api/auth', 'GET', undefined, cookie), store, origin, now)).json()).address).toBeNull();
  });

  test('invalid signatures consume the challenge, including a different valid signer', async () => {
    const store = new MemoryAuthStore(), target = account(), other = account();
    const c = await challenge(store, target.address);
    const wrongSignature = await other.signMessage({ message: c.message });
    const body = { nonce: c.nonce, message: c.message, signature: wrongSignature };
    expect((await authResponse(request('/api/auth?op=verify', 'POST', body), store, origin)).status).toBe(401);
    body.signature = await target.signMessage({ message: c.message });
    expect((await authResponse(request('/api/auth?op=verify', 'POST', body), store, origin)).status).toBe(401);
  });

  test('wrong domain, URI, chain and altered messages cannot establish sessions', async () => {
    for (const mutate of [(m: string) => m.replace('Chain ID: 143', 'Chain ID: 1'),
      (m: string) => m.replace('127.0.0.1:5173', 'example.com'), (m: string) => m.replace('URI: http:', 'URI: https:'),
      (m: string) => `${m}\nRequest: publish part`]) {
      const store = new MemoryAuthStore(), signer = account(), c = await challenge(store, signer.address);
      const message = mutate(c.message), signature = await signer.signMessage({ message });
      expect((await authResponse(request('/api/auth?op=verify', 'POST', { nonce: c.nonce, message, signature }), store, origin)).status).toBe(401);
    }
  });

  test('expired nonce/session, failed cross-origin calls, malformed input and concurrent replay fail', async () => {
    const store = new MemoryAuthStore(), signer = account(), now = Date.now();
    const c = await challenge(store, signer.address, now);
    const signature = await signer.signMessage({ message: c.message });
    const input = { nonce: c.nonce, message: c.message, signature };
    expect((await authResponse(request('/api/auth?op=verify', 'POST', input), store, origin, now + 300_000)).status).toBe(401);
    const pending = await challenge(store, signer.address, now);
    const signed = await signer.signMessage({ message: pending.message });
    const requests = await Promise.all(Array.from({ length: 2 }, () => authResponse(request('/api/auth?op=verify', 'POST',
      { nonce: pending.nonce, message: pending.message, signature: signed }), store, origin, now)));
    expect(requests.map((r) => r.status).sort()).toEqual([200, 401]);
    const cookie = requests.find((r) => r.status === 200)!.headers.get('set-cookie')!;
    expect((await (await authResponse(request('/api/auth', 'GET', undefined, cookie), store, origin, now + 1_800_000)).json()).address).toBeNull();
    expect((await authResponse(request('/api/auth?op=challenge', 'POST', { address: signer.address }, undefined, 'https://evil.example'), store, origin)).status).toBe(403);
    expect((await authResponse(request('/api/auth?op=challenge', 'POST', { address: 'abc' }), store, origin)).status).toBe(400);
    expect((await authResponse(request('/api/auth?op=challenge', 'POST', { address: signer.address, kit: ['laser'] }), store, origin)).status).toBe(400);
    expect((await authResponse(request('/api/auth?op=challenge', 'POST', { address: signer.address, noise: 'x'.repeat(3000) }), store, origin)).status).toBe(413);
    expect((await authResponse(request('/api/auth?op=publish', 'POST', { address: signer.address }), store, origin)).status).toBe(404);
  });

  test('HTTPS sessions use Secure cookies and refuse an HTTP origin', async () => {
    const secureOrigin = 'https://example.org', signer = account(), store = new MemoryAuthStore();
    const post = (op: string, value: unknown) => new Request(`${secureOrigin}/api/auth?op=${op}`, {
      method: 'POST', headers: { Origin: secureOrigin, 'Content-Type': 'application/json' }, body: JSON.stringify(value),
    });
    const c = await (await authResponse(post('challenge', { address: signer.address }), store, secureOrigin)).json();
    const signature = await signer.signMessage({ message: c.message });
    const success = await authResponse(post('verify', { nonce: c.nonce, message: c.message, signature }), store, secureOrigin);
    expect(success.headers.get('set-cookie')).toContain('; Secure');
    expect((await authResponse(request('/api/auth?op=verify', 'POST', { nonce: c.nonce, message: c.message, signature }), store, secureOrigin)).status).toBe(403);
  });
});

describe('fresh Genesis ownership uses only the signed-in session', () => {
  test('correct owner, non-owner and transfer after login use fresh pinned block observations', async () => {
    const signer = account(), second = account(), store = new MemoryAuthStore();
    const { response } = await login(store, signer);
    expect(response.status).toBe(200);
    const cookie = response.headers.get('set-cookie')!;
    const source = fakeReader(signer.address);
    const before = await ownerResponse(request('/api/owner?token=846', 'GET', undefined, cookie), store, source.reader, origin);
    const data = await before.json();
    expect(data).toMatchObject({ chainId: 143, collection: provenance.collection, tokenId: '846', blockNumber: '123', isOwner: true });
    expect(source.readCount()).toBe(1);
    source.transfer(second.address);
    const after = await ownerResponse(request('/api/owner?token=846', 'GET', undefined, cookie), store, source.reader, origin);
    expect((await after.json()).isOwner).toBe(false);
    expect(source.readCount()).toBe(2);
    expect((await ownerResponse(request(`/api/owner?token=846&collection=${signer.address}`, 'GET', undefined, cookie), store, source.reader, origin)).status).toBe(400);
    expect((await ownerResponse(request('/api/owner?token=846'), store, source.reader, origin)).status).toBe(401);
    expect((await ownerResponse(request('/api/owner?token=846', 'GET', undefined, cookie, 'https://evil.example'), store, source.reader, origin)).status).toBe(403);
  });

  test('wrong chain, stale data, reorganization and RPC failure remain unknown, never non-owner', async () => {
    const signer = account(), store = new MemoryAuthStore(), { response } = await login(store, signer);
    const cookie = response.headers.get('set-cookie')!;
    const wrong = fakeReader(signer.address); wrong.wrongChain();
    const reorg = fakeReader(signer.address); reorg.reorg();
    const outage = fakeReader(signer.address); outage.fail();
    const stale = fakeReader(signer.address, BigInt(Math.floor(Date.now() / 1000) - 120));
    for (const source of [wrong, reorg, outage, stale]) {
      const result = await ownerResponse(request('/api/owner?token=846', 'GET', undefined, cookie), store, source.reader, origin);
      expect(result.status).toBe(503);
      expect(await result.json()).toEqual({ error: 'Ownership unavailable' });
    }
    await expect(freshOwnership(wrong.reader, signer.address, '846')).rejects.toThrow('Ownership unavailable');
  });

  test('rejects malformed, negative, padded and oversized token IDs', async () => {
    const signer = account(), store = new MemoryAuthStore(), { response } = await login(store, signer);
    const cookie = response.headers.get('set-cookie')!;
    for (const token of ['0846', '-1', '0x34e', '1e3', (2n ** 256n).toString(), 'not-an-id']) {
      expect((await ownerResponse(request(`/api/owner?token=${encodeURIComponent(token)}`, 'GET', undefined, cookie), store,
        fakeReader(signer.address).reader, origin)).status).toBe(400);
    }
  });

  test('T3 pins require exact chain, collection, token ID and current on-chain URI', async () => {
    const signer = account(), source = fakeReader(signer.address);
    const pin = { nft: { chainId: 143 as const, collection: provenance.collection, tokenId: '846' },
      tokenURI: `ipfs://${provenance.metadataCid}/338.json` };
    expect((await freshOwnership(source.reader, signer.address, '846', Date.now(), pin)).isOwner).toBe(true);
    await expect(freshOwnership(source.reader, signer.address, '846', Date.now(),
      { ...pin, nft: { ...pin.nft, collection: signer.address } })).rejects.toThrow('Wrong Genesis source pin');
    await expect(freshOwnership(source.reader, signer.address, '846', Date.now(),
      { ...pin, nft: { ...pin.nft, chainId: 1 as 143 } })).rejects.toThrow('Wrong Genesis source pin');
    await expect(freshOwnership(source.reader, signer.address, '846', Date.now(),
      { ...pin, nft: { ...pin.nft, tokenId: '533' } })).rejects.toThrow('Wrong Genesis source pin');
    await expect(freshOwnership(source.reader, signer.address, '846', Date.now(),
      { ...pin, tokenURI: 'ipfs://untrusted/338.json' })).rejects.toThrow('Ownership unavailable');
  });

  test('undeployed serverless endpoints refuse auth and ownership without shared storage', async () => {
    expect((await serverlessAuth.fetch()).status).toBe(503);
    expect((await serverlessOwner.fetch()).status).toBe(503);
  });

  test('real Vite HTTP routes exchange a one-time signature and reject open paths', async () => {
    const vite = await createServer({ server: { host: '127.0.0.1', port: 0, strictPort: false }, logLevel: 'silent' });
    try {
      await vite.listen();
      const listen = vite.httpServer!.address();
      if (!listen || typeof listen === 'string') throw new Error('Missing listener');
      const url = `http://127.0.0.1:${listen.port}`;
      const signer = account();
      const challengeResponse = await fetch(`${url}/api/auth?op=challenge`, { method: 'POST', headers: { Origin: url, 'Content-Type': 'application/json' }, body: JSON.stringify({ address: signer.address }) });
      expect(challengeResponse.status).toBe(200);
      const c = await challengeResponse.json() as { nonce: string; message: string };
      const signature = await signer.signMessage({ message: c.message });
      const verified = await fetch(`${url}/api/auth?op=verify`, { method: 'POST', headers: { Origin: url, 'Content-Type': 'application/json' },
        body: JSON.stringify({ nonce: c.nonce, message: c.message, signature }) });
      expect(verified.status).toBe(200);
      const cookie = verified.headers.get('set-cookie')!;
      const session = await fetch(`${url}/api/auth`, { headers: { Cookie: cookie } });
      expect((await session.json()).address).toBe(signer.address);
      expect((await fetch(`${url}/api/auth/extra?op=verify`)).status).toBe(404);
      expect((await fetch(`${url}/api/owner?token=0846`, { headers: { Cookie: cookie } })).status).toBe(400);
    } finally { await vite.close(); }
  });
});
