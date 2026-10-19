import { useEffect, useRef, useState } from 'react';
import type { Machine } from '../domain/machineDraft';
import { MachineLibrary, machineCredits } from '../domain/machineLibrary';
import { api, injected } from './walletClient';
import { MACHINE_ATTEMPT_KEY, prepareMachine, publicationAttempt, publishMachine,
  type MachineReceipt, type MachineVersion, type PartApproval, type PublicationContext } from './partPublication';

const storage = {
  getItem: (key: string) => window.localStorage.getItem(key),
  setItem: (key: string, value: string) => window.localStorage.setItem(key, value),
};

export function MachinePublication({ machine, library, address, disabled }:
  { machine: Machine; library: MachineLibrary; address: string | null; disabled: boolean }) {
  const [reviewed, setReviewed] = useState<{ version: MachineVersion; approval: PartApproval } | null>(null);
  const [published, setPublished] = useState<MachineReceipt | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(true);
  const [status, setStatus] = useState('No NFT is required to publish a machine. Sign-in and a separate gas-free publication message are required.');
  const attempt = useRef<{ id: string; key: string } | undefined>(undefined);
  const sequence = useRef(0), mounted = useRef(false);
  const previews = machine.scene.parts.some((part) => !library.isPublished(part.versionId));
  useEffect(() => {
    mounted.current = true;
    const wallet = injected();
    const changed = () => { sequence.current++; setReviewed(null); setPublished(null); setBusy(false); setStatus('Wallet or chain changed. Sign in and review again.'); };
    wallet?.on?.('accountsChanged', changed); wallet?.on?.('chainChanged', changed);
    return () => {
      mounted.current = false;
      wallet?.removeListener?.('accountsChanged', changed); wallet?.removeListener?.('chainChanged', changed);
    };
  }, []);
  const context = (cycle: number): PublicationContext => {
    const wallet = injected();
    if (!wallet) throw new Error('No compatible wallet found.');
    return { api, wallet, origin: location.origin, active: () => mounted.current && cycle === sequence.current };
  };
  const review = async () => {
    if (!address || disabled || previews || busy) return;
    const cycle = ++sequence.current;
    setBusy(true); setReviewed(null); setPublished(null);
    try {
      const checked = await library.validate({ ...machine.scene, author: address.toLowerCase() }, 'publication');
      if (!mounted.current || cycle !== sequence.current) return;
      const version: MachineVersion = { id: checked.id, content: checked.scene, credits: machineCredits(checked) };
      const next = publicationAttempt(storage, version.id, attempt.current, MACHINE_ATTEMPT_KEY);
      attempt.current = next; setSaved(next.saved);
      const result = await prepareMachine(context(cycle), version, next.key);
      if (!mounted.current || cycle !== sequence.current) return;
      if ('published' in result) { setPublished(result.published); setStatus('This exact machine and original credits were read back from storage.'); }
      else { setReviewed({ version, approval: result.approval }); setStatus('Review the exact machine, original credits and message below before signing.'); }
    } catch (error) {
      if (mounted.current && cycle === sequence.current) setStatus(`${error instanceof Error ? error.message : 'Publication unavailable.'} Draft kept. Review again to recover any completed save.`);
    } finally { if (mounted.current && cycle === sequence.current) setBusy(false); }
  };
  const publish = async () => {
    if (!reviewed || disabled || busy) return;
    const cycle = sequence.current; setBusy(true);
    try {
      const result = await publishMachine(context(cycle), reviewed.version, reviewed.approval);
      if (mounted.current && cycle === sequence.current) { setPublished(result); setReviewed(null); setStatus('Immutable machine and exact original credits persisted and read back.'); }
    } catch (error) {
      if (mounted.current && cycle === sequence.current) { setReviewed(null); setStatus(`${error instanceof Error ? error.message : 'Save result unavailable.'} Draft kept. Review again with the same retry key before signing again.`); }
    } finally { if (mounted.current && cycle === sequence.current) setBusy(false); }
  };
  return <section aria-label="Machine publication">
    <h2>Publish an exact machine</h2>
    <p>Requires committed reusable holder parts and a direct Chog action connection. Public previews cannot be published. Hosted publication is disabled until the dedicated Chogmog backend is accepted. Local Vite returns 503.</p>
    <p role="status">{status}</p>
    {previews && <p role="alert">Remove public-preview parts before requesting genuine publication.</p>}
    {!saved && <p role="alert">Retry recovery after reload is unavailable. Keep this tab open. No signature or session is saved with the draft.</p>}
    <button disabled={disabled || busy || !address || previews} onClick={() => void review()}>Review exact machine / recover save</button>
    <ul aria-label="Original machine credits">{machineCredits(machine).map((credit) => <li key={credit.versionId} className="breakable">
      {credit.versionId}, original author {credit.author}
    </li>)}</ul>
    {reviewed && <section aria-label="Machine publication approval">
      <p className="breakable">Exact version {reviewed.version.id}. Author {reviewed.version.content.author}. Expires {reviewed.approval.expiresAt}.</p>
      {reviewed.version.content.remixOf && <p className="breakable">Remixed from exact parent {reviewed.version.content.remixOf}. This lineage is included in the signed content hash.</p>}
      <p>No transaction, payment, NFT approval or custody. Editing, running or changing wallets cancels this review.</p>
      <pre className="breakable">{reviewed.approval.message}</pre>
      <details><summary>Exact machine and original credits</summary><pre className="breakable">{JSON.stringify(reviewed.version, null, 2)}</pre></details>
      <button disabled={disabled || busy} onClick={() => void publish()}>Sign and publish this exact machine</button>
      <button disabled={busy} onClick={() => { sequence.current++; setReviewed(null); setStatus('Publication approval cancelled. Draft kept.'); }}>Cancel machine approval</button>
    </section>}
    {published && <section aria-label="Persisted machine result">
      <p role="status" className="breakable">Persisted and read back {published.id}. Author {published.content.author}. Published {published.publishedAt}.</p>
      <ul>{published.credits?.map((credit) => <li key={credit.versionId} className="breakable">{credit.versionId}, original author {credit.author}</li>)}</ul>
      <a href={`?harness=published&version=${encodeURIComponent(published.id)}`}>Reopen exact saved machine and credits</a>
    </section>}
  </section>;
}
