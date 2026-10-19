import { useEffect, useRef, useState } from 'react';
import { MAX_TICKS } from '../domain/fallingScene';
import type { Machine, DraftCatalog } from '../domain/machineDraft';
import type { MachineSnapshot } from '../game/machinePreview';
import type { MachineStage } from '../game/machineStage';

export function MachineSandbox({ machine, catalog, onRunning, editing }:
  { machine: Machine; catalog: DraftCatalog; onRunning(running: boolean): void; editing: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const stage = useRef<MachineStage | null>(null);
  const [view, setView] = useState<{ snapshot: MachineSnapshot; running: boolean } | null>(null);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let instance: MachineStage | undefined;
    void import('../game/machineStage').then(({ createMachineStage }) =>
      createMachineStage(canvas.current!, machine.scene, catalog, controller.signal, (snapshot, running) => {
        if (!controller.signal.aborted) { setView({ snapshot, running }); onRunning(running); }
      })).then((created) => {
      if (controller.signal.aborted) created.dispose();
      else { instance = created; stage.current = created; }
    }).catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => { controller.abort(); instance?.dispose(); stage.current = null; onRunning(false); };
  }, [machine, catalog, retry, onRunning]);
  return <section aria-label="Machine physics sandbox">
    <h2>Test this machine</h2>
    <p>Run this exact arrangement, then change placement, wires or exposed controls and try again. Physical intersections and typed connections decide each outcome.</p>
    <div className="controls">
      <button disabled={editing || !view || failed || view.running || view.snapshot.tick >= MAX_TICKS} onClick={() => stage.current?.run()}>Run machine</button>
      <button disabled={!view?.running || failed} onClick={() => stage.current?.pause()}>Pause machine</button>
      <button disabled={!view || failed} onClick={() => stage.current?.reset()}>Reset machine</button>
      {failed && <button onClick={() => { setFailed(false); setView(null); setRetry(retry + 1); }}>Retry machine engine</button>}
    </div>
    <canvas ref={canvas} className="machine-canvas" role="img" width={720} height={480}
      aria-label="Neutral machine stage. Physical actions and outcomes appear in the causal event list." />
    <p role="status">{failed ? 'Machine engine unavailable. Your draft remains saved. Retry to run it.' :
      !view ? 'Loading physics engine…' : `${view.running ? 'Running' : 'Paused'} at tick ${view.snapshot.tick}/${MAX_TICKS}. ${view.snapshot.bodyCount} physical bodies. Message ${view.snapshot.bannerOpen ? 'open' : 'closed'}.`}</p>
    {view?.snapshot.tick === MAX_TICKS && <p>Run complete. Reset to play the same draft again.</p>}
    {view?.snapshot.bannerOpen && <p role="status">Machine message: {machine.scene.message}</p>}
    {view && <details open><summary>Cause and effect ({view.snapshot.events.length} events)</summary>
      <ol aria-label="Machine causal events">{view.snapshot.events.map((event, index) =>
        <li key={index}>Tick {event.tick}: {event.text}</li>)}</ol>
    </details>}
  </section>;
}
