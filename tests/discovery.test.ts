import { describe, expect, test, vi } from 'vitest';
import { createServer } from 'vite';
import { discoveryQuery, discoveryUrl, parseDiscovery, DISCOVERY_PAGE_SIZE, type WorkSummary } from '../src/domain/discovery';
import { discoveryResponse } from '../src/server/discoveryRoute';
import deployedDiscovery from '../api/discover';
import { origin, request } from './backendFixtures';

const hash = (n: number) => `sha256:${n.toString(16).padStart(64, '0')}`;
const summary = (n = 1): WorkSummary => ({
  id: hash(n), kind: 'part', workId: `part-${n}`, author: `0x${'1'.repeat(40)}`,
  publishedAt: '2026-10-18T00:00:00.000Z', description: 'laser', tokenId: '533',
});
describe('bounded public discovery, no synthetic catalogue promotion', () => {
  test('accepts normalized search and exact opaque version cursors', () => {
    const query = discoveryQuery(new URLSearchParams({ kind: 'part', q: '  LASER ', after: hash(1) }));
    expect(query).toEqual({ kind: 'part', q: 'laser', after: hash(1) });
    expect(discoveryQuery(new URL(discoveryUrl(query), origin).searchParams)).toEqual(query);
    expect(discoveryQuery(new URLSearchParams('kind=machine'))).toEqual({ kind: 'machine', q: '', after: null });
  });
  test.each(['', 'kind=preview', 'kind=part&kind=machine', 'kind=part&limit=100000', 'kind=part&sort=random',
    'kind=part&after=none', 'kind=part&after=', 'kind=part&q=%00', 'kind=part&q=%7F', `kind=part&q=${'a'.repeat(81)}`])('rejects malformed/unbounded query %s', (query) => {
    expect(() => discoveryQuery(new URLSearchParams(query))).toThrow();
  });
  test('validates exact public response shape, immutable pages and coherent bounded cursors', () => {
    const items = Array.from({ length: DISCOVERY_PAGE_SIZE }, (_, i) => summary(i + 1)), next = items.at(-1)!.id;
    const page = parseDiscovery({ items, next }, 'part');
    expect(page.items).toHaveLength(12); expect(Object.isFrozen(page.items[0])).toBe(true);
    const machine = { ...summary(), kind: 'machine', remixOf: hash(9) }; Reflect.deleteProperty(machine, 'tokenId');
    expect(parseDiscovery({ items: [machine], next: null }, 'machine').items[0].remixOf).toBe(hash(9));
    expect(parseDiscovery({ items: [], next: null }, 'part')).toEqual({ items: [], next: null });
    for (const invalid of [
      { items, next: hash(1) }, { items: items.slice(1), next }, { items: [], next }, { items: [...items, summary(50)], next: null },
      { items: [summary(), summary()], next: null }, { items: [summary()], next: null, session: 'forbidden' },
      ...[{ ...summary(), kind: 'preview' }, { ...summary(), author: '0x0' }, { ...summary(), publishedAt: 'yesterday' },
        { ...summary(), id: 'latest' }, { ...summary(), description: 'x'.repeat(161) }, { ...summary(), tokenId: '-1' },
        { ...summary(), remixOf: hash(9) }, { ...summary(), ownership: { isOwner: true } }].map((item) => ({ items: [item], next: null })),
    ]) expect(() => parseDiscovery(invalid, 'part')).toThrow();
  });
  test('read-only API needs no wallet and returns genuine empty results without substituting previews', async () => {
    const store = { discover: vi.fn(async () => ({ items: [], next: null })) };
    const response = await discoveryResponse(request('/api/discover?kind=part'), store, origin);
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toContain('no-store');
    expect(await response.json()).toEqual({ items: [], next: null });
    expect(store.discover).toHaveBeenCalledWith({ kind: 'part', q: '', after: null });
  });
  test('denies cross-origin, writes, extra routes and invalid input before touching storage', async () => {
    const store = { discover: vi.fn(async () => ({ items: [], next: null })) };
    for (const [req, status] of [
      [request('/api/discover?kind=part&kind=machine'), 400],
      [request('/api/discover/extra?kind=part'), 404],
      [request('/api/discover?kind=part', undefined, {}, 'POST'), 405],
      [new Request(`${origin}/api/discover?kind=part`, { headers: { Origin: 'https://other.test' } }), 403],
      [new Request(`${origin}/api/discover?kind=part`, { headers: { 'sec-fetch-site': 'cross-site' } }), 403],
    ] as const) expect((await discoveryResponse(req, store, origin)).status).toBe(status);
    expect(store.discover).not.toHaveBeenCalled();
  });
  test('store outage and forged summaries fail closed without leaking internal errors', async () => {
    const store = { discover: vi.fn(async () => { throw new Error('Private SQL text'); }) };
    const failed = await discoveryResponse(request('/api/discover?kind=part'), store, origin);
    expect(failed.status).toBe(503); expect(await failed.text()).not.toContain('SQL');
    const malformed = await discoveryResponse(request('/api/discover?kind=part'), {
      discover: async () => ({ items: [{ ...summary(), credentials: 'private' }], next: null }),
    }, origin);
    expect(malformed.status).toBe(503); expect(await malformed.text()).not.toContain('private');
  });
  test('actual Vite and disabled deployed API deliberately return 503, never fixtures or SPA success', async () => {
    const server = await createServer({ server: { host: '127.0.0.1', port: 0, strictPort: false }, logLevel: 'silent' });
    try {
      await server.listen();
      const address = server.httpServer!.address();
      if (!address || typeof address === 'string') throw new Error('Missing HTTP address');
      const response = await fetch(`http://127.0.0.1:${address.port}/api/discover?kind=part`);
      expect(response.status).toBe(503); expect(response.headers.get('content-type')).toContain('application/json');
      expect(await response.json()).toEqual({ error: 'Publication requires the shared backend' });
      expect((await deployedDiscovery.fetch(request('/api/discover?kind=machine'))).status).toBe(503);
    } finally { await server.close(); }
  });
});
