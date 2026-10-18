import { randomUUID } from 'node:crypto';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import type { Address } from 'viem';
import { ENGINE_VERSION, previewSourcePin, type PartContent, type PartVersion, type Scene } from '../src/domain/documents.ts';
import type { OwnershipReader } from '../src/chain/genesisOwnership.ts';

export const origin = 'https://chogmog.test';
export const account = () => privateKeyToAccount(generatePrivateKey());
export const key = () => randomUUID();
export const workId = () => `work-${randomUUID()}`;
export function part(author: string): PartContent {
  return {
    kind: 'part', schemaVersion: 1, rulesVersion: 1, engineVersion: ENGINE_VERSION, partId: workId(), author: author.toLowerCase(),
    source: previewSourcePin('533'), reuseAllowed: true, bounds: { width: 3, height: 3 },
    props: [{ id: 'balloon', type: 'balloon', x: 2, y: 1, radius: 0.3 }],
    actions: [{ id: 'laser', type: 'laser', x: 1, y: 1, length: 6, angle: 0 }],
    sockets: [
      { id: 'trigger', direction: 'input', kind: 'event', target: { objectId: 'laser', socket: 'trigger' } },
      { id: 'ray', direction: 'output', kind: 'event', target: { objectId: 'laser', socket: 'fired' } },
    ],
    controls: [{ id: 'aim', objectId: 'laser', field: 'angle', min: -0.6, max: 0.6, default: 0 }],
    connections: [{ from: { objectId: 'laser', socket: 'fired' }, to: { objectId: 'balloon', socket: 'hit' } }],
  };
}
export function scene(version: PartVersion, author: string): Scene {
  return {
    kind: 'machine', schemaVersion: 1, rulesVersion: 1, engineVersion: ENGINE_VERSION, machineId: workId(), author: author.toLowerCase(),
    seed: 143, bounds: { width: 12, height: 8 }, message: 'Make mischief move!',
    props: [{ id: 'lever', type: 'lever', x: 10, y: 2, width: 1, height: 0.2 }, { id: 'banner', type: 'banner', x: 10, y: 5 }],
    parts: [{ id: 'first', versionId: version.id, x: 1, y: 1, values: {} }],
    connections: [
      { from: { objectId: 'first', socket: 'ray' }, to: { objectId: 'lever', socket: 'hit' } },
      { from: { objectId: 'lever', socket: 'activated' }, to: { objectId: 'banner', socket: 'open' } },
    ],
    inputs: [{ id: 'start', tick: 0, target: { objectId: 'first', socket: 'trigger' } }],
  };
}

// Synthetic ownership is only for tests. It is never wired into deployed routes.
export function chain(owner: Address): OwnershipReader {
  return {
    chainId: async () => 143,
    block: async () => ({ number: 100n, hash: `0x${'a'.repeat(64)}` as const, timestamp: BigInt(Math.floor(Date.now() / 1000)) }),
    ownerOf: async () => owner,
    tokenURI: async () => previewSourcePin('533').tokenURI,
  };
}

export function request(path: string, cookie?: string, body?: unknown, method?: string) {
  return new Request(`${origin}${path}`, { method: method ?? (body === undefined ? 'GET' : 'POST'),
    headers: { Origin: origin, ...(cookie ? { Cookie: cookie } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
