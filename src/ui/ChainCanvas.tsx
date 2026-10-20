import { useEffect, useRef, useState } from 'react';
import { DEFAULT_CHAIN, loadChain, saveChain, type ChainScene } from '../domain/chainScene';
import { getPreview, PREVIEWS, provenance, type Preview } from '../domain/chog';
import { MAX_TICKS } from '../domain/fallingScene';
import type { ChainStage, ChainView, StopPoint } from '../game/chainStage';
import { abilityTone, colour, laserTone, wallFor } from './tokens';
import { AppFrame } from './AppFrame';
import { WalletPanel } from './WalletPanel';
import { comicStrip } from './comicStrip';
import { createSoundPlayer, loadSoundOn, saveSoundOn, type SoundPlayer } from './sound';

type Power = 'laser' | 'lift' | 'portal';
const POWER_TRAIT: Record<Power, string> = { laser: 'laser eyes', lift: 'Fire aura', portal: 'Wizard hat' };
const POWER_NAME: Record<Power, string> = { laser: 'Laser', lift: 'Lift', portal: 'Portal' };
const FIELD: Record<Power, 'laserToken' | 'liftToken' | 'portalToken'> = { laser: 'laserToken', lift: 'liftToken', portal: 'portalToken' };
const STOPPED: Record<StopPoint, string> = {
  trigger: 'Stopped at the trigger. Move the ball start closer to 2.',
  laser: 'Stopped at the laser. Nudge the aim and try again.',
  lift: 'Stopped at the lift. Needs a Fire aura, so try Chog #338.',
  portal: 'Stopped at the portal. Needs a Wizard hat, so try Chog #338.',
  lever: 'Stopped at the lever. The confetti missed. Try exit height 4.',
};
const PLAY_WALL = wallFor(getPreview('846').metadata.attributes.find((t) => t.trait_type === 'Background')?.value);
const chogName = (source: Preview) => `Chog #${source.artworkNumber}`;
const toneFor = (power: Power, source: Preview) => power === 'laser'
  ? laserTone(source.metadata.attributes.find((t) => t.trait_type === 'Eyes')?.value)?.deep ?? colour.ink
  : abilityTone[power].deep;

function ArtTile({ bitmap, status, label }: { bitmap?: ImageBitmap; status: string; label: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const context = canvas.current?.getContext('2d');
    if (!context || !bitmap) return;
    try { context.drawImage(bitmap, 0, 0, 144, 144); } catch { /* The stage closed this bitmap during remount. */ }
  }, [bitmap]);
  if (!bitmap) return <div className="art-missing" role="img" aria-label={label}>{status === 'unavailable' ? 'Art unavailable' : 'Loading art'}</div>;
  return <canvas ref={canvas} width={144} height={144} role="img" aria-label={label} />;
}

