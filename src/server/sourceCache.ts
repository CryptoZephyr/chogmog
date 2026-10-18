import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import provenance from '../../fixtures/genesis/provenance.json' with { type: 'json' };
import { artworkSize, MAX_ARTWORK_BYTES } from '../domain/artwork.ts';

export async function sourceResponse(request: Request): Promise<Response> {
  const json = (message: string, status: number) => Response.json({ error: message }, { status, headers: { 'Cache-Control': 'no-store' } });
  if (request.method !== 'GET') return new Response(null, { status: 405, headers: { Allow: 'GET' } });
  const { pathname, searchParams: q } = new URL(request.url);
  const kind = q.get('kind');
  const source = provenance.entries.find((p) => String(p.artworkNumber) === q.get('id'));
  if (pathname !== '/api/source' || q.size !== 2 || !source || (kind !== 'artwork' && kind !== 'metadata')) {
    return json('Unsupported source', 400);
  }
  const extension = kind === 'artwork' ? 'webp' : 'json';
  const expected = kind === 'artwork' ? source.artworkSha256 : source.metadataSha256;
  const path = resolve(process.cwd(), 'fixtures/genesis', `${source.artworkNumber}.${extension}`);
  try {
    const max = kind === 'artwork' ? MAX_ARTWORK_BYTES : 16_384;
    if ((await stat(path)).size > max) throw new Error('Oversized cache');
    const data = await readFile(path);
    if (data.length > max || createHash('sha256').update(data).digest('hex') !== expected) throw new Error('Invalid cache');
    if (kind === 'artwork') artworkSize(data);
    return new Response(data, { headers: {
      'Content-Type': kind === 'artwork' ? 'image/webp' : 'application/json',
      'Content-Length': String(data.length),
      'Cache-Control': 'public, max-age=86400, immutable',
      'X-Content-Type-Options': 'nosniff',
      'Cross-Origin-Resource-Policy': 'same-origin',
      ETag: `"${expected}"`,
    } });
  } catch {
    return json('Verified preview cache unavailable', 503);
  }
}
