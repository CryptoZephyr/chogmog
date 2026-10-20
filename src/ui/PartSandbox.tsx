import { useEffect, useRef, useState } from 'react';
import type { PartVersion } from '../domain/documents';
import type { PartSnapshot } from '../game/partPreview';
import type { PartStage } from '../game/partStage';

export function PartSandbox({ version, onRunning }: { version: PartVersion; onRunning(running: boolean): void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const stage = useRef<PartStage | null>(null);
  const [view, setView] = useState<{ snapshot: PartSnapshot; running: boolean } | null>(null);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let instance: PartStage | undefined;
    void import('../game/partStage').then(({ createPartStage }) => createPartStage(canvas.current!, version, controller.signal, (snapshot, running) => {
      if (!controller.signal.aborted) { setView({ snapshot, running }); onRunning(running); }
    })).then((created) => {
      if (controller.signal.aborted) created.dispose();
      else { instance = created; stage.current = created; }
    }).catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => { controller.abort(); instance?.dispose(); stage.current = null; onRunning(false); };
  }, [version, retry, onRunning]);
  return <section aria-label="Part physics sandbox">
    <h4>Test this exact part</h4>
    <p>One input at Run starts push, release or laser. Lift and portals react to the physical ball entering their region. This sandbox tests one part, not a complete reusable machine.</p>
    <div className="controls">
      <button className="run" disabled={!view || error || view.running || view.snapshot.tick >= 720} onClick={() => stage.current?.run()}>Run part</button>
      <button disabled={!view?.running || error} onClick={() => stage.current?.pause()}>Pause part</button>
      <button disabled={!view || error} onClick={() => stage.current?.reset()}>Reset part</button>
      {error && <button onClick={() => { setError(false); setView(null); setRetry(retry + 1); }}>Retry part engine</button>}
    </div>
    <canvas className="part-canvas" ref={canvas} width={540} height={540} role="img" aria-label={`Exact part sandbox for token ${version.content.source.nft.tokenId}. Physical events are listed below.`} />
    <p role="status">{error ? 'Part engine unavailable. The draft is kept. Retry to test it.' : !view ? 'Loading part engine…' : `${view.running ? 'Running' : 'Paused'} at tick ${view.snapshot.tick}/720. ${view.snapshot.bodies.length} physical objects.`}</p>
    {view && <ol aria-label="Part causal events">{view.snapshot.events.map((event, i) => <li key={i}>Tick {event.tick}: {event.text}</li>)}</ol>}
  </section>;
}
