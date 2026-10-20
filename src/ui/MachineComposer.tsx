import { useCallback, useEffect, useRef, useState } from 'react';
import { MAX_TICKS, WORLD_HEIGHT, WORLD_WIDTH } from '../domain/fallingScene';
import { MACHINE_DRAFT_KEY, loadMachineDraft, newMachineDraft, PREVIEW_ACTIONS, saveMachineDraft,
  type Machine, type PreviewAction } from '../domain/machineDraft';
import type { Connection, Endpoint, Prop, Scene } from '../domain/documents';
import { MachineSandbox } from './MachineSandbox';
import { MachineLibrary, PUBLISHED_DRAFT_KEY } from '../domain/machineLibrary';
import { api } from './walletClient';
import { WalletPanel } from './WalletPanel';
import { MachinePublication } from './MachinePublication';
import { WorkDiscovery } from './WorkDiscovery';
import { AppFrame } from './AppFrame';

const storage = {
  getItem: (key: string) => window.localStorage.getItem(key),
  setItem: (key: string, value: string) => window.localStorage.setItem(key, value),
};
type Port = { key: string; endpoint: Endpoint; kind: 'event' | 'body'; direction: 'input' | 'output' };

function availablePorts(machine: Machine): Port[] {
  const ports: Port[] = [];
  const add = (id: string, socket: string, direction: Port['direction'], kind: Port['kind']) => {
    ports.push({ key: `${id}.${socket}`, endpoint: { objectId: id, socket }, direction, kind });
  };
  for (const prop of machine.scene.props) {
    if (prop.type === 'sensor') { add(prop.id, 'body', 'input', 'body'); add(prop.id, 'triggered', 'output', 'event'); }
    if (prop.type === 'ball') { add(prop.id, 'release', 'input', 'event'); add(prop.id, 'body', 'output', 'body'); add(prop.id, 'contact', 'output', 'event'); }
    if (prop.type === 'balloon') { add(prop.id, 'hit', 'input', 'event'); add(prop.id, 'popped', 'output', 'event'); add(prop.id, 'confetti', 'output', 'body'); }
    if (prop.type === 'lever') { add(prop.id, 'hit', 'input', 'event'); add(prop.id, 'activated', 'output', 'event'); }
    if (prop.type === 'banner') add(prop.id, 'open', 'input', 'event');
  }
  for (const part of machine.expanded) for (const socket of part.configured.sockets) {
    add(part.instanceId, socket.id, socket.direction, socket.kind);
  }
  return ports;
}

function nextId(scene: Scene, prefix: string): string {
  const ids = new Set([...scene.props.map((p) => p.id), ...scene.parts.map((p) => p.id), ...scene.inputs.map((p) => p.id)]);
  for (let i = 1; i <= 200; i++) if (!ids.has(`${prefix}-${i}`)) return `${prefix}-${i}`;
  throw new Error('No available ID');
}

