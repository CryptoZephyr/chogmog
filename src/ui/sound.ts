import type { EventType } from '../game/chain';

export const SOUND_KEY = 'chogmog.sound.v1';
export const MAX_VOICES = 4;
/** A cue that arrives while its clip is still decoding plays late, but only within this window. */
export const LATE_CUE_MS = 400;
export const SOUND_FILE: Record<EventType, string> = {
  released: 'drop', sensor: 'click', laser: 'zap', popped: 'pop', lifted: 'whoosh',
  teleported: 'bloop', 'portal-blocked': 'bonk', lever: 'clunk', banner: 'tada',
};

type Store = Pick<Storage, 'getItem' | 'setItem'> | undefined;
const store = (): Store => (typeof localStorage === 'undefined' ? undefined : localStorage);

export function loadSoundOn(storage: Store = store()): boolean {
  try { return storage?.getItem(SOUND_KEY) !== 'off'; } catch { return true; }
}

export function saveSoundOn(on: boolean, storage: Store = store()): void {
  try { storage?.setItem(SOUND_KEY, on ? 'on' : 'off'); } catch { /* the toggle still works in this tab */ }
}

export interface SoundPlayer { unlock(): void; play(type: EventType): void; setEnabled(on: boolean): void; dispose(): void }

/** Plays one short sound per chain event. Audio starts only from a user gesture, through unlock(). */
export function createSoundPlayer(enabled: boolean): SoundPlayer {
  let on = enabled;
  let context: AudioContext | null = null;
  let voices = 0;
  let files: Promise<[EventType, ArrayBuffer][]> | null = null;
  const buffers = new Map<EventType, AudioBuffer>();
  const waiting = new Map<EventType, number>();
  const fetchFiles = () => files ??= Promise.all((Object.entries(SOUND_FILE) as [EventType, string][]).map(([type, name]) =>
    fetch(`/sounds/${name}.mp3`).then((response) => {
      if (!response.ok) throw new Error('Sound unavailable');
      return response.arrayBuffer();
    }).then((data): [EventType, ArrayBuffer] => [type, data], (): [EventType, ArrayBuffer] => [type, new ArrayBuffer(0)])));
  const unlock = () => {
    if (!on || context || typeof AudioContext === 'undefined') { if (context?.state === 'suspended') void context.resume().catch(() => undefined); return; }
    const created = new AudioContext();
    context = created;
    void fetchFiles().then((entries) => Promise.all(entries.filter(([, data]) => data.byteLength > 0).map(([type, data]) =>
      created.decodeAudioData(data).then((buffer) => {
        if (context !== created) return;
        buffers.set(type, buffer);
        const asked = waiting.get(type);
        waiting.delete(type);
        if (asked !== undefined && performance.now() - asked <= LATE_CUE_MS) start(buffer);
      }, () => undefined))));
  };
  return {
    unlock,
    play(type) {
      if (!on || !context) return;
      const buffer = buffers.get(type);
      if (buffer) start(buffer);
      else waiting.set(type, performance.now());
    },
    setEnabled(next) { on = next; if (next) unlock(); else waiting.clear(); },
    dispose() { const closing = context; context = null; buffers.clear(); waiting.clear(); void closing?.close().catch(() => undefined); },
  };
  function start(buffer: AudioBuffer) {
    if (!on || !context || voices >= MAX_VOICES || context.state !== 'running') return;
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    voices++;
    source.onended = () => { voices--; source.disconnect(); };
    source.start();
  }
}
