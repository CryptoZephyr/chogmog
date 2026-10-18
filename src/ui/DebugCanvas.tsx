import { useEffect, useRef, useState } from 'react';
import { DEFAULT_SCENE, FIXED_STEP, MAX_TICKS, type FallingScene } from '../domain/fallingScene';
import { loadScene, saveScene } from '../domain/sceneStorage';
import type { Stage, StageView } from '../game/stage';

export function DebugCanvas() {
  const host = useRef<HTMLDivElement>(null);
  const stage = useRef<Stage | null>(null);
  const [scene, setScene] = useState(loadScene);
  const initialScene = useRef(scene);
  const [view, setView] = useState<StageView | null>(null);
  const [error, setError] = useState(false);
  const [saved, setSaved] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    const container = host.current!;
    let instance: Stage | undefined;
    void import('../game/stage').then(({ createStage }) =>
      createStage(container, initialScene.current, controller.signal, (next) => {
        if (!controller.signal.aborted) setView(next);
      }),
    ).then((created) => {
      if (controller.signal.aborted) created.dispose();
      else {
        instance = created;
        stage.current = created;
      }
    }).catch(() => {
      if (!controller.signal.aborted) setError(true);
    });
    return () => {
      controller.abort();
      instance?.dispose();
      stage.current = null;
    };
  }, []);

  const changeScene = (next: FallingScene) => {
    stage.current?.reset(next);
    setScene(next);
    setSaved(saveScene(next));
  };
  const ready = view !== null && !error;
  const complete = view?.snapshot.tick === MAX_TICKS;

  return (
    <main>
      <h1>Chogmog</h1>
      <p>Make mischief move.</p>
      <h2>T0 development harness</h2>
      <p>Neutral debug canvas, not the final product design. No NFTs, traits, wallets or holder publication are connected yet.</p>
      <p role="status">
        {error ? 'Could not initialize WebAssembly or WebGL. Try a supported browser and reload the page.'
          : !ready ? 'Loading physics and renderer…'
          : view.running ? 'Running' : complete ? 'Run complete. Reset to run again.' : 'Ready, paused'}
      </p>
      <div className="controls">
        <button disabled={!ready || view.running || complete} onClick={() => stage.current?.run()}>Run</button>
        <button disabled={!ready || !view.running} onClick={() => stage.current?.pause()}>Pause</button>
        <button disabled={!ready} onClick={() => stage.current?.reset(scene)}>Reset</button>
      </div>
      <fieldset disabled={!ready || view.running}>
        <legend>Starting arrangement, editable while paused</legend>
        <label>Ball X: {scene.ballX.toFixed(2)} m
          <input type="range" min="0.25" max="11.75" step="0.25" value={scene.ballX}
            onChange={(event) => changeScene({ ...scene, ballX: Number(event.target.value) })} />
        </label>
        <label>Ball height: {scene.ballY.toFixed(2)} m
          <input type="range" min="1" max="7.5" step="0.25" value={scene.ballY}
            onChange={(event) => changeScene({ ...scene, ballY: Number(event.target.value) })} />
        </label>
        <label>Bounce: {scene.restitution.toFixed(2)}
          <input type="range" min="0" max="0.95" step="0.05" value={scene.restitution}
            onChange={(event) => changeScene({ ...scene, restitution: Number(event.target.value) })} />
        </label>
        <button onClick={() => changeScene({ ...DEFAULT_SCENE })}>Default arrangement</button>
      </fieldset>
      {!saved && <p role="alert">Local saving is unavailable. Your arrangement still works in this tab.</p>}
      <p>Arrangements are saved only in this browser. Editing resets the simulation. Runs stop at 720 ticks and pause when the tab is hidden.</p>
      <div className="canvas-host" ref={host} />
      <output aria-label="Simulation telemetry">
        {view ? `Tick ${view.snapshot.tick}/${MAX_TICKS} | ${(view.snapshot.tick * FIXED_STEP).toFixed(2)} s | Ball (${view.snapshot.ball.x.toFixed(2)}, ${view.snapshot.ball.y.toFixed(2)}) m | ${view.snapshot.bodyCount} bodies`
          : 'Waiting for the engine'}
      </output>
      <p>This is the original T0 regression harness. It does not use the source traits connected in the first-chain preview.</p>
      <p><a href="/">Open the trait-powered chain preview</a></p>
    </main>
  );
}
