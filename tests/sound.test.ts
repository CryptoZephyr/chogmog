import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSoundPlayer, loadSoundOn, MAX_VOICES, saveSoundOn, SOUND_FILE, SOUND_KEY } from '../src/ui/sound';
import { newCues } from '../src/game/stageFx';
import type { ChainEvent } from '../src/game/chain';

const event = (tick: number, type: ChainEvent['type']): ChainEvent => ({ tick, type, actor: 'a', target: 'b' });

class FakeContext {
  static made: FakeContext[] = [];
  state = 'running';
  started = 0;
  sources: { onended: (() => void) | null }[] = [];
  destination = {};
  constructor() { FakeContext.made.push(this); }
  decodeAudioData = async () => ({}) as AudioBuffer;
  createBufferSource() {
    const source = { buffer: null, onended: null as (() => void) | null, connect: () => undefined, disconnect: () => undefined, start: () => { this.started++; } };
    this.sources.push(source);
    return source;
  }
  resume = async () => undefined;
  close = async () => undefined;
}

afterEach(() => { vi.unstubAllGlobals(); FakeContext.made = []; });

const flush = async () => { for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0)); };
const stubAudio = () => {
  const fetcher = vi.fn(async () => new Response(new Uint8Array([1, 2, 3])));
  vi.stubGlobal('fetch', fetcher);
  vi.stubGlobal('AudioContext', FakeContext);
  return fetcher;
};

describe('chain sounds', () => {
  it('cues each event kind once, at its first occurrence', () => {
    const events = [event(0, 'released'), event(40, 'sensor'), event(41, 'laser'), event(60, 'lifted'), event(70, 'lifted')];
    const heard = new Set<ChainEvent['type']>();
    expect(newCues(events.slice(0, 1), heard)).toEqual(['released']);
    expect(newCues(events.slice(0, 4), heard)).toEqual(['sensor', 'laser', 'lifted']);
    expect(newCues(events, heard)).toEqual([]);
  });

  it('has a file for every event kind', () => {
    expect(Object.keys(SOUND_FILE).sort()).toEqual(['banner', 'laser', 'lever', 'lifted', 'popped', 'portal-blocked', 'released', 'sensor', 'teleported']);
  });

  it('defaults to on and saves the choice', () => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
    expect(loadSoundOn(storage)).toBe(true);
    saveSoundOn(false, storage);
    expect(values.get(SOUND_KEY)).toBe('off');
    expect(loadSoundOn(storage)).toBe(false);
    expect(loadSoundOn({ getItem: () => { throw new Error('denied'); }, setItem: () => undefined })).toBe(true);
  });

  it('loads nothing until unlocked by a gesture, plays a cue that arrived while decoding, and caps simultaneous sounds', async () => {
    const fetcher = stubAudio();
    const player = createSoundPlayer(true);
    player.play('laser');
    expect(fetcher).not.toHaveBeenCalled();
    expect(FakeContext.made).toHaveLength(0);
    player.unlock();
    player.play('released');
    await flush();
    expect(FakeContext.made[0].started).toBe(1);
    FakeContext.made[0].sources[0].onended?.();
    FakeContext.made[0].started = 0;
    const context = FakeContext.made[0];
    for (let i = 0; i < MAX_VOICES + 2; i++) player.play('laser');
    expect(context.started).toBe(MAX_VOICES);
    context.sources[0].onended?.();
    player.play('popped');
    expect(context.started).toBe(MAX_VOICES + 1);
  });

  it('does nothing while turned off, and loads nothing until turned on', async () => {
    const fetcher = stubAudio();
    const player = createSoundPlayer(false);
    player.unlock();
    player.play('laser');
    expect(fetcher).not.toHaveBeenCalled();
    expect(FakeContext.made).toHaveLength(0);
    player.setEnabled(true);
    await flush();
    player.play('laser');
    expect(FakeContext.made[0].started).toBe(1);
    player.setEnabled(false);
    player.play('laser');
    expect(FakeContext.made[0].started).toBe(1);
  });
});
