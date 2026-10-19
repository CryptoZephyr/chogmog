import { parseSiweMessage } from 'viem/siwe';
import { canonicalJson, contentId } from '../domain/canonical';
import type { PartVersion } from '../domain/documents';
import { assertWallet, type Api, type InjectedWallet } from './walletClient';

export interface PartApproval { nonce: string; message: string; expiresAt: string; versionId: string; key: string }
export interface PartReceipt extends PartVersion { publishedAt: string }
export interface PublicationContext {
  api: Api; wallet: InjectedWallet; origin: string; active(): boolean;
}
export const ATTEMPT_KEY = 'chogmog.part-attempt.v1';
export function savedAttempt(storage: Pick<Storage, 'getItem'>): { id: string; key: string } | undefined {
  try {
    const raw = storage.getItem(ATTEMPT_KEY);
    if (!raw) return;
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object') return;
    const a = value as Record<string, unknown>;
    if (typeof a.id === 'string' && /^sha256:[a-f0-9]{64}$/.test(a.id) && typeof a.key === 'string' && /^[a-zA-Z0-9_-]{16,64}$/.test(a.key)) return { id: a.id, key: a.key };
  } catch { /* Recovery is optional when storage is unavailable. */ }
}
export function publicationAttempt(storage: Pick<Storage, 'getItem' | 'setItem'>, id: string, prior?: { id: string; key: string }) {
  let attempt = prior ?? savedAttempt(storage);
  if (!attempt || attempt.id !== id || !/^[a-zA-Z0-9_-]{16,64}$/.test(attempt.key)) attempt = { id, key: crypto.randomUUID() };
  let saved = true;
  try { storage.setItem(ATTEMPT_KEY, JSON.stringify(attempt)); } catch { saved = false; }
  return { ...attempt, saved };
}
function active(context: PublicationContext) {
  if (!context.active()) throw new Error('Wallet, source or draft changed. Review this draft again.');
}
async function session(context: PublicationContext, version: PartVersion) {
  active(context);
  await assertWallet(context.wallet, version.content.author);
  const current = await context.api('/api/auth');
  if (typeof current.address !== 'string' || current.address.toLowerCase() !== version.content.author ||
      typeof current.expiresAt !== 'string' || Date.parse(current.expiresAt) <= Date.now() || !Number.isFinite(Date.parse(current.expiresAt))) throw new Error('Session expired or changed. Sign in again.');
  active(context);
}
function receipt(value: unknown, expected: PartVersion): PartReceipt {
  const r = value as PartReceipt | null;
  if (!r || r.id !== expected.id || canonicalJson(r.content) !== canonicalJson(expected.content) ||
      typeof r.publishedAt !== 'string' || !Number.isFinite(Date.parse(r.publishedAt))) throw new Error('Persisted version does not match this draft.');
  return { id: r.id, content: expected.content, publishedAt: r.publishedAt };
}
async function readback(context: PublicationContext, expected: PartVersion, result: unknown) {
  receipt(result, expected);
  const persisted = receipt(await context.api(`/api/versions?id=${encodeURIComponent(expected.id)}`), expected);
  active(context);
  return persisted;
}
export async function preparePart(context: PublicationContext, version: PartVersion, key: string): Promise<{ approval: PartApproval } | { published: PartReceipt }> {
  if (!version.content.reuseAllowed || await contentId(version.content) !== version.id) throw new Error('Review the reusable permission and exact content first.');
  await session(context, version);
  const result = await context.api('/api/publish?op=prepare', 'POST', { content: version.content, key });
  active(context);
  if (result.published) return { published: await readback(context, version, result.published) };
  if (typeof result.message !== 'string' || typeof result.nonce !== 'string' || !/^[a-f0-9]{32}$/.test(result.nonce) ||
      result.versionId !== version.id || typeof result.expiresAt !== 'string') throw new Error('Invalid publication approval.');
  const message = parseSiweMessage(result.message);
  const expiry = Date.parse(result.expiresAt), now = Date.now();
  if (message.address?.toLowerCase() !== version.content.author || message.domain !== new URL(context.origin).host ||
      message.uri !== context.origin || message.chainId !== 143 || message.version !== '1' || message.nonce !== result.nonce ||
      message.statement !== `Publish Chogmog part ${version.content.partId}. No transaction, payment or NFT approval.` ||
      !message.issuedAt || message.issuedAt.getTime() > now + 5000 || now - message.issuedAt.getTime() > 300_000 ||
      !Number.isFinite(expiry) || expiry <= now || expiry > now + 300_000 || message.expirationTime?.getTime() !== expiry ||
      canonicalJson(message.resources) !== canonicalJson([`urn:chogmog:${version.id}`, `urn:chogmog:idempotency:${key}`])) throw new Error('Publication approval does not match this draft.');
  return { approval: { nonce: result.nonce, message: result.message, expiresAt: result.expiresAt, versionId: version.id, key } };
}
export async function publishPart(context: PublicationContext, version: PartVersion, approval: PartApproval): Promise<PartReceipt> {
  if (approval.versionId !== version.id || Date.parse(approval.expiresAt) <= Date.now()) throw new Error('Approval expired or draft changed. Review again.');
  await session(context, version);
  let signature: unknown;
  try { signature = await context.wallet.request({ method: 'personal_sign', params: [approval.message, version.content.author] }); }
  catch { throw new Error('Wallet signature cancelled or unavailable. The draft is kept.'); }
  if (typeof signature !== 'string' || !/^0x[a-fA-F0-9]{130}$/.test(signature)) throw new Error('Invalid wallet signature.');
  active(context);
  await assertWallet(context.wallet, version.content.author);
  active(context);
  if (Date.parse(approval.expiresAt) <= Date.now()) throw new Error('Approval expired. Review again.');
  const result = await context.api('/api/publish?op=commit', 'POST', { content: version.content, key: approval.key, nonce: approval.nonce, signature });
  active(context);
  return readback(context, version, result);
}
