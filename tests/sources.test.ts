import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { describe, expect, test } from 'vitest';
import { compileKit, getPreview, parseMetadata, PREVIEWS, provenance } from '../src/domain/chog';
import { artworkSize, readBoundedBody } from '../src/domain/artwork';
import { sourceResponse } from '../src/server/sourceCache';

describe('authentic public-data previews', () => {
  test.each([['846', 338], ['533', 25]] as const)('keeps token %s distinct from artwork %i and pins original bytes', async (tokenId, artwork) => {
    const source = getPreview(tokenId);
    expect(source.artworkNumber).toBe(artwork);
    expect(source.tokenURI).toBe(`ipfs://${provenance.metadataCid}/${artwork}.json`);
    expect(source.mode).toBe('public-data-preview');
    const raw = await readFile(`fixtures/genesis/${artwork}.json`);
    expect(createHash('sha256').update(raw).digest('hex')).toBe(source.metadataSha256);
    expect(JSON.parse(raw.toString()).attributes).toEqual(source.metadata.attributes);
    const image = await readFile(`fixtures/genesis/${artwork}.webp`);
    expect(createHash('sha256').update(image).digest('hex')).toBe(source.artworkSha256);
    expect(artworkSize(image)).toEqual({ width: 1000, height: 1000 });
  });
  test('compiles different authentic kits, not artwork numbers or submitted action lists', () => {
    expect(getPreview('846').kit).toEqual(['push', 'release', 'lift', 'shout', 'portal']);
    expect(getPreview('533').kit).toEqual(['push', 'release', 'coin', 'laser']);
    for (const id of ['25', '338', '846x', 846, undefined]) expect(() => getPreview(id)).toThrow();
  });
  test.each([
    ['Aura', 'Fire', 'lift'], ['Aura', 'Fiery Aura', 'lift'], ['Aura', 'Burning Aura', 'lift'],
    ['Head', 'Wizard Hat', 'portal'], ['Head', 'Wizard Beanie', 'portal'],
    ['Eyes', 'fire laser', 'laser'], ['Eyes', 'Purple laser', 'laser'],
    ['Eyes', 'Green laser', 'laser'], ['Eyes', 'cyan laser', 'laser'],
    ['Mouth', 'Bubblegum', 'bounce'], ['Mouth', 'Drooling', 'slick'],
    ['Mouth', 'Rainbow Puke', 'spray'], ['Mouth', 'Mon coin', 'coin'],
    ['Mouth', 'BTC Coin', 'coin'], ['Mouth', 'Gold Tooth', 'shout'],
  ])('maps exact %s=%s to %s', (trait_type, value, ability) => {
    expect(compileKit({ name: '', image: '', attributes: [{ trait_type, value }] })).toEqual(['push', 'release', ability]);
  });
  test('retains unknown traits without granting an unrelated power', () => {
    const source = PREVIEWS[0];
    const metadata = parseMetadata({ ...source.metadata, attributes: [{ trait_type: 'Eyes', value: 'Cyan Laser' }] }, 338);
    expect(metadata.attributes[0].value).toBe('Cyan Laser');
    expect(compileKit(metadata)).toEqual(['push', 'release']);
  });
  test('rejects malformed traits, remote images, duplicate traits and oversized metadata', () => {
    const metadata = getPreview('846').metadata;
    for (const bad of [null, {}, { ...metadata, image: 'https://evil.example/338.webp' },
      { ...metadata, attributes: [null] }, { ...metadata, attributes: [{ trait_type: 'Aura', value: 4 }] },
      { ...metadata, attributes: [metadata.attributes[0], metadata.attributes[0]] },
      { ...metadata, attributes: Array(33).fill(metadata.attributes[0]) }]) {
      expect(() => parseMetadata(bad, 338)).toThrow();
    }
  });
});

describe('restricted same-origin preview cache', () => {
  test.each(['artwork', 'metadata'])('serves pinned %s with safe cache headers and no external redirect', async (kind) => {
    const response = await sourceResponse(new Request(`http://local/api/source?kind=${kind}&id=338`));
    expect(response.status).toBe(200);
    expect(response.headers.get('cross-origin-resource-policy')).toBe('same-origin');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('location')).toBeNull();
    expect(response.headers.get('cache-control')).toContain('immutable');
    expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(0);
  });
  test.each(['?kind=artwork&id=846', '?kind=artwork&id=../338', '?kind=artwork&id=25&id=338',
    '?kind=artwork&id=338&url=https://localhost', '?kind=svg&id=338', '?kind=artwork&id=0338', ''])('rejects unpinned and open-proxy inputs %s', async (query) => {
    const response = await sourceResponse(new Request(`http://local/api/source${query}`));
    expect(response.status).toBe(400);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
  test('rejects non-GET requests', async () => {
    expect((await sourceResponse(new Request('http://local/api/source?kind=artwork&id=338', { method: 'POST' }))).status).toBe(405);
  });
  test('refuses unsupported encodings and oversized decoded dimensions before image decode', async () => {
    const data = new Uint8Array(await readFile('fixtures/genesis/338.webp'));
    const huge = data.slice();
    new DataView(huge.buffer).setUint16(26, 4000, true);
    for (const invalid of [new Uint8Array(), new TextEncoder().encode('<svg/>'), huge, data.slice(0, 30)]) {
      expect(() => artworkSize(invalid)).toThrow();
    }
  });
  test('bounds streaming bodies even when content-length is missing or dishonest', async () => {
    expect(await readBoundedBody(new Response(new Uint8Array(4)), 4)).toEqual(new Uint8Array(4));
    await expect(readBoundedBody(new Response(new Uint8Array(5), { headers: { 'content-length': '1' } }), 4)).rejects.toThrow();
    await expect(readBoundedBody(new Response('x', { headers: { 'content-length': '100' } }), 4)).rejects.toThrow();
    await expect(readBoundedBody(new Response('x', { status: 503 }), 4)).rejects.toThrow();
  });
});
