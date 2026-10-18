import { readFile } from 'node:fs/promises';
import { afterEach, expect, test, vi } from 'vitest';
import { getPreview } from '../src/domain/chog';
import { loadArtwork } from '../src/domain/artwork';

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

test('requests only same-origin pinned artwork, checks bytes and decodes a bounded bitmap', async () => {
  const bytes = await readFile('fixtures/genesis/338.webp');
  const fetcher = vi.fn().mockResolvedValue(new Response(bytes, { headers: { 'content-type': 'image/webp' } }));
  const bitmap = { width: 1000, height: 1000, close: vi.fn() };
  const decode = vi.fn().mockResolvedValue(bitmap);
  vi.stubGlobal('fetch', fetcher);
  vi.stubGlobal('createImageBitmap', decode);
  const controller = new AbortController();
  expect(await loadArtwork(getPreview('846'), controller.signal)).toBe(bitmap);
  expect(fetcher).toHaveBeenCalledWith('/api/source?kind=artwork&id=338', expect.objectContaining({ credentials: 'omit', redirect: 'error', mode: 'same-origin' }));
  expect(decode).toHaveBeenCalledOnce();
});

test.each(['bad MIME', 'tampered bytes', 'gateway failure'])('does not decode %s', async (failure) => {
  const bytes = new Uint8Array(await readFile('fixtures/genesis/338.webp'));
  if (failure === 'tampered bytes') bytes[100] ^= 1;
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(bytes, { status: failure === 'gateway failure' ? 503 : 200,
    headers: { 'content-type': failure === 'bad MIME' ? 'text/html' : 'image/webp' } })));
  const decode = vi.fn();
  vi.stubGlobal('createImageBitmap', decode);
  await expect(loadArtwork(getPreview('846'), new AbortController().signal)).rejects.toThrow();
  expect(decode).not.toHaveBeenCalled();
});

test('closes a bitmap if a stage is cancelled during decode', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(await readFile('fixtures/genesis/338.webp'), { headers: { 'content-type': 'image/webp' } })));
  const controller = new AbortController();
  const bitmap = { width: 1000, height: 1000, close: vi.fn() };
  vi.stubGlobal('createImageBitmap', vi.fn().mockImplementation(() => { controller.abort(); return Promise.resolve(bitmap); }));
  await expect(loadArtwork(getPreview('846'), controller.signal)).rejects.toThrow();
  expect(bitmap.close).toHaveBeenCalledOnce();
});

test('rejects a network stall at the bounded deadline', async () => {
  const timeout = vi.spyOn(AbortSignal, 'timeout');
  vi.stubGlobal('fetch', vi.fn().mockImplementation((_url: string, { signal }: { signal: AbortSignal }) => new Promise((_resolve, reject) => {
    if (signal.aborted) reject(signal.reason);
    else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  })));
  const promise = loadArtwork(getPreview('846'), new AbortController().signal);
  expect(timeout).toHaveBeenCalledWith(4000);
  await expect(promise).rejects.toThrow();
  timeout.mockRestore();
}, 6000);