export function MachineComposer({ publishedMode = false }: { publishedMode?: boolean }) {
  const [catalog, setCatalog] = useState<MachineLibrary | null>(null);
  const [partId, setPartId] = useState(() => publishedMode ? new URLSearchParams(location.search).get('part') ?? '' : '');
  const [publishedAt, setPublishedAt] = useState<string | null>(null);
  const draftKey = publishedMode ? PUBLISHED_DRAFT_KEY : MACHINE_DRAFT_KEY;
  const [machine, setMachine] = useState<Machine | null>(null);
  const [saved, setSaved] = useState(true);
  const [recovered, setRecovered] = useState(true);
  const [running, setRunning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [sourceKind, setSourceKind] = useState<PreviewAction>('lift');
  const [wireFrom, setWireFrom] = useState('sensor.triggered');
  const [wireTo, setWireTo] = useState('laser.in');
  const [inputTarget, setInputTarget] = useState('release.in');
  const [inputTick, setInputTick] = useState(0);
  const operation = useRef(0);
  const mounted = useRef(false);
  const draft = useRef<Scene | null>(null);
  const lastValid = useRef<Scene | null>(null);
  const onRunning = useCallback((value: boolean) => setRunning(value), []);

  useEffect(() => {
    let active = true;
    mounted.current = true;
    void MachineLibrary.create((id, source) => api(`/api/versions?id=${encodeURIComponent(id)}${source ? '&source=1' : ''}`), publishedMode ? 'published' : 'preview')
      .then(async (library) => {
        const id = publishedMode ? new URLSearchParams(location.search).get('version') : null;
        if (id) {
          const reopened = await library.reopen(id);
          return { catalog: library, machine: reopened.machine, recovered: true, publishedAt: reopened.publishedAt };
        }
        return { catalog: library, ...(await loadMachineDraft(storage, library,
          publishedMode ? () => library.newPublishedDraft() : undefined, draftKey)), publishedAt: null };
      })
      .then(({ catalog, machine, recovered, publishedAt }) => {
        if (!active) return;
        draft.current = machine.scene; lastValid.current = machine.scene;
        setCatalog(catalog); setMachine(machine); setRecovered(recovered); setMessage(machine.scene.message); setPublishedAt(publishedAt);
      }).catch(() => { if (active) setError('Exact machine or sources unavailable. Your saved draft was not changed. Return to your draft or retry later.'); });
    return () => { active = false; mounted.current = false; };
  }, [publishedMode, draftKey]);

  const edit = async (change: (draft: Scene) => void) => {
    if (!catalog || !machine || running) return;
    const cycle = ++operation.current;
    const next = structuredClone(draft.current ?? machine.scene);
    try {
      if (publishedAt) {
        Object.assign(next, catalog.remix(machine));
      }
      change(next);
      draft.current = next;
      setBusy(true); setError('');
      const valid = await catalog.validate(next);
      if (!mounted.current || operation.current !== cycle) return;
      const persisted = await saveMachineDraft({ setItem: (key, value) => {
        if (!mounted.current || operation.current !== cycle) throw new Error('Superseded edit');
        storage.setItem(key, value);
      } }, catalog, valid.scene, draftKey);
      if (!mounted.current || operation.current !== cycle) return;
      lastValid.current = valid.scene; draft.current = valid.scene;
      setMachine(valid); setSaved(persisted); setMessage(valid.scene.message); setPublishedAt(null);
    } catch (failure) {
      if (mounted.current && operation.current === cycle) {
        draft.current = lastValid.current;
        setError(failure instanceof Error ? failure.message : 'Invalid machine change');
      }
    } finally { if (mounted.current && operation.current === cycle) setBusy(false); }
  };
  const ports = machine ? availablePorts(machine) : [];
  const outputs = ports.filter((port) => port.direction === 'output');
  const from = outputs.find((port) => port.key === wireFrom);
  const targets = ports.filter((port) => port.direction === 'input' && port.kind === from?.kind);
  const target = targets.find((port) => port.key === wireTo);
  const timed = ports.filter((port) => port.direction === 'input' && port.kind === 'event');
  const currentInput = timed.find((port) => port.key === inputTarget);
  const exactConnection = (connection: Connection) => `${connection.from.objectId}.${connection.from.socket} → ${connection.to.objectId}.${connection.to.socket}`;

  return <AppFrame tab="build" layout="workspace">
    <section className="panel ws-main" aria-label="Machine">
    <h1 className="screen-title">{publishedMode ? 'Build with published parts' : 'Build a machine'}</h1>
    <p className="fineprint">{publishedMode ? 'Loading, composing and replaying exact published parts needs no wallet or NFT. Publication requires optional sign-in, never NFT ownership. Parts only appear after genuine holder publication. Local Vite cannot load published parts.' : 'No wallet is needed. These pinned parts come from authentic public Genesis snapshots. They are unverified previews, not holder-authored publications or a genuine part catalogue. Machine publication remains unavailable in preview mode.'}</p>
    <p className="fineprint"><a href="?harness=library">Part library</a> · <a href="?harness=falling">Physics test bench</a> · <a href={publishedMode ? '?harness=machine' : '?harness=published'}>{publishedMode ? 'Open the wallet-free public-preview builder' : 'Open the published-part builder'}</a>{publishedMode && <> · <a href="?harness=published">Return to your last published-part draft</a></>}</p>
    <div className="caption-box mobile-only">Building needs a bigger screen. You can still run and watch here.</div>
    {!machine || !catalog ? <p role="status">{error || 'Loading pinned preview parts and local draft…'}</p> : <>
      {!recovered && <p role="alert">The previous local draft or its exact sources could not be read or trusted. A fresh draft was opened without overwriting the saved one. No holder authority was restored.</p>}
      {!saved && <p role="alert">Local saving is unavailable. This draft still works in this tab, but a reload may lose your edits.</p>}
      {error && <p role="alert">Change rejected: {error}. Your last valid draft is kept.</p>}
      <p role="status">{busy ? 'Checking and saving the exact draft…' : saved ? 'Local draft ready' : 'Draft not saved'}. {machine.scene.parts.length} reusable parts. Composition grants no holder authority.</p>
      {publishedAt && <p className="breakable">Reopened exact published version {machine.id} from {publishedAt}. Editing starts a new machine ID for a remix and leaves the original unchanged.</p>}
      {machine.scene.remixOf && <p className="breakable">Remix lineage: <a href={`?harness=published&version=${encodeURIComponent(machine.scene.remixOf)}`}>{machine.scene.remixOf}</a>. Original source parts and credits remain pinned.</p>}
      {publishedAt && <button disabled={busy || running} onClick={() => {
        if (window.confirm('Create a remix and replace your saved local published-part draft? The original publication stays unchanged.')) void edit(() => {});
      }}>Remix as a new local draft</button>}
      <MachineSandbox key={machine.id} machine={machine} catalog={catalog} onRunning={onRunning} editing={busy} />
    </>}
    </section>
    {machine && catalog && <div className="ws-side">
      <fieldset disabled={running}>
        <legend>Machine draft, edits rebuild and reset the run</legend>
        <label>Machine ID
          <input type="text" maxLength={64} value={machine.scene.machineId}
            onChange={(e) => { const value = e.target.value; void edit((s) => { s.machineId = value; }); }} />
        </label>
        <label>Message, plain text up to 80 characters
          <input type="text" maxLength={80} value={message} onChange={(e) => {
            setMessage(e.target.value);
            if (e.target.value.trim()) void edit((s) => { s.message = e.target.value; });
          }} />
        </label>
        {!message.trim() && <p role="alert">Enter a message to save a change.</p>}
        <button onClick={() => {
          if (window.confirm('Replace this local draft with a new machine? The current draft will be overwritten.')) {
            const fresh = publishedMode ? catalog.newPublishedDraft() : newMachineDraft(catalog);
            void edit((s) => { delete s.remixOf; Object.assign(s, fresh); });
          }
        }}>Start a new local draft</button>
        <p>Draft ID: <code className="breakable">{machine.id}</code>. This is a content hash, not a publication receipt.</p>
      </fieldset>
      <fieldset disabled={running}>
        <legend>Place and adjust exact parts</legend>
        {!publishedMode && <><label>Add a pinned source part
          <select value={sourceKind} onChange={(e) => setSourceKind(e.target.value as PreviewAction)}>
            {PREVIEW_ACTIONS.map((kind) => <option key={kind} value={kind}>{kind}, token {catalog.get(kind).content.source.nft.tokenId} (public preview)</option>)}
          </select>
        </label>
        <button disabled={machine.scene.parts.length >= 6} onClick={() => void edit((s) => {
          const position = sourceKind === 'release' ? { x: 0, y: 4.5 } : sourceKind === 'laser' ? { x: 3, y: 2 } :
            sourceKind === 'lift' ? { x: 4.5, y: 0 } : sourceKind === 'portal' ? { x: 6.5, y: 0 } : { x: 1, y: 1 };
          s.parts.push({ id: nextId(s, sourceKind), versionId: catalog.get(sourceKind).id, ...position, values: {} });
        })}>Add preview part</button></>}
        {publishedMode && <>
          <p>Use an exact committed part ID from its author or browse the library below. No fixture can fill this genuine library.</p>
          <label>Published part version ID<input type="text" maxLength={71} value={partId} disabled={busy} onChange={(e) => setPartId(e.target.value)} /></label>
          <button disabled={busy || machine.scene.parts.length >= 6 || !/^sha256:[a-f0-9]{64}$/.test(partId)} onClick={() => {
            const id = partId;
            void edit((s) => { s.parts.push({ id: nextId(s, 'part'), versionId: id, x: 0, y: 0, values: {} }); });
          }}>Load and add exact published part</button>
        </>}
        {machine.scene.parts.map((part) => {
          const entry = machine.expanded.find((item) => item.instanceId === part.id)!;
          const bounds = entry.configured.bounds;
          return <fieldset key={part.id}>
            <legend>{!catalog.isPublished(part.versionId) && <span className="tape-inline">PREVIEW</span>}{part.id}: {entry.configured.actions[0].type}, token {entry.version.content.source.nft.tokenId}, {catalog.isPublished(part.versionId) ? 'holder-published immutable version' : 'unverified public-data preview'}</legend>
            {(['x', 'y'] as const).map((axis) => <label key={axis}>{axis.toUpperCase()} position {part[axis].toFixed(2)}
              <input type="range" min="0" max={axis === 'x' ? WORLD_WIDTH - bounds.width : WORLD_HEIGHT - bounds.height} step="0.25"
                value={part[axis]} onChange={(e) => void edit((s) => { s.parts.find((p) => p.id === part.id)![axis] = Number(e.target.value); })} />
            </label>)}
            {entry.configured.controls.map((control) => <label key={control.id}>Exposed {control.id}: {(part.values[control.id] ?? control.default).toFixed(2)}
              <input type="range" min={control.min} max={control.max} step={control.field === 'angle' ? 0.05 : 0.5}
                value={part.values[control.id] ?? control.default}
                onChange={(e) => void edit((s) => { s.parts.find((p) => p.id === part.id)!.values[control.id] = Number(e.target.value); })} />
            </label>)}
            <button onClick={() => void edit((s) => {
              s.parts = s.parts.filter((p) => p.id !== part.id);
              s.connections = s.connections.filter((c) => c.from.objectId !== part.id && c.to.objectId !== part.id);
              s.inputs = s.inputs.filter((i) => i.target.objectId !== part.id);
            })}>Remove {part.id}</button>
          </fieldset>;
        })}
      </fieldset>
      <fieldset disabled={running}>
        <legend>Ordinary props and trigger positions</legend>
        {(['sensor', 'ball', 'ramp'] as const).map((kind) => <button key={kind} disabled={machine.scene.props.length >= 30}
          onClick={() => void edit((s) => {
            const id = nextId(s, kind);
            const prop: Prop = kind === 'sensor' ? { id, type: 'sensor', x: 2, y: 3, width: 0.6, height: 0.3 } :
              kind === 'ball' ? { id, type: 'ball', x: 2, y: 5, radius: 0.18, restitution: 0.5 } :
                { id, type: 'ramp', x: 5, y: 1, width: 2, height: 0.2, angle: -0.25 };
            s.props.push(prop);
          })}>Add {kind}</button>)}
        {machine.scene.props.map((prop) => <fieldset key={prop.id}>
          <legend>{prop.id}: {prop.type}</legend>
          {(['x', 'y'] as const).map((axis) => <label key={axis}>{axis.toUpperCase()} position {prop[axis].toFixed(2)}
            <input type="range" min="0" max={axis === 'x' ? WORLD_WIDTH : WORLD_HEIGHT} step="0.25" value={prop[axis]}
              onChange={(e) => void edit((s) => { s.props.find((p) => p.id === prop.id)![axis] = Number(e.target.value); })} />
          </label>)}
          <button onClick={() => void edit((s) => {
            s.props = s.props.filter((p) => p.id !== prop.id);
            s.connections = s.connections.filter((c) => c.from.objectId !== prop.id && c.to.objectId !== prop.id);
            s.inputs = s.inputs.filter((i) => i.target.objectId !== prop.id);
          })}>Remove {prop.id}</button>
        </fieldset>)}
      </fieldset>
      <fieldset disabled={running}>
        <legend>Wire typed outputs to inputs</legend>
        <p>Events trigger actions. Body wires identify bodies for linked sensors, lift and portal parts; geometry and physics still decide whether they enter an action region. Push, release, laser and lever actions fire once per run. Reset rearms them.</p>
        <label>From output <select value={from?.key ?? ''} onChange={(e) => { setWireFrom(e.target.value); setWireTo(''); }}>
          <option value="">Choose output</option>
          {outputs.map((port) => <option key={port.key} value={port.key}>{port.key} ({port.kind})</option>)}
        </select></label>
        <label>To matching input <select value={target?.key ?? ''} onChange={(e) => setWireTo(e.target.value)}>
          <option value="">Choose input</option>
          {targets.map((port) => <option key={port.key} value={port.key}>{port.key} ({port.kind})</option>)}
        </select></label>
        <button disabled={!from || !target || machine.scene.connections.length >= 200} onClick={() => void edit((s) => {
          s.connections.push({ from: from!.endpoint, to: target!.endpoint });
        })}>Add wire</button>
        <ul>{machine.scene.connections.map((connection, index) => <li key={exactConnection(connection)}>
          {exactConnection(connection)} <button onClick={() => void edit((s) => { s.connections.splice(index, 1); })}>Remove wire {index + 1}</button>
        </li>)}</ul>
      </fieldset>
      <fieldset disabled={running}>
        <legend>Scheduled event inputs</legend>
        <label>Target <select value={currentInput?.key ?? ''} onChange={(e) => setInputTarget(e.target.value)}>
          <option value="">Choose event input</option>
          {timed.map((port) => <option key={port.key} value={port.key}>{port.key}</option>)}
        </select></label>
        <label>Start tick {inputTick} <input type="range" min="0" max={MAX_TICKS - 1} value={inputTick}
          onChange={(e) => setInputTick(Number(e.target.value))} /></label>
        <button disabled={!currentInput || machine.scene.inputs.length >= 200} onClick={() => void edit((s) => {
          s.inputs.push({ id: nextId(s, 'input'), tick: inputTick, target: currentInput!.endpoint });
        })}>Add input</button>
        <ul>{machine.scene.inputs.map((input) => <li key={input.id}>
          Tick {input.tick}: {input.target.objectId}.{input.target.socket}
          <button onClick={() => void edit((s) => { s.inputs = s.inputs.filter((item) => item.id !== input.id); })}>Remove {input.id}</button>
        </li>)}</ul>
      </fieldset>
      <details><summary>Exact source versions and credits</summary>
        <p>Public previews use a demo placeholder, never a verified holder identity. Holder-published versions retain the original author and reuse permission after NFT transfers. A historical publication is not a current-ownership claim. No preview reuse counts are recorded.</p>
        <ul>{machine.expanded.map(({ instanceId, version }) => <li key={instanceId}>
          {instanceId}: {catalog.isPublished(version.id) ? 'holder-published' : 'public-data preview'}, token {version.content.source.nft.tokenId}, artwork {version.content.source.artworkNumber}.
          Original author <code>{version.content.author}</code>. Reuse permitted: {String(version.content.reuseAllowed)}.
          Version <code className="breakable">{version.id}</code>. Source metadata SHA-256 <code className="breakable">{version.content.source.metadataSha256}</code>.
          Original source address <code>{version.content.source.nft.collection}</code>.
        </li>)}</ul>
      </details>
      {publishedMode && <WorkDiscovery library={catalog} disabled={running || busy || machine.scene.parts.length >= 6} onAddPart={(id) => {
        if (!busy && !running && machine.scene.parts.length < 6) void edit((s) => {
          s.parts.push({ id: nextId(s, 'part'), versionId: id, x: 0, y: 0, values: {} });
        });
      }} />}
      {publishedMode ? <WalletPanel ownerTools={false}>{(address) =>
        <MachinePublication key={`${machine.id}:${address}:${running}:${busy}`} machine={machine} library={catalog} address={address} disabled={running || busy} />
      }</WalletPanel> : <p>Drafts stay in this browser. There is no wallet or publication action in this public preview.</p>}
    </div>}
  </AppFrame>;
}
