import type { Address } from 'viem';
import type { PartContent, Scene } from '../domain/documents.ts';
import type { freshOwnership } from '../chain/genesisOwnership.ts';

export interface PublishGrant {
  address: Address;
  origin: string;
  sessionHash: string;
  kind: 'part' | 'machine';
  workId: string;
  versionId: string;
  key: string;
  message: string;
  expiresAt: number;
}
export interface Credit { versionId: string; author: string }
export interface PublishedVersion {
  id: string;
  content: PartContent | Scene;
  ownership: Awaited<ReturnType<typeof freshOwnership>> | null;
  publishedAt: string;
  credits: Credit[];
}
export interface PublicationStore {
  prepare(nonce: string, grant: PublishGrant): Promise<void>;
  grant(nonce: string): Promise<PublishGrant | null>;
  receipt(address: string, key: string): Promise<PublishedVersion | null>;
  version(id: string): Promise<PublishedVersion | null>;
  commit(nonce: string, grant: PublishGrant, version: Omit<PublishedVersion, 'publishedAt'>): Promise<PublishedVersion>;
}