export function ChainCanvas() {
  const host = useRef<HTMLDivElement>(null);
  const stage = useRef<ChainStage | null>(null);
  const [scene, setScene] = useState(loadChain);
  const initial = useRef(scene);
  const [view, setView] = useState<ChainView | null>(null);
  const [error, setError] = useState(false);
  const [saved, setSaved] = useState(true);
  const [messageInput, setMessageInput] = useState(scene.message);
  const [labels, setLabels] = useState(false);
  const [soundOn, setSoundOn] = useState(() => loadSoundOn());
  const sound = useRef<SoundPlayer | null>(null);
  const [runs, setRuns] = useState(0);
  const [coachOff, setCoachOff] = useState(false);
  const [walletOpen, setWalletOpen] = useState(false);
  const keys = useRef<(event: KeyboardEvent) => void>(() => undefined);
  const runbar = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const bar = runbar.current, page = bar?.closest<HTMLElement>('.app');
    if (!bar || !page || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => page.style.setProperty('--runbar-h', `${bar.offsetHeight}px`));
    observer.observe(bar);
    return () => { observer.disconnect(); page.style.removeProperty('--runbar-h'); };
  }, []);

  useEffect(() => {
    const player = createSoundPlayer(loadSoundOn());
    sound.current = player;
    return () => { player.dispose(); if (sound.current === player) sound.current = null; };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let instance: ChainStage | undefined;
    void import('../game/chainStage').then(({ createChainStage }) => createChainStage(host.current!, initial.current, controller.signal, (next) => {
      if (!controller.signal.aborted) setView(next);
    }, (type) => sound.current?.play(type))).then((created) => {
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
  const canRun = ready && !view.running && !complete && !!messageInput.trim();
  const run = () => { if (!canRun) return; if (view.snapshot.tick === 0) setRuns((n) => n + 1); sound.current?.unlock(); stage.current?.run(); };
  const pause = () => { if (ready && view.running) stage.current?.pause(); };
  const reset = () => { if (!ready) return; stage.current?.reset(scene); setMessageInput(scene.message); };
  const toggleSound = () => { const next = !soundOn; setSoundOn(next); saveSoundOn(next); sound.current?.setEnabled(next); };
  const toggleLabels = () => { const next = !labels; setLabels(next); stage.current?.setLabels(next); };

  useEffect(() => {
    keys.current = (event) => {
      const target = event.target as HTMLElement | null;
      if (event.metaKey || event.ctrlKey || event.altKey || target?.closest('input, select, textarea, button, a, summary')) return;
      if (event.key === ' ') { event.preventDefault(); if (view?.running) pause(); else run(); }
      else if (event.key === 'r' || event.key === 'R') reset();
      else if (event.key === 'l' || event.key === 'L') toggleLabels();
    };
  });
  useEffect(() => {
    const listener = (event: KeyboardEvent) => keys.current(event);
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);

  const stopKey = stalled ? (view.snapshot.events.some((e) => e.type === 'sensor') ? (view.snapshot.balloonPopped
    ? (view.snapshot.events.some((e) => e.type === 'lifted') ? (view.snapshot.events.some((e) => e.type === 'teleported') ? 'lever' : 'portal') : 'lift')
    : 'laser') : 'trigger') : null;
  const coach = coachOff || !ready || view.running || stopKey ? null
    : runs === 0 ? { text: 'Press Run.', field: null }
    : runs === 1 && complete ? { text: "That's the chain. Change one thing.", field: 'portalExitY' }
    : runs >= 2 && complete && scene.liftToken === '846' ? { text: 'Now swap the Fire Chog.', field: 'liftToken' }
    : null;
  const stopHint = stopKey ? (stopKey === 'laser' && !getPreview(scene.laserToken).kit.includes('laser') ? 'Stopped at the laser. Needs laser eyes, so try Chog #25.' : STOPPED[stopKey]) : null;
  const strip = view ? comicStrip(view.snapshot.events, scene.message, stopKey) : [];
  const status = error ? 'Physics or WebGL failed to start. Reload in a supported browser.' : !ready ? 'Loading physics and renderer' : view.running ? 'Watch it go' : complete ? 'Run complete. Reset to run again.' : view.snapshot.tick > 0 ? 'Paused' : 'Ready';
  const highlight = (field: string) => (coach?.field === field ? { outline: `3px solid ${colour.blush}`, outlineOffset: 4, borderRadius: 4 } : undefined);

  const signIn = () => { setWalletOpen(true); requestAnimationFrame(() => document.getElementById('sign-in')?.scrollIntoView({ block: 'nearest' })); };
  return <AppFrame tab="play" layout="play" wall={PLAY_WALL} onSignIn={signIn}>
    <aside className="panel tray" aria-label="Chogs in this machine">
      <h2 className="panel-title">Chogs in this machine</h2>
      {PREVIEWS.filter((source) => (['laser', 'lift', 'portal'] as const).some((power) => scene[FIELD[power]] === source.tokenId)).map((source) => {
        const powers = (['laser', 'lift', 'portal'] as const).filter((power) => scene[FIELD[power]] === source.tokenId && source.kit.includes(power));
        return <article className="chog-card" key={source.tokenId}>
          <span className="tape" aria-hidden="true">PREVIEW</span>
          <ArtTile bitmap={view?.bitmaps[source.tokenId]} status={view?.artwork[source.tokenId] ?? 'loading'} label={`${chogName(source)} artwork`} />
          <div>
            <h3>{chogName(source)}</h3>
            <p className="token">Token {source.tokenId}</p>
          </div>
          <ul className="abilities">
            {powers.map((power) => <li key={power}><span className="swatch" style={{ background: toneFor(power, source) }} />{POWER_NAME[power]}, from {source.metadata.attributes.find((t) => (power === 'lift' ? t.trait_type === 'Aura' : power === 'portal' ? t.trait_type === 'Head' : t.trait_type === 'Eyes'))?.value}</li>)}
            <li><span className="swatch" style={{ background: colour.ink }} />Push and release</li>
          </ul>
        </article>;
      })}
      <p className="fineprint">Preview parts. Public Chog data, not a holder upload. Free to play with no wallet, and ownership isn't checked here.</p>
    </aside>

    <section className="play" aria-label="Play">
      <div className="panel stage-panel"><div className="canvas-host" ref={host} /></div>
      <ul className="panel stage-legend mobile-only" aria-label="Which Chog powers what">
        {(['laser', 'lift', 'portal'] as const).map((power) => {
          const source = getPreview(scene[FIELD[power]]);
          const trait = source.metadata.attributes.find((t) => (power === 'lift' ? t.trait_type === 'Aura' : power === 'portal' ? t.trait_type === 'Head' : t.trait_type === 'Eyes'));
          return <li key={power}><span className="swatch" style={{ background: source.kit.includes(power) ? toneFor(power, source) : colour.panel }} />
            {POWER_NAME[power]}: {source.kit.includes(power) ? `${chogName(source)}, ${trait?.trait_type} ${trait?.value}` : `${chogName(source)} has no ${POWER_TRAIT[power]}`}</li>;
        })}
      </ul>
      <div className="panel runbar" ref={runbar}>
        <button className="run" disabled={!canRun} onClick={run}>Run</button>
        <button className="btn" disabled={!ready || !view.running} onClick={pause}>Pause</button>
        <button className="btn" disabled={!ready} onClick={reset}>Reset</button>
        <label className="toggle"><input type="checkbox" checked={labels} onChange={toggleLabels} /> Show labels</label>
        <label className="toggle"><input type="checkbox" checked={soundOn} onChange={toggleSound} /> Sound</label>
        <p className="status" role="status">{status}</p>
        <span className="tick" aria-hidden="true">Tick {view?.snapshot.tick ?? 0}/{MAX_TICKS}</span>
      </div>
      {stopHint && <div className="caption-box stopped" role="status"><span className="x-stamp" aria-hidden="true">X</span>{stopHint}</div>}
      {strip.length > 0 && <ol className="panel strip" aria-label="Comic strip of this run" aria-live="polite">
        {strip.map((panel) => <li key={panel.key} className={panel.stopped ? 'stopped' : undefined} style={{ borderTopColor: panel.tone }}>
          {panel.stopped ? <span className="x-stamp" aria-hidden="true">X</span> : <span className="sound-word" aria-hidden="true">{panel.word}</span>}
          <span className="strip-caption">{panel.caption}</span>
        </li>)}
      </ol>}
      {coach && <div className="caption-box">{coach.text}<button className="dismiss" onClick={() => setCoachOff(true)}>Hide tips</button></div>}
      {view && Object.values(view.artwork).includes('unavailable') && <p className="alert" role="alert">Some Chog art didn't load. The machine still plays. Reload to retry.</p>}
      {!saved && <p className="alert" role="alert">Saving isn't available in this browser. This arrangement still works in this tab.</p>}
    </section>

    <aside className="panel inspector" aria-label="Machine settings">
      <h2 className="panel-title">Change one thing</h2>
      <fieldset disabled={!ready || view.running}>
        <legend className="fineprint">Edits reset the run and save in this browser.</legend>
        <label className="field">
          <span className="field-head">Ball start <span className="value">x {scene.ballX.toFixed(2)}</span></span>
          <input type="range" min="0.5" max="3.5" step="0.25" value={scene.ballX} onChange={(e) => edit({ ...scene, ballX: Number(e.target.value) })} />
        </label>
        <label className="field">
          <span className="field-head">Laser aim <span className="value">{scene.laserAim.toFixed(2)} rad</span></span>
          <input type="range" min="-0.6" max="0.6" step="0.05" value={scene.laserAim} onChange={(e) => edit({ ...scene, laserAim: Number(e.target.value) })} />
        </label>
        <label className="field" style={highlight('portalExitY')}>
          <span className="field-head">Portal exit height <span className="value">y {scene.portalExitY.toFixed(2)}</span></span>
          <input type="range" min="2" max="6" step="0.25" value={scene.portalExitY} onChange={(e) => edit({ ...scene, portalExitY: Number(e.target.value) })} />
        </label>
        {(['lift', 'portal', 'laser'] as const).map((power) => <label className="field" key={power} style={highlight(FIELD[power])}>
          {POWER_NAME[power]} power from
          <select value={scene[FIELD[power]]} onChange={(e) => edit({ ...scene, [FIELD[power]]: e.target.value })}>
            {PREVIEWS.map((source) => <option key={source.tokenId} value={source.tokenId}>{chogName(source)} ({source.kit.includes(power) ? POWER_TRAIT[power] : `no ${POWER_TRAIT[power]}`})</option>)}
          </select>
        </label>)}
        <label className="field">Banner message
          <input type="text" maxLength={80} value={messageInput} onChange={(e) => { setMessageInput(e.target.value); if (e.target.value.trim()) edit({ ...scene, message: e.target.value }); }} />
        </label>
        {!messageInput.trim() && <p className="alert" role="alert">Type a message to run, or Reset to bring back the last one.</p>}
        <button className="btn" onClick={() => { edit({ ...DEFAULT_CHAIN }); setMessageInput(DEFAULT_CHAIN.message); }}>Restore the starter</button>
      </fieldset>

      <details>
        <summary>Event log ({view?.snapshot.events.length ?? 0})</summary>
        <output aria-label="Simulation telemetry">{view ? `Tick ${view.snapshot.tick}/${MAX_TICKS} | ${view.snapshot.bodyCount} physical bodies | Balloon ${view.snapshot.balloonPopped ? 'popped' : 'intact'} | Banner ${view.snapshot.bannerOpen ? 'open' : 'closed'}` : 'Waiting for engine'}</output>
        <ol>{view?.snapshot.events.map((event, index) => <li key={index}>Tick {event.tick}: {event.actor} → {event.type} → {event.target}{event.sourceToken ? ` (token ${event.sourceToken})` : ''}</li>)}</ol>
      </details>
      <details>
        <summary>Where the Chog data comes from</summary>
        <p>Monad chain {provenance.chainId}. Token URIs read at block {provenance.tokenURIBlock}. No wallet session or publishing permission is implied.</p>
        {PREVIEWS.map((source) => <div key={source.tokenId}>
          <p><strong>{chogName(source)}</strong>, token {source.tokenId}. Art: {view?.artwork[source.tokenId] ?? 'loading'}.</p>
          <p className="breakable mono">{source.tokenURI}</p>
          <ul>{source.metadata.attributes.map((trait) => <li key={trait.trait_type}>{trait.trait_type}: {trait.value}</li>)}</ul>
          <a href={`https://opensea.io/item/monad/${provenance.collection}/${source.tokenId}`} target="_blank" rel="noreferrer">Inspect token {source.tokenId}</a>
        </div>)}
      </details>
      <details id="sign-in" open={walletOpen} onToggle={(e) => setWalletOpen(e.currentTarget.open)}>
        <summary>Sign in (no transaction)</summary>
        <div className="wallet-wrap"><WalletPanel /></div>
      </details>
      <details>
        <summary>More</summary>
        <p><a href="?harness=machine">Build a free machine from preview parts</a></p>
        <p><a href="?harness=falling">Open the T0 falling-body harness</a></p>
      </details>
    </aside>
  </AppFrame>;
}
