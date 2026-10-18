import { createPublicClient, http, isAddress, parseAbi, type Address } from 'viem';
import { defineChain } from 'viem';
import provenance from '../../fixtures/genesis/provenance.json' with { type: 'json' };
import type { SourcePin } from '../domain/documents.ts';

const monad = defineChain({ id: provenance.chainId, name: 'Monad', nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: [provenance.rpc] } } });
const client = createPublicClient({ chain: monad, transport: http(provenance.rpc, { timeout: 7_000, retryCount: 0 }) });
const sourceAbi = parseAbi(['function ownerOf(uint256 tokenId) view returns (address)', 'function tokenURI(uint256 tokenId) view returns (string)']);
export const MAX_OWNERSHIP_AGE_MS = 45_000;

export class OwnershipError extends Error {
  constructor(readonly kind: 'invalid-input' | 'unavailable', message: string) { super(message); }
}

export interface BlockObservation { number: bigint; hash: `0x${string}` | null; timestamp: bigint }
export interface OwnershipReader {
  chainId(): Promise<number>;
  block(blockNumber?: bigint): Promise<BlockObservation>;
  ownerOf(collection: Address, tokenId: bigint, blockNumber: bigint): Promise<Address>;
  tokenURI(collection: Address, tokenId: bigint, blockNumber: bigint): Promise<string>;
}

export const genesisReader: OwnershipReader = {
  chainId: () => client.getChainId(),
  block: (blockNumber) => client.getBlock(blockNumber === undefined ? {} : { blockNumber }),
  ownerOf: (collection, tokenId, blockNumber) => client.readContract({ address: collection, abi: sourceAbi,
    functionName: 'ownerOf', args: [tokenId], blockNumber }),
  tokenURI: (collection, tokenId, blockNumber) => client.readContract({ address: collection, abi: sourceAbi,
    functionName: 'tokenURI', args: [tokenId], blockNumber }),
};

export function tokenId(value: unknown): string {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value) || value.length > 78 || BigInt(value) >= 2n ** 256n) {
    throw new OwnershipError('invalid-input', 'Invalid Genesis token ID');
  }
  return value;
}

export async function freshOwnership(reader: OwnershipReader, address: Address, token: string, now = Date.now(),
  pin?: Pick<SourcePin, 'nft' | 'tokenURI'>) {
  const parsed = tokenId(token);
  if (pin && (pin.nft.chainId !== provenance.chainId || pin.nft.collection.toLowerCase() !== provenance.collection || pin.nft.tokenId !== parsed)) {
    throw new OwnershipError('invalid-input', 'Wrong Genesis source pin');
  }
  try {
    if (await reader.chainId() !== provenance.chainId) throw new Error('Wrong RPC chain');
    const before = await reader.block();
    if (typeof before.number !== 'bigint' || before.number < 0n || !before.hash || !/^0x[a-fA-F0-9]{64}$/.test(before.hash) || !Number.isSafeInteger(Number(before.timestamp)) ||
        now - Number(before.timestamp) * 1000 < -5_000 || now - Number(before.timestamp) * 1000 > MAX_OWNERSHIP_AGE_MS) {
      throw new Error('Stale or unknown observation');
    }
    const owner = await reader.ownerOf(provenance.collection as Address, BigInt(parsed), before.number);
    const uri = await reader.tokenURI(provenance.collection as Address, BigInt(parsed), before.number);
    if (!isAddress(owner)) throw new Error('Invalid owner response');
    if (typeof uri !== 'string' || !new RegExp(`^ipfs://${provenance.metadataCid}/(0|[1-9][0-9]{0,5})\\.json$`).test(uri) ||
        (pin && pin.tokenURI !== uri)) throw new Error('Source URI mismatch');
    const after = await reader.block(before.number);
    if (before.hash.toLowerCase() !== after.hash?.toLowerCase() || after.number !== before.number ||
        Date.now() - Number(before.timestamp) * 1000 > MAX_OWNERSHIP_AGE_MS) throw new Error('Unstable ownership observation');
    return { chainId: provenance.chainId, collection: provenance.collection, tokenId: parsed,
      owner, tokenURI: uri, isOwner: owner.toLowerCase() === address.toLowerCase(),
      blockNumber: before.number.toString(), blockHash: before.hash, observedAt: new Date(now).toISOString() };
  } catch { throw new OwnershipError('unavailable', 'Ownership unavailable'); }
}
