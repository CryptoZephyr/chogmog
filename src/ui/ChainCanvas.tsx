import { useEffect, useRef, useState } from 'react';
import { DEFAULT_CHAIN, loadChain, saveChain, type ChainScene } from '../domain/chainScene';
import { PREVIEWS, provenance } from '../domain/chog';
import { MAX_TICKS } from '../domain/fallingScene';
import type { ChainStage, ChainView } from '../game/chainStage';
import { WalletPanel } from './WalletPanel';

export function ChainCanvas() {
  const host = useRef<HTMLDivElement>(null);
  const stage = useRef<ChainStage | null>(null);
  const [scene, setScene] = useState(loadChain);
  const initial = useRef(scene);
  const [view, setView] = useState<ChainView | null>(null);
  const [error, setError] = useState(false);
  const [saved, setSaved] = useState(true);
  const [messageInput, setMessageInput] = useState(scene.message);
  useEffect(() => {
    const controller = new AbortController();
    let instance: ChainStage | undefined;
    void import('../game/chainStage').then(({ createChainStage }) => createChainStage(host.current!, initial.current, controller.signal, (next) => {
      if (!controller.signal.aborted) setView(next);
    })).then((created) => {
      if (controller.signal.aborted) created.dispose();
      else { instance = created; stage.current = created; }
    }).catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => { controller.abort(); instance?.dispose(); stage.current = null; };
  }, []);
  const edit = (next: ChainScene) => {
    stage.current?.reset(next); setScene(next); setSaved(saveChain(next));
  };
  const ready = !!view && !error;
  const complete = view?.snapshot.tick === MAX_TICKS;
  const stalled = complete && !view.snapshot.bannerOpen;
  const hint = !view?.snapshot.events.some((e) => e.type === 'sensor') ? 'The ball missed the input sensor. Move its starting X closer to 2.'
    : !view.snapshot.balloonPopped ? 'Check the laser source and aim. The ray must hit the balloon.'
    : !view.snapshot.events.some((e) => e.type === 'lifted') ? 'This lift source has no fire-family Aura. Try token 846.'
    : !view.snapshot.events.some((e) => e.type === 'teleported') ? 'The confetti needs a Wizard-family portal source. Try token 846.'
    : 'Confetti left the portal but missed the lever. Try exit height 4.';

  return <main>
    <h1>Chogmog</h1>
    <p>Make mischief move.</p>
    <h2>First-chain development harness</h2>
    <p>Public-data preview, free to play with no wallet. These are authentic Genesis traits mapped to app behaviours, not holder-authored published parts. Ownership is not verified. This neutral canvas is not the final product design.</p>
    <p>Run the ball → laser → balloon → fire lift → Wizard portal → lever → message. Reset, change an input and run again.</p>
    <p role="status">{error ? 'Physics or WebGL initialization failed. Reload in a supported browser.' : !ready ? 'Loading physics and renderer…' : view.running ? 'Running' : complete ? 'Run complete. Reset to try again.' : 'Ready, paused'}</p>
    <div className="controls">
      <button disabled={!ready || view.running || complete || !messageInput.trim()} onClick={() => stage.current?.run()}>Run</button>
      <button disabled={!ready || !view.running} onClick={() => stage.current?.pause()}>Pause</button>
      <button disabled={!ready} onClick={() => { stage.current?.reset(scene); setMessageInput(scene.message); }}>Reset</button>
    </div>
    <div className="canvas-host" ref={host} />
    <output aria-label="Simulation telemetry">{view ? `Tick ${view.snapshot.tick}/${MAX_TICKS} | ${view.snapshot.bodyCount} physical bodies | Balloon ${view.snapshot.balloonPopped ? 'popped' : 'intact'} | Banner ${view.snapshot.bannerOpen ? 'open' : 'closed'}` : 'Waiting for engine'}</output>
    {view && Object.values(view.artwork).includes('unavailable') && <p role="alert">Some preview artwork is unavailable. Labelled geometry remains playable. Reload to retry.</p>}
    {stalled && <p role="status">Chain stopped: {hint}</p>}
    <fieldset disabled={!ready || view.running}>
      <legend>Starting arrangement, edits reset the run</legend>
      <label>Ball X: {scene.ballX.toFixed(2)}
        <input type="range" min="0.5" max="3.5" step="0.25" value={scene.ballX} onChange={(e) => edit({ ...scene, ballX: Number(e.target.value) })} />
      </label>
      <label>Laser aim: {scene.laserAim.toFixed(2)}
        <input type="range" min="-0.6" max="0.6" step="0.05" value={scene.laserAim} onChange={(e) => edit({ ...scene, laserAim: Number(e.target.value) })} />
      </label>
      <label>Portal exit height: {scene.portalExitY.toFixed(2)}
        <input type="range" min="2" max="6" step="0.25" value={scene.portalExitY} onChange={(e) => edit({ ...scene, portalExitY: Number(e.target.value) })} />
      </label>
      {(['laserToken', 'liftToken', 'portalToken'] as const).map((field) => <label key={field}>{field === 'laserToken' ? 'Laser source' : field === 'liftToken' ? 'Lift source, trait-swap comparison' : 'Portal source, trait-swap comparison'}
        <select value={scene[field]} onChange={(e) => edit({ ...scene, [field]: e.target.value })}>
          <option value="846">Token 846: Fire + Wizard, no laser</option>
          <option value="533">Token 533: cyan laser, no Fire or Wizard</option>
        </select>
      </label>)}
      <label>Message, plain text up to 80 characters
        <input type="text" maxLength={80} value={messageInput} onChange={(e) => { setMessageInput(e.target.value); if (e.target.value.trim()) edit({ ...scene, message: e.target.value }); }} />
      </label>
      {!messageInput.trim() && <p role="alert">Enter a message to run, or Reset to restore the last valid message.</p>}
      <button onClick={() => { edit({ ...DEFAULT_CHAIN }); setMessageInput(DEFAULT_CHAIN.message); }}>Default chain</button>
    </fieldset>
    {!saved && <p role="alert">Local saving is unavailable. This arrangement still works in this tab.</p>}
    <p>Saved only in this browser. Runs stop after 720 fixed ticks and pause in a hidden tab. Reset preserves your arrangement. Switch the lift or portal source to token 533 to see the missing trait break that step.</p>
    <h2>Preview source evidence</h2>
    <p>Monad chain {provenance.chainId}. Token URI observed at block {provenance.tokenURIBlock}. No wallet session or publishing permission is implied.</p>
    {PREVIEWS.map((source) => <details key={source.tokenId}>
      <summary>Token {source.tokenId}, artwork {source.artworkNumber} ({source.metadata.name}). Artwork: {view?.artwork[source.tokenId] ?? 'loading'}</summary>
      <p>Allowed kit: {source.kit.join(', ')}. This harness executes release, laser, lift and portal only.</p>
      <p>Original token URI: <code className="breakable">{source.tokenURI}</code></p>
      <ul>{source.metadata.attributes.map((trait) => <li key={trait.trait_type}>{trait.trait_type}: {trait.value}</li>)}</ul>
      <a href={`https://opensea.io/item/monad/${provenance.collection}/${source.tokenId}`} target="_blank" rel="noreferrer">Inspect source token {source.tokenId}</a>
      {view?.artwork[source.tokenId] === 'unavailable' && <p role="alert">Artwork unavailable. Labelled geometry remains playable. Reload to retry.</p>}
    </details>)}
    <details><summary>Tick-level causal evidence ({view?.snapshot.events.length ?? 0} events)</summary>
      <ol>{view?.snapshot.events.map((event, index) => <li key={index}>Tick {event.tick}: {event.actor} → {event.type} → {event.target}{event.sourceToken ? ` (source token ${event.sourceToken})` : ''}</li>)}</ol>
    </details>
    <p><a href="?harness=falling">Open the original T0 falling-body harness</a></p>
    <p><a href="?harness=machine">Build a free machine from labelled public-preview parts</a></p>
    <WalletPanel />
  </main>;
}
