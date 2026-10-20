export const MAX_DOCUMENT_BYTES = 65_536;

export function canonicalJson(value: unknown): string {
  const ancestors = new Set<object>();
  const chunks: string[] = [];
  let bytes = 0;
  let nodes = 0;
  const emit = (text: string) => {
    bytes += new TextEncoder().encode(text).byteLength;
    if (bytes > MAX_DOCUMENT_BYTES) throw new Error('Document byte limit');
    chunks.push(text);
  };
  const visit = (item: unknown, depth: number) => {
    if (++nodes > 4096 || depth > 16) throw new Error('Document complexity limit');
    if (item === null || typeof item === 'boolean') { emit(String(item)); return; }
    if (typeof item === 'number' && Number.isFinite(item)) { emit(JSON.stringify(item)); return; }
    if (typeof item === 'string' && item.length <= MAX_DOCUMENT_BYTES) { emit(JSON.stringify(item)); return; }
    if (!item || typeof item !== 'object' || ancestors.has(item)) throw new Error('Expected acyclic JSON data');
    const array = Array.isArray(item);
    if (!array && Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null) {
      throw new Error('Expected plain JSON object');
    }
    const keys = Reflect.ownKeys(item);
    if (keys.length > 1024 || (array && item.length > 1023) || keys.some((key) => typeof key !== 'string')) throw new Error('Invalid JSON keys');
    ancestors.add(item);
    emit(array ? '[' : '{');
    const names = array ? Array.from({ length: item.length }, (_, i) => String(i)) : (keys as string[]).sort();
    if (array && keys.length !== names.length + 1) throw new Error('Sparse or extended array');
    names.forEach((key, i) => {
      const field = Object.getOwnPropertyDescriptor(item, key);
      if (!field || !field.enumerable || !('value' in field)) throw new Error('Expected JSON value property');
      if (i) emit(',');
      if (!array) { emit(JSON.stringify(key)); emit(':'); }
      visit(field.value, depth + 1);
    });
    emit(array ? ']' : '}');
    ancestors.delete(item);
  };
  visit(value, 0);
  return chunks.join('');
}

export async function contentId(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(value));
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return `sha256:${Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

export function freezeDocument<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freezeDocument(child);
    Object.freeze(value);
  }
  return value;
}
