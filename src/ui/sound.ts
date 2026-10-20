import type { EventType } from '../game/chain';

export const SOUND_KEY = 'chogmog.sound.v1';
export const MAX_VOICES = 4;
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
  const fetchFiles = () => files ??= Promise.all((Object.entries(SOUND_FILE) as [EventType, string][]).map(([type, name]) =>
    fetch(`/sounds/${name}.mp3`).then((response) => {
      if (!response.ok) throw new Error('Sound unavailable');
      return response.arrayBuffer();
    }).then((data): [EventType, ArrayBuffer] => [type, data], (): [EventType, ArrayBuffer] => [type, new ArrayBuffer(0)])));
  if (on) void fetchFiles();
  const unlock = () => {
    if (!on || context || typeof AudioContext === 'undefined') { if (context?.state === 'suspended') void context.resume().catch(() => undefined); return; }
    const created = new AudioContext();
    context = created;
    void fetchFiles().then((entries) => Promise.all(entries.filter(([, data]) => data.byteLength > 0).map(([type, data]) =>
      created.decodeAudioData(data).then((buffer) => { if (context === created) buffers.set(type, buffer); }, () => undefined))));
  };
  return {
    unlock,
    play(type) {
      const buffer = buffers.get(type);
      if (!on || !context || !buffer || voices >= MAX_VOICES || context.state !== 'running') return;
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      voices++;
      source.onended = () => { voices--; source.disconnect(); };
      source.start();
    },
    setEnabled(next) { on = next; if (next) unlock(); },
    dispose() { const closing = context; context = null; buffers.clear(); void closing?.close().catch(() => undefined); },
  };
}
