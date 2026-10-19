import { useCallback, useEffect, useRef, useState } from 'react';
import { MAX_TICKS, WORLD_HEIGHT, WORLD_WIDTH } from '../domain/fallingScene';
import { PreviewCatalog, loadMachineDraft, newMachineDraft, PREVIEW_ACTIONS, saveMachineDraft,
  type Machine, type PreviewAction } from '../domain/machineDraft';
import type { Connection, Endpoint, Prop, Scene } from '../domain/documents';
import { MachineSandbox } from './MachineSandbox';

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

export function MachineComposer() {
  const [catalog, setCatalog] = useState<PreviewCatalog | null>(null);
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
    void PreviewCatalog.create().then(async (preview) => ({ catalog: preview, ...(await loadMachineDraft(storage, preview)) }))
      .then(({ catalog, machine, recovered }) => {
        if (!active) return;
        draft.current = machine.scene; lastValid.current = machine.scene;
        setCatalog(catalog); setMachine(machine); setRecovered(recovered); setMessage(machine.scene.message);
      }).catch(() => { if (active) setError('Public preview sources are unavailable. Reload to try again.'); });
    return () => { active = false; mounted.current = false; };
  }, []);

  const edit = async (change: (draft: Scene) => void) => {
    if (!catalog || !machine || running) return;
    const cycle = ++operation.current;
    const next = structuredClone(draft.current ?? machine.scene);
    try {
      change(next);
      draft.current = next;
      setBusy(true); setError('');
      const valid = await catalog.validate(next);
      if (!mounted.current || operation.current !== cycle) return;
      const persisted = await saveMachineDraft({ setItem: (key, value) => {
        if (!mounted.current || operation.current !== cycle) throw new Error('Superseded edit');
        storage.setItem(key, value);
      } }, catalog, valid.scene);
      if (!mounted.current || operation.current !== cycle) return;
      lastValid.current = valid.scene; draft.current = valid.scene;
      setMachine(valid); setSaved(persisted); setMessage(valid.scene.message);
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

  return <main>
    <h1>Chogmog</h1>
    <p>Make mischief move.</p>
    <h2>Free machine composition development harness</h2>
    <p>No wallet is needed. These pinned parts come from authentic public Genesis snapshots. They are unverified previews, not holder-authored publications or a genuine part catalogue. This neutral editor is not the final product design. Machine publication remains unavailable.</p>
    <p><a href="?harness=chain">First-chain preview</a> · <a href="?harness=falling">Original physics harness</a></p>
    {!machine || !catalog ? <p role="status">{error || 'Loading pinned preview parts and local draft…'}</p> : <>
      {!recovered && <p role="alert">The previous local draft could not be read or trusted. A fresh preview draft was opened. No holder authority was restored.</p>}
      {!saved && <p role="alert">Local saving is unavailable. This draft still works in this tab, but a reload may lose your edits.</p>}
      {error && <p role="alert">Change rejected: {error}. Your last valid draft is kept.</p>}
      <p role="status">{busy ? 'Checking and saving the exact draft…' : saved ? 'Local draft ready' : 'Draft not saved'}. {machine.scene.parts.length} reusable preview parts. No holder authority.</p>
      <MachineSandbox key={machine.id} machine={machine} catalog={catalog} onRunning={onRunning} editing={busy} />
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
          if (window.confirm('Replace this local draft with a new preview machine? The current draft will be overwritten.')) {
            const fresh = newMachineDraft(catalog);
            void edit((s) => { Object.assign(s, fresh); });
          }
        }}>Start a new local draft</button>
        <p>Draft ID: <code className="breakable">{machine.id}</code>. This is a content hash, not a publication receipt.</p>
      </fieldset>
      <fieldset disabled={running}>
        <legend>Place and adjust preview parts</legend>
        <label>Add a pinned source part
          <select value={sourceKind} onChange={(e) => setSourceKind(e.target.value as PreviewAction)}>
            {PREVIEW_ACTIONS.map((kind) => <option key={kind} value={kind}>{kind}, token {catalog.get(kind).content.source.nft.tokenId} (public preview)</option>)}
          </select>
        </label>
        <button disabled={machine.scene.parts.length >= 6} onClick={() => void edit((s) => {
          const position = sourceKind === 'release' ? { x: 0, y: 4.5 } : sourceKind === 'laser' ? { x: 3, y: 2 } :
            sourceKind === 'lift' ? { x: 4.5, y: 0 } : sourceKind === 'portal' ? { x: 6.5, y: 0 } : { x: 1, y: 1 };
          s.parts.push({ id: nextId(s, sourceKind), versionId: catalog.get(sourceKind).id, ...position, values: {} });
        })}>Add preview part</button>
        {machine.scene.parts.map((part) => {
          const entry = machine.expanded.find((item) => item.instanceId === part.id)!;
          const bounds = entry.configured.bounds;
          return <fieldset key={part.id}>
            <legend>{part.id}: {entry.configured.actions[0].type} from public token {entry.version.content.source.nft.tokenId}</legend>
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
      <details><summary>Exact preview source versions and credits</summary>
        <p>These are local public-data demonstrations. The named account below is a demo placeholder, never a verified holder or a published part author. No real reuse counts are recorded.</p>
        <ul>{machine.expanded.map(({ instanceId, version }) => <li key={instanceId}>
          {instanceId}: public token {version.content.source.nft.tokenId}, artwork {version.content.source.artworkNumber},
          {catalog.source(PREVIEW_ACTIONS.find((kind) => catalog.get(kind).id === version.id)!).metadata.name}.
          Version <code className="breakable">{version.id}</code>. Source metadata SHA-256 <code className="breakable">{version.content.source.metadataSha256}</code>.
          Original source address <code>{version.content.source.nft.collection}</code>.
        </li>)}</ul>
      </details>
      <p>Drafts stay in this browser. There is no wallet, publication button, genuine catalogue entry or holder credit in this local preview.</p>
    </>}
  </main>;
}
