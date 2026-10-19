import { useCallback, useEffect, useState } from 'react';
import { discoveryUrl, parseDiscovery, type DiscoveryPage, type WorkKind, type WorkSummary } from '../domain/discovery';
import type { PartVersion } from '../domain/documents';
import type { Machine } from '../domain/machineDraft';
import { MachineLibrary, machineCredits } from '../domain/machineLibrary';
import { api } from './walletClient';
import { PartSandbox } from './PartSandbox';
import { MachineSandbox } from './MachineSandbox';

type Selection = { part: PartVersion } | { machine: Machine };
const versionUrl = (id: string) => `?harness=published&version=${encodeURIComponent(id)}`;

function WorkInspection({ item, library, onAddPart, disabled }: {
  item: WorkSummary; library: MachineLibrary; onAddPart?: (id: string) => void; disabled: boolean;
}) {
  const [selection, setSelection] = useState<Selection | null>(null);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const onRunning = useCallback(() => {}, []);
  useEffect(() => {
    let active = true;
    const load = item.kind === 'part' ? library.loadPart(item.id).then((part) => ({ part }))
      : library.reopen(item.id).then(({ machine }) => ({ machine }));
    void load.then((value) => {
      if (!active) return;
      const content = 'part' in value ? value.part.content : value.machine.scene;
      const workId = content.kind === 'part' ? content.partId : content.machineId;
      if (content.author !== item.author || workId !== item.workId) throw new Error('Summary differs from exact version');
      setSelection(value);
    }).catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [item, library, retry]);
  if (error) return <p role="alert">Exact version or sources unavailable or inconsistent. No draft was changed.
    <button onClick={() => { setError(false); setSelection(null); setRetry(retry + 1); }}>Retry exact work</button></p>;
  if (!selection) return <p role="status">Validating exact content, sources and original credits…</p>;
  const content = 'part' in selection ? selection.part.content : selection.machine.scene;
  return <section aria-label="Exact work inspection">
    <p className="breakable">Verified content hash {item.id}. Original author {content.author}.</p>
    {'part' in selection ? <>
      <p>Immutable holder-published reusable version. Token {selection.part.content.source.nft.tokenId}. Historical publication grants reuse, not current NFT ownership.</p>
      <p>Actions: {selection.part.content.actions.map((action) => action.type).join(', ') || 'none'}.
        Exposed controls: {selection.part.content.controls.map((control) => control.id).join(', ') || 'none'}.</p>
      <PartSandbox key={item.id} version={selection.part} onRunning={onRunning} />
      {onAddPart ? <button disabled={disabled} onClick={() => onAddPart(item.id)}>Add exact version to this draft</button>
        : <a href={`?harness=published&part=${encodeURIComponent(item.id)}`}>Use exact part in the machine builder</a>}
    </> : <>
      <MachineSandbox key={item.id} machine={selection.machine} catalog={library} onRunning={onRunning} editing={false} />
      <p>{content.kind === 'machine' && content.remixOf
        ? <>Remixed from exact parent <a className="breakable" href={versionUrl(content.remixOf)}>{content.remixOf}</a>.</>
        : 'No parent version was recorded for this machine.'}</p>
      <ul aria-label="Discovered machine source credits">{machineCredits(selection.machine).map((credit) => <li key={credit.versionId} className="breakable">
        Part {credit.versionId}, original author {credit.author}.
      </li>)}</ul>
      <a href={versionUrl(item.id)}>Open exact machine / start a remix</a>
    </>}
    <details><summary>Inspect immutable content and source pins</summary><pre className="breakable">{JSON.stringify(content, null, 2)}</pre></details>
    <p>Inspection and test runs do not save, sign in or change your local draft.</p>
  </section>;
}

function WorkResults({ kind, q, after, library, onNext, onAddPart, disabled }: {
  kind: WorkKind; q: string; after: string | null; library: MachineLibrary; onNext: (id: string) => void;
  onAddPart?: (id: string) => void; disabled: boolean;
}) {
  const [page, setPage] = useState<DiscoveryPage | null>(null);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [selected, setSelected] = useState<WorkSummary | null>(null);
  useEffect(() => {
    let active = true;
    void api(discoveryUrl({ kind, q, after })).then((result) => {
      const checked = parseDiscovery(result, kind);
      if (active) setPage(checked);
    }).catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [kind, q, after, retry]);
  if (error) return <p role="alert">Published discovery is unavailable. Local Vite and the disabled hosted backend return 503.
    This is not an empty-catalogue result. No preview was substituted and your draft is unchanged.
    <button onClick={() => { setError(false); setPage(null); setRetry(retry + 1); }}>Retry discovery</button></p>;
  if (!page) return <p role="status">Loading committed {kind === 'part' ? 'parts' : 'machines'}…</p>;
  return <>
    {!page.items.length && <p role="status">{q ? 'No committed versions match this search.' : 'No committed versions are available yet.'} Public previews remain separate.</p>}
    <ul aria-label={kind === 'part' ? 'Published part library' : 'Published machine gallery'}>{page.items.map((item) => <li key={item.id}>
      <p>{item.workId}: {item.description}{item.tokenId && `, token ${item.tokenId}`}.</p>
      <p className="breakable">Version {item.id}. Author {item.author}. Published {item.publishedAt}.</p>
      <button onClick={() => setSelected(item)}>Inspect and run {item.workId}</button>
    </li>)}</ul>
    {page.next && <button onClick={() => { setSelected(null); onNext(page.next!); }}>Next page of exact versions</button>}
    {selected && <section>
      <h4>Inspect {selected.workId}</h4>
      <button onClick={() => setSelected(null)}>Close inspection</button>
      <WorkInspection key={selected.id} item={selected} library={library} onAddPart={onAddPart} disabled={disabled} />
    </section>}
  </>;
}

export function WorkDiscovery({ library, initialKind = 'part', onAddPart, disabled = false }: {
  library: MachineLibrary; initialKind?: WorkKind; onAddPart?: (id: string) => void; disabled?: boolean;
}) {
  const [kind, setKind] = useState<WorkKind>(initialKind);
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [after, setAfter] = useState<string | null>(null);
  return <section aria-label="Published work discovery">
    <h2>Gallery and part library</h2>
    <p>Browse committed immutable versions without a wallet. New versions never replace old pins. Public-data previews do not appear here.
      No activity or reuse counts are invented. This is a neutral development harness, not the final product design.</p>
    <label>Browse
      <select value={kind} onChange={(e) => { setKind(e.target.value as WorkKind); setAfter(null); }}>
        <option value="part">Reusable holder parts</option><option value="machine">Published machines</option>
      </select>
    </label>
    <form onSubmit={(e) => { e.preventDefault(); setQ(search.trim().toLowerCase()); setAfter(null); }}>
      <label>Search work ID, author, token ID or machine message
        <input type="text" maxLength={80} value={search} onChange={(e) => setSearch(e.target.value)} />
      </label>
      <button type="submit">Search committed works</button>
      <button type="button" onClick={() => { setSearch(''); setQ(''); setAfter(null); }}>Clear search / first page</button>
    </form>
    {after && <button onClick={() => setAfter(null)}>Return to first page</button>}
    <WorkResults key={`${kind}:${q}:${after ?? ''}`} kind={kind} q={q} after={after} library={library}
      onNext={setAfter} onAddPart={onAddPart} disabled={disabled} />
  </section>;
}

export function DiscoveryPageView({ initialKind = 'machine' }: { initialKind?: WorkKind }) {
  const [library, setLibrary] = useState<MachineLibrary | null>(null);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    void MachineLibrary.create((id, source) => api(`/api/versions?id=${encodeURIComponent(id)}${source ? '&source=1' : ''}`))
      .then((value) => { if (active) setLibrary(value); }).catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [retry]);
  return <main>
    <h1>Chogmog</h1><p>Make mischief move.</p>
    <nav><a href="?harness=chain">Run the public-data starter preview</a> · <a href="?harness=machine">Free preview builder</a> · <a href="?harness=published">Published-part draft</a></nav>
    <p>The starter and preview builder use unverified public-data parts, never genuine holder publications. They work without a wallet even while the published backend is unavailable.</p>
    {error ? <p role="alert">Library initialization failed. <button onClick={() => { setError(false); setRetry(retry + 1); }}>Retry library</button></p>
      : library ? <WorkDiscovery library={library} initialKind={initialKind} /> : <p role="status">Preparing exact-version library…</p>}
  </main>;
}
