import { canonicalJson, freezeDocument } from './canonical.ts';

export const DISCOVERY_PAGE_SIZE = 12;
export type WorkKind = 'part' | 'machine';
export interface WorkSummary {
  id: string;
  kind: WorkKind;
  workId: string;
  author: string;
  publishedAt: string;
  description: string;
  tokenId?: string;
  remixOf?: string;
}
export interface DiscoveryQuery { kind: WorkKind; q: string; after: string | null }
export interface DiscoveryPage { items: WorkSummary[]; next: string | null }
export const isVersionId = (value: unknown): value is string => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);

export function discoveryQuery(params: URLSearchParams): DiscoveryQuery {
  const keys = [...params.keys()];
  const kind = params.get('kind'), q = params.get('q') ?? '', after = params.get('after');
  if (keys.length !== new Set(keys).size || keys.some((k) => !['kind', 'q', 'after'].includes(k)) ||
      (kind !== 'part' && kind !== 'machine') || q.length > 80 || [...q].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127) ||
      (after !== null && !isVersionId(after))) throw new Error('Invalid discovery query');
  return { kind, q: q.trim().toLowerCase(), after };
}

export function discoveryUrl(query: DiscoveryQuery): string {
  const params = new URLSearchParams({ kind: query.kind });
  if (query.q) params.set('q', query.q);
  if (query.after) params.set('after', query.after);
  discoveryQuery(params);
  return `/api/discover?${params}`;
}

export function parseDiscovery(value: unknown, kind: WorkKind): DiscoveryPage {
  if (canonicalJson(value).length > 16_384 || !value || typeof value !== 'object') throw new Error('Invalid discovery response');
  const page = value as DiscoveryPage;
  if (Object.keys(page).sort().join(',') !== 'items,next' || !Array.isArray(page.items) || page.items.length > DISCOVERY_PAGE_SIZE ||
      (page.next !== null && !isVersionId(page.next))) throw new Error('Invalid discovery page');
  const ids = new Set<string>();
  for (const item of page.items) {
    if (!item || typeof item !== 'object' || Object.keys(item).some((k) => !['id', 'kind', 'workId', 'author', 'publishedAt', 'description', 'tokenId', 'remixOf'].includes(k)) ||
        item.kind !== kind || !isVersionId(item.id) || ids.has(item.id) ||
        typeof item.workId !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(item.workId) ||
        typeof item.author !== 'string' || !/^0x[a-f0-9]{40}$/.test(item.author) || /^0x0{40}$/.test(item.author) ||
        typeof item.description !== 'string' || !item.description.trim() || item.description.length > 160 ||
        typeof item.publishedAt !== 'string' || !Number.isFinite(Date.parse(item.publishedAt)) ||
        (kind === 'part' ? typeof item.tokenId !== 'string' || !/^(0|[1-9][0-9]{0,77})$/.test(item.tokenId) || Object.hasOwn(item, 'remixOf')
          : Object.hasOwn(item, 'tokenId') || (Object.hasOwn(item, 'remixOf') && !isVersionId(item.remixOf)))) throw new Error('Invalid work summary');
    ids.add(item.id);
  }
  if (page.next !== null && (page.items.length !== DISCOVERY_PAGE_SIZE || page.next !== page.items.at(-1)?.id)) throw new Error('Invalid discovery cursor');
  return freezeDocument(page);
}
