import type { Preview } from './chog.ts';

export const MAX_ARTWORK_BYTES = 1_048_576;
export const MAX_ARTWORK_DIMENSION = 1024;

export function artworkSize(bytes: Uint8Array): { width: number; height: number } {
  const label = (start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 30 || bytes.length > MAX_ARTWORK_BYTES || label(0, 4) !== 'RIFF' ||
      label(8, 12) !== 'WEBP' || label(12, 16) !== 'VP8 ' ||
      data.getUint32(4, true) + 8 !== bytes.length || data.getUint32(16, true) > bytes.length - 20 ||
      bytes[23] !== 0x9d || bytes[24] !== 1 || bytes[25] !== 0x2a) throw new Error('Unsupported artwork');
  const width = data.getUint16(26, true) & 0x3fff;
  const height = data.getUint16(28, true) & 0x3fff;
  if (!width || !height || width > MAX_ARTWORK_DIMENSION || height > MAX_ARTWORK_DIMENSION) {
    throw new Error('Artwork dimensions exceed preview limits');
  }
  return { width, height };
}

export async function readBoundedBody(response: Response, limit: number): Promise<Uint8Array<ArrayBuffer>> {
  const declared = Number(response.headers.get('content-length'));
  if (!response.ok || !response.body || !Number.isFinite(declared) || declared < 0 || declared > limit) {
    await response.body?.cancel();
    throw new Error('Artwork response unavailable or oversized');
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) throw new Error('Artwork exceeds byte limit');
      chunks.push(value);
    }
  } finally {
    try { await reader.cancel(); } finally { reader.releaseLock(); }
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}

export async function loadArtwork(source: Preview, signal: AbortSignal): Promise<ImageBitmap> {
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(4000)]);
  const response = await fetch(`/api/source?kind=artwork&id=${source.artworkNumber}`, {
    signal: deadline, mode: 'same-origin', credentials: 'omit', redirect: 'error',
  });
  if (response.headers.get('content-type') !== 'image/webp') {
    await response.body?.cancel();
    throw new Error('Unexpected artwork type');
  }
  const bytes = await readBoundedBody(response, MAX_ARTWORK_BYTES);
  artworkSize(bytes);
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (b) => b.toString(16).padStart(2, '0')).join('');
  if (hash !== source.artworkSha256) throw new Error('Artwork digest mismatch');
  deadline.throwIfAborted();
  const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/webp' }));
  if (deadline.aborted) { bitmap.close(); deadline.throwIfAborted(); }
  if (bitmap.width > MAX_ARTWORK_DIMENSION || bitmap.height > MAX_ARTWORK_DIMENSION) {
    bitmap.close();
    throw new Error('Decoded artwork exceeds limits');
  }
  return bitmap;
}
