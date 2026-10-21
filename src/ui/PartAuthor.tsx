import { useEffect, useMemo, useRef, useState } from 'react';
import { canonicalJson } from '../domain/canonical';
import { compileKit, getPreview, parseMetadata } from '../domain/chog';
import { createPartVersion, parseSourcePin, previewSourcePin, resolvePreviewSource, type PartVersion } from '../domain/documents';
import { authoredPart, checkedSourcePin, EDITABLE_ACTIONS, loadPartSettings, loadPartSource, newPartSettings, previewPinToken, savePartSettings, savePartSource, type EditableAction, type PartSettings } from '../domain/partAuthoring';
import { api, assertWallet, injected } from './walletClient';
import { PartSandbox } from './PartSandbox';
import { preparePart, publicationAttempt, publishPart, savedAttempt, type PartApproval, type PartReceipt, type PublicationContext } from './partPublication';

const storage = {
  getItem: (key: string) => window.localStorage.getItem(key),
  setItem: (key: string, value: string) => window.localStorage.setItem(key, value),
};
const draftAuthor = '0x0000000000000000000000000000000000000001';

export type UsePreviewPart = (version: PartVersion) => Promise<{ ok: boolean; message: string }>;

export function PartAuthor({ address, onUsePreviewPart }: { address: string | null; onUsePreviewPart?: UsePreviewPart }) {
  const [initial] = useState(() => loadPartSettings(storage));
  const [settings, setSettings] = useState(initial.settings);
  const [source, setSource] = useState(() => loadPartSource(storage));
  const [token, setToken] = useState(source.pin.nft.tokenId);
  const [owner, setOwner] = useState<string | null>(null);
  const [saved, setSaved] = useState(initial.recovered);
  const [sourceSaved, setSourceSaved] = useState(true);
  const [running, setRunning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('Local draft. No holder authority has been verified for this editor.');
  const [previewBuildMessage, setPreviewBuildMessage] = useState('');
  const [validation, setValidation] = useState<{ revision: string; version?: PartVersion; error?: string } | null>(null);
  const [approval, setApproval] = useState<PartApproval | null>(null);
  const [published, setPublished] = useState<PartReceipt | null>(null);
  const [recovery, setRecovery] = useState(() => savedAttempt(storage));
  const sequence = useRef(0);
  const mounted = useRef(false);
  const attempt = useRef<{ id: string; key: string } | undefined>(undefined);
  const previewToken = previewPinToken(source.pin);
  const previewMode = previewToken !== undefined;
  const editorSource = useMemo(() => previewToken ? { pin: source.pin, metadata: getPreview(previewToken).metadata } : source, [source, previewToken]);
  const partAuthor = previewMode ? draftAuthor : address ?? draftAuthor;
  const revision = canonicalJson({ settings, source: editorSource, author: partAuthor });
  const version = validation?.revision === revision ? validation.version : undefined;
  const kit = compileKit(editorSource.metadata);
  const authorized = !previewMode && !!address && owner === address && token === source.pin.nft.tokenId;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    let live = true;
    void authoredPart(settings, partAuthor, editorSource).then((version) => {
      if (live) setValidation({ revision, version });
    }).catch((error: unknown) => { if (live) setValidation({ revision, error: error instanceof Error ? error.message : 'Invalid part configuration' }); });
    return () => { live = false; };
  }, [revision, settings, editorSource, partAuthor]);
  const invalidate = () => { sequence.current++; setApproval(null); setPublished(null); };
  const edit = (next: PartSettings) => {
    invalidate(); setSettings(next); setSaved(savePartSettings(storage, next));
    setStatus('Draft changed. Run it again, then review the new exact version.');
  };
  const tryPreview = (id: '533' | '846') => {
    invalidate(); setOwner(null); setToken(id); setPreviewBuildMessage('');
    const next = { pin: previewSourcePin(id), metadata: getPreview(id).metadata };
    setSource(next); setSourceSaved(savePartSource(storage, next));
    const preferred = (['shout', 'laser', 'lift', 'portal', 'push', 'release'] as const)
      .find((action) => compileKit(next.metadata).includes(action));
    edit({ ...settings, action: preferred ?? 'release' });
  };
  const loadSource = async () => {
    if (!address) return;
    invalidate(); setOwner(null); setBusy(true);
    const cycle = sequence.current;
    const active = () => mounted.current && cycle === sequence.current;
    try {
      const wallet = injected();
      if (!wallet) throw new Error('No compatible wallet found.');
      await assertWallet(wallet, address);
      if (!active()) return;
      const result = await api(`/api/holder-source?token=${encodeURIComponent(token)}`);
      if (!active()) return;
      const pin = parseSourcePin(result.pin), metadata = parseMetadata(result.metadata, pin.artworkNumber);
      const observation = result.ownership as Record<string, unknown> | undefined;
      if (pin.nft.tokenId !== token || observation?.isOwner !== true || typeof observation.owner !== 'string' || observation.owner.toLowerCase() !== address.toLowerCase() ||
          observation.tokenId !== token || observation.tokenURI !== pin.tokenURI) throw new Error('Source or ownership did not match.');
      const next = { pin: checkedSourcePin(source.pin, pin), metadata };
      setSource(next); setSourceSaved(savePartSource(storage, next)); setOwner(address);
      setStatus(`Genesis token ${token} was owned by this wallet at block ${String(observation.blockNumber)}. Publication will recheck ownership.`);
    } catch (error) { if (active()) setStatus(`${error instanceof Error ? error.message : 'Source unavailable.'} Draft kept. Retry source loading.`); }
    finally { if (active()) setBusy(false); }
  };
  const context = (cycle: number): PublicationContext => {
    const wallet = injected();
    if (!wallet) throw new Error('No compatible wallet found.');
    return { api, wallet, origin: window.location.origin, active: () => mounted.current && sequence.current === cycle };
  };
  const review = async () => {
    if (!version || !address || (!authorized && recovery?.id !== version.id) || !settings.reuseAllowed) return;
    invalidate(); setBusy(true);
    const cycle = sequence.current;
    try {
      const next = publicationAttempt(storage, version.id, attempt.current); attempt.current = next;
      setRecovery(next);
      if (!next.saved) setSaved(false);
      const result = await preparePart(context(cycle), version, next.key);
      if (!mounted.current || cycle !== sequence.current) return;
      if ('published' in result) { setPublished(result.published); setStatus('This exact version is already published and was read back from storage.'); }
      else if (authorized) { setApproval(result.approval); setStatus('Review the exact content and reuse permission below before signing.'); }
      else setStatus('No completed save found for this retry key. Load your Chog for a fresh owner check before signing.');
    } catch (error) { if (mounted.current && cycle === sequence.current) setStatus(`${error instanceof Error ? error.message : 'Publication unavailable.'} Draft kept. Review again with the same retry key.`); }
    finally { if (mounted.current && cycle === sequence.current) setBusy(false); }
  };
  const publish = async () => {
    if (!version || !approval || !authorized) return;
    const cycle = sequence.current; setBusy(true);
    try {
      const result = await publishPart(context(cycle), version, approval);
      if (mounted.current && cycle === sequence.current) { setPublished(result); setApproval(null); setStatus('Published immutable part. The exact version was read back from storage.'); }
    } catch (error) {
      if (mounted.current && cycle === sequence.current) { setApproval(null); setStatus(`${error instanceof Error ? error.message : 'Publication result unavailable.'} Draft kept. Review again to recover any completed save before another signature.`); }
    } finally { if (mounted.current && cycle === sequence.current) setBusy(false); }
  };
  const addPreviewToBuild = async () => {
    if (!version || !previewMode || !onUsePreviewPart) return;
    setBusy(true); setPreviewBuildMessage('');
    try {
      const reusable = await createPartVersion({ ...version.content, reuseAllowed: true }, resolvePreviewSource);
      const result = await onUsePreviewPart(reusable);
      setPreviewBuildMessage(`${result.message} `);
      setStatus(result.ok
        ? 'Preview part saved in this browser. It remains excluded from publication, reuse counts and holder work.'
        : 'Preview part was not added to the Build draft. It remains excluded from publication, reuse counts and holder work.');
    } catch (error) {
      setPreviewBuildMessage(error instanceof Error ? error.message : 'Could not add this preview part to Build.');
    } finally { setBusy(false); }
  };
  return <section aria-label="Holder part authoring">
    {previewMode && <div className="panel preview-banner">
      <span className="tape">PREVIEW</span>
      <p>Preview Chog. Public data, not yours. Parts made here stay in this browser. They can't be published, counted as reuse, or shown as a holder's work.</p>
    </div>}
    <h3>Make a part from your Chog</h3>
    <p>Free local testing does not prove ownership. Sign in above and load a token you own to request publication. Hosted publication needs the dedicated shared backend, and is unavailable on local Vite. No transaction, payment, NFT approval or custody is involved.</p>
    <p role="status">{status}</p>
    <fieldset disabled={busy || running}>
      <legend>1. Choose the source</legend>
      <label>Your Genesis token ID<input type="text" inputMode="numeric" maxLength={78} value={token} onChange={(e) => { invalidate(); setOwner(null); setToken(e.target.value); }} /></label>
      <button disabled={!address || !/^(0|[1-9][0-9]*)$/.test(token)} onClick={() => void loadSource()}>Load my Chog and check ownership</button>
      <button onClick={() => tryPreview('846')}>Try preview Chog #846</button>
      <button onClick={() => tryPreview('533')}>Try preview Chog #533</button>
    </fieldset>
    <p>Editing Genesis token {source.pin.nft.tokenId}, artwork {source.pin.artworkNumber}, {editorSource.metadata.name}. {authorized ? 'Owner checked for this editor, subject to a fresh publication check.' : 'Unverified local source snapshot. It cannot authorize publication.'}</p>
      <p>Metadata-derived kit: {kit.join(', ')}. This one-action editor implements push, shout, release, laser, lift and portal only. Other compiled abilities are not authorable here yet.</p>
    <details><summary>Source traits and pins</summary>
      <ul>{editorSource.metadata.attributes.map((t) => <li key={t.trait_type}>{t.trait_type}: {t.value}</li>)}</ul>
      <p className="breakable">{source.pin.tokenURI}</p><p className="breakable">Metadata SHA-256: {source.pin.metadataSha256}</p>
      <p>Public source snapshots persist locally. They never persist a wallet session or confer holder permission.</p>
    </details>
    <fieldset disabled={busy || running}>
      <legend>2. Configure the part</legend>
      <label>Part name / public ID, lowercase letters, numbers and hyphens<input type="text" maxLength={64} value={settings.partId} onChange={(e) => edit({ ...settings, partId: e.target.value })} /></label>
      <label>Chog action<select value={settings.action} onChange={(e) => edit({ ...settings, action: e.target.value as EditableAction })}>
        {EDITABLE_ACTIONS.map((action) => <option key={action} value={action} disabled={!kit.includes(action)}>{action}{kit.includes(action) ? '' : ', missing source trait'}</option>)}
      </select></label>
      {settings.action !== 'laser' && <>
        <label>Ball horizontal position: {settings.ballX}<input type="range" min="1" max="3" step="0.25" value={settings.ballX} onChange={(e) => edit({ ...settings, ballX: Number(e.target.value) })} /></label>
        {(settings.action === 'release' || settings.action === 'portal') && <label>Release height: {settings.ballY}<input type="range" min="3" max="5" step="0.25" value={settings.ballY} onChange={(e) => edit({ ...settings, ballY: Number(e.target.value) })} /></label>}
        <label>Ball bounce: {settings.restitution}<input type="range" min="0" max="0.95" step="0.05" value={settings.restitution} onChange={(e) => edit({ ...settings, restitution: Number(e.target.value) })} /></label>
        <label><input type="checkbox" checked={settings.ramp} onChange={(e) => edit({ ...settings, ramp: e.target.checked })} /> Add a supporting ramp</label>
      </>}
      {(settings.action === 'laser' || settings.action === 'push') && <label>Aim in radians: {settings.angle}<input type="range" min="-0.6" max="0.6" step="0.05" value={settings.angle} onChange={(e) => edit({ ...settings, angle: Number(e.target.value) })} /></label>}
      {settings.action === 'push' && <label>Push impulse: {settings.impulse}<input type="range" min="1" max="8" step="0.25" value={settings.impulse} onChange={(e) => edit({ ...settings, impulse: Number(e.target.value) })} /></label>}
      {settings.action === 'shout' && <label>Shout strength: {settings.impulse}<input type="range" min="1" max="8" step="0.25" value={settings.impulse} onChange={(e) => edit({ ...settings, impulse: Number(e.target.value) })} /></label>}
      {settings.action === 'lift' && <label>Lift acceleration: {settings.acceleration}<input type="range" min="12" max="24" step="1" value={settings.acceleration} onChange={(e) => edit({ ...settings, acceleration: Number(e.target.value) })} /></label>}
      {settings.action === 'portal' && <label>Portal exit height: {settings.exitY}<input type="range" min="1" max="5" step="0.25" value={settings.exitY} onChange={(e) => edit({ ...settings, exitY: Number(e.target.value) })} /></label>}
      <label><input type="checkbox" checked={settings.expose} onChange={(e) => edit({ ...settings, expose: e.target.checked })} /> Expose the bounded {settings.action === 'push' ? 'push strength' : settings.action === 'shout' ? 'shout strength' : settings.action === 'laser' ? 'laser aim' : settings.action === 'lift' ? 'lift strength' : 'ball bounce'} control to reusers</label>
      <label><input type="checkbox" checked={settings.reuseAllowed} onChange={(e) => edit({ ...settings, reuseAllowed: e.target.checked })} /> Allow others to embed this immutable version in future machines, preserving its original author and source credits even after an NFT sale</label>
      <button onClick={() => edit(newPartSettings())}>Start a new part</button>
    </fieldset>
    {(!saved || !sourceSaved) && <p role="alert">Some local saving is unavailable. Keep this tab open. Your current draft still works, but reload recovery and publication retry recovery may be unavailable.</p>}
    {validation?.revision === revision && validation.error && <p role="alert">{validation.error}. Correct the configuration to test or publish. The last valid draft remains saved.</p>}
    {version && <>
      <PartSandbox key={version.id} version={version} onRunning={setRunning} />
      <h4>3. Review publication</h4>
      <p className="breakable">Exact version: {version.id}</p>
      <p>Reusable ports: {version.content.sockets.map((s) => `${s.id}, ${s.direction} ${s.kind}`).join('. ')}. Exposed controls: {version.content.controls.map((c) => `${c.id} ${c.min} to ${c.max}`).join(', ') || 'none'}.</p>
      {previewMode
        ? <p>Preview parts can't be published.</p>
        : !authorized && <p>Publication is blocked until the signed-in current Genesis owner loads this source. Public-data preview labels and cached metadata grant no permission.</p>}
      <button disabled={previewMode || busy || running || !address || (!authorized && recovery?.id !== version.id) || !settings.reuseAllowed} onClick={() => void review()}>Review exact part for publication / recover save</button>
      {previewMode && onUsePreviewPart && <button disabled={busy || running} onClick={() => void addPreviewToBuild()}>Use in my Build draft</button>}
      {previewMode && previewBuildMessage && <p role="status">{previewBuildMessage}<a href="?harness=machine">Build</a></p>}
      <details><summary>Exact immutable configuration</summary><pre className="breakable">{JSON.stringify(version.content, null, 2)}</pre></details>
      {approval && <section aria-label="Publication approval">
        <p>Approve only this part, this author, the version hash above and the reusable permission you selected. Expires {approval.expiresAt}. This is a separate gas-free message from login.</p>
        <pre className="breakable">{approval.message}</pre>
        <button disabled={busy || running} onClick={() => void publish()}>Sign and publish this exact part</button>
        <button disabled={busy} onClick={() => { invalidate(); setStatus('Publication approval cancelled. Draft kept.'); }}>Cancel publication approval</button>
      </section>}
      {published && <section aria-label="Persisted part result"><p role="status" className="breakable">Persisted and read back: {published.id}. Author: {published.content.author}. Published {published.publishedAt}. This is an immutable version, not a live ownership guarantee. Catalogue discovery and full machine playback remain later tasks.</p>
        <button disabled={busy} onClick={() => void review()}>Reopen exact persisted version</button>
      </section>}
    </>}
  </section>;
}
