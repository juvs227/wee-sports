import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {expect, test, vi} from 'vitest';
import {createSportsAudio, SOUND_MANIFEST} from '../src/audio/sportsAudio';
import {createTvAudioSession} from '../src/audio/tvAudioSession';

function harness() {
  let clock = 0;
  const sources: Array<{
    buffer?: AudioBuffer;
    loop: boolean;
    onended: (() => void) | null;
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
  }> = [];
  const context = {
    state: 'suspended',
    currentTime: 4,
    destination: {},
    resume: vi.fn(async () => {
      context.state = 'running';
    }),
    close: vi.fn(async () => {
      context.state = 'closed';
    }),
    createGain: vi.fn(() => ({
      gain: {value: 0},
      connect: vi.fn(),
      disconnect: vi.fn(),
    })),
    createBufferSource: vi.fn(() => {
      const source = {
        loop: false,
        onended: null as (() => void) | null,
        connect: vi.fn(),
        disconnect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
      };
      sources.push(source);
      return source;
    }),
    decodeAudioData: vi.fn(async () => ({duration: 0.3}) as AudioBuffer),
  };
  const fetchAsset = vi.fn(async () => ({
    ok: true,
    arrayBuffer: async () => new ArrayBuffer(4),
  }));
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
  class FakeDocument extends EventTarget {
    hidden = false;
  }
  const doc = new FakeDocument();
  const createContext = vi.fn(() => context as unknown as AudioContext);
  const options = {
    createContext,
    fetch: fetchAsset as unknown as typeof fetch,
    document: doc as unknown as Document,
    storage,
    now: () => clock,
  };
  return {
    context,
    sources,
    fetchAsset,
    values,
    doc,
    createContext,
    options,
    tick: (ms = 100) => {
      clock += ms;
    },
  };
}

test('sound is silent until explicitly unlocked and never replays earlier events', async () => {
  const h = harness();
  const sound = createSportsAudio('tennis', h.options);
  expect(sound.play('hit')).toBe(false);
  expect(h.createContext).not.toHaveBeenCalled();
  expect(h.fetchAsset).not.toHaveBeenCalled();
  await expect(sound.unlock()).resolves.toBe(true);
  expect(h.context.resume).toHaveBeenCalledTimes(1);
  expect(h.sources).toHaveLength(0);
  expect(sound.play('hit')).toBe(true);
  expect(h.sources[0].start).toHaveBeenCalledTimes(1);
  sound.dispose();
});

test('lobby preload stays silent and Play activation preserves an explicit saved mute', async () => {
  const h = harness();
  h.values.set('wee-sports:sound-muted', 'true');
  const sound = createSportsAudio('tennis', h.options);
  await sound.preload();
  const fetched = h.fetchAsset.mock.calls.length;
  expect(fetched).toBeGreaterThan(0);
  expect(h.createContext).not.toHaveBeenCalled();
  expect(h.sources).toHaveLength(0);
  await expect(sound.unlock({respectMute: true})).resolves.toBe(true);
  expect(h.createContext).toHaveBeenCalledTimes(1);
  expect(sound.getStatus().muted).toBe(true);
  expect(sound.play('hit')).toBe(false);
  // A later phone unmute uses the already activated context, without a TV click.
  sound.setMuted(false);
  expect(sound.play('hit')).toBe(true);
  expect(h.fetchAsset).toHaveBeenCalledTimes(fetched);
  expect(h.createContext).toHaveBeenCalledTimes(1);
  await sound.unlock({respectMute: true});
  expect(h.createContext).toHaveBeenCalledTimes(1);
  sound.dispose();
});

test('one TV audio context survives countdown into actual game effects', async () => {
  const h = harness();
  const sound = createSportsAudio('tennis', h.options);
  const session = createTvAudioSession(sound);
  await sound.preload();
  await sound.unlock({respectMute: true});
  session.update({gameId: 'match-one', phase: 'countdown', paused: false});
  for (const seconds of [5, 4, 3, 2, 1]) {
    h.tick(1000);
    session.countdown(seconds);
  }
  expect(h.sources).toHaveLength(5);
  session.countdown(1);
  session.countdown(2);
  expect(h.sources).toHaveLength(5);
  session.update({gameId: 'match-one', phase: 'tutorial', paused: false});
  expect(h.sources).toHaveLength(6); // One start cue.
  session.gameEvent('serve');
  expect(h.sources).toHaveLength(7);
  session.update({gameId: 'match-one', phase: 'tutorial', paused: true});
  session.gameEvent('hit');
  session.update({gameId: 'match-one', phase: 'tutorial', paused: false});
  expect(h.sources).toHaveLength(7); // Reconnect has no repeated start/hit.
  expect(h.createContext).toHaveBeenCalledTimes(1);
  sound.dispose();
});

test('restored matches do not replay start, skipped countdowns do not catch up, and pause stops loops', () => {
  const sound = {
    play: vi.fn((_event: string) => true),
    stop: vi.fn(),
    setActive: vi.fn(),
  };
  const session = createTvAudioSession(sound);
  session.update({gameId: 'restored', phase: 'tutorial', paused: false});
  expect(sound.play).not.toHaveBeenCalled();
  session.update({gameId: 'fresh', phase: 'countdown', paused: false});
  session.countdown(5);
  session.countdown(2);
  session.countdown(4);
  expect(sound.play.mock.calls.map(([event]) => event)).toEqual([
    'countdown',
    'countdown-2',
  ]);
  session.update({gameId: 'fresh', phase: 'tutorial', paused: true});
  session.update({gameId: 'fresh', phase: 'tutorial', paused: false});
  expect(sound.play).toHaveBeenCalledTimes(2);
  session.gameEvent('roll');
  session.gameEvent('roll-end');
  expect(sound.stop).toHaveBeenLastCalledWith('roll');
  session.gameEvent('stop');
  expect(sound.stop).toHaveBeenLastCalledWith(undefined);
});

test('late asset downloads cannot queue stale hits or bypass a pause', async () => {
  const h = harness();
  let finishDownload!: () => void;
  const wait = new Promise<void>(resolve => {
    finishDownload = resolve;
  });
  h.fetchAsset.mockImplementation(async () => {
    await wait;
    return {ok: true, arrayBuffer: async () => new ArrayBuffer(4)};
  });
  const sound = createSportsAudio('tennis', h.options);
  const unlock = sound.unlock();
  expect(sound.play('hit')).toBe(false);
  sound.setActive(false);
  finishDownload();
  await unlock;
  expect(h.sources).toHaveLength(0);
  expect(sound.play('hit')).toBe(false);
  sound.setActive(true);
  expect(h.sources).toHaveLength(0);
  expect(sound.play('hit')).toBe(true);
  sound.dispose();
});

test('one slow asset does not delay already decoded contact sounds', async () => {
  const h = harness();
  let finishSlow!: () => void;
  const slow = new Promise<void>(resolve => {
    finishSlow = resolve;
  });
  h.fetchAsset.mockImplementation(async (...args: unknown[]) => {
    if (String(args[0]).endsWith('/match.wav')) await slow;
    return {ok: true, arrayBuffer: async () => new ArrayBuffer(4)};
  });
  const sound = createSportsAudio('tennis', h.options);
  let ready!: () => void;
  const firstReady = new Promise<void>(resolve => {
    ready = resolve;
  });
  const unsubscribe = sound.subscribe(status => {
    if (status.ready) ready();
  });
  const unlock = sound.unlock();
  await firstReady;
  expect(sound.getStatus().loading).toBe(true);
  expect(sound.play('hit')).toBe(true);
  expect(sound.play('match')).toBe(false);
  finishSlow();
  await unlock;
  expect(sound.getStatus()).toMatchObject({
    ready: true,
    loading: false,
    partial: false,
  });
  expect(h.sources).toHaveLength(1); // The earlier unavailable match is never replayed.
  unsubscribe();
  sound.dispose();
});

test('rapid pin contacts are limited, loops cannot stack, and voices stay bounded', async () => {
  const h = harness();
  const sound = createSportsAudio('bowling', h.options);
  await sound.unlock();
  expect(sound.play('roll')).toBe(true);
  expect(sound.play('roll')).toBe(false);
  expect(sound.play('pin')).toBe(true);
  expect(sound.play('pin')).toBe(false);
  for (let index = 0; index < 20; index++) {
    h.tick();
    expect(sound.play('pin')).toBe(true);
  }
  expect(
    h.sources.filter(source => !source.stop.mock.calls.some(call => call.length === 0)),
  ).toHaveLength(8);
  expect(h.sources[0].stop).toHaveBeenCalledExactlyOnceWith(16);
  sound.play('roll-end');
  expect(h.sources[0].stop).toHaveBeenLastCalledWith();
  sound.dispose();
});

test('mute persists, and pause or hidden tabs stop all effects without replaying', async () => {
  const h = harness();
  const sound = createSportsAudio('bowling', h.options);
  await sound.unlock();
  sound.play('roll');
  sound.play('pin');
  sound.setMuted(true);
  expect(h.values.get('wee-sports:sound-muted')).toBe('true');
  expect(h.sources.every(source => source.stop.mock.calls.some(call => call.length === 0))).toBe(
    true,
  );
  expect(sound.play('release')).toBe(false);
  sound.setMuted(false);
  sound.play('roll');
  h.doc.hidden = true;
  h.doc.dispatchEvent(new Event('visibilitychange'));
  expect(h.sources[2].stop).toHaveBeenLastCalledWith();
  expect(sound.play('release')).toBe(false);
  h.doc.hidden = false;
  h.doc.dispatchEvent(new Event('visibilitychange'));
  expect(h.sources).toHaveLength(3);
  expect(sound.play('release')).toBe(true);
  sound.setActive(false);
  expect(h.sources[3].stop).toHaveBeenCalledTimes(1);
  sound.setActive(true);
  expect(h.sources).toHaveLength(4);
  sound.dispose();
});

test('failed, unsupported, or suspended audio does not throw into gameplay', async () => {
  const h = harness();
  h.fetchAsset.mockRejectedValue(new Error('offline'));
  const sound = createSportsAudio('tennis', h.options);
  await expect(sound.unlock()).resolves.toBe(false);
  expect(sound.play('hit')).toBe(false);
  h.fetchAsset.mockResolvedValue({
    ok: true,
    arrayBuffer: async () => new ArrayBuffer(4),
  });
  await expect(sound.unlock()).resolves.toBe(true);
  h.context.state = 'suspended';
  expect(sound.play('hit')).toBe(false);
  expect(sound.play('unknown')).toBe(false);
  sound.dispose();
  const unsupported = createSportsAudio('tennis', {
    ...h.options,
    createContext: () => {
      throw new Error('unsupported');
    },
  });
  await expect(unsupported.unlock()).resolves.toBe(false);
  expect(unsupported.play('hit')).toBe(false);
  unsupported.dispose();
});

test('disposal releases audio resources and prevents all subsequent playback', async () => {
  const h = harness();
  const sound = createSportsAudio('bowling', h.options);
  await sound.unlock();
  sound.play('roll');
  sound.dispose();
  sound.dispose();
  expect(h.sources[0].stop).toHaveBeenLastCalledWith();
  expect(h.sources[0].disconnect).toHaveBeenCalledTimes(1);
  expect(h.context.close).toHaveBeenCalledTimes(1);
  expect(sound.play('roll')).toBe(false);
  await expect(sound.unlock()).resolves.toBe(false);
});

test('enabling sound is quiet and never bypasses pause, mute or a hidden tab', async () => {
  const h = harness();
  const sound = createSportsAudio('tennis', h.options);
  await sound.unlock();
  sound.setActive(false);
  expect(sound.play('hit')).toBe(false);
  await sound.unlock();
  expect(h.sources).toHaveLength(0);
  expect(sound.play('ready')).toBe(false);
  h.tick(500);
  h.doc.hidden = true;
  sound.setActive(true);
  expect(sound.play('hit')).toBe(false);
  h.doc.hidden = false;
  sound.setMuted(true);
  expect(sound.play('hit')).toBe(false);
  sound.dispose();
});

test('every manifest asset ships as nonempty, bounded PCM WAV with a clean attack', () => {
  const files = Object.values(SOUND_MANIFEST).flatMap(events =>
    Object.values(events),
  );
  let totalBytes = 0;
  for (const {file, loop} of files) {
    const wav = readFileSync(resolve('public', file.slice(1)));
    totalBytes += wav.length;
    expect(wav.toString('ascii', 0, 4), file).toBe('RIFF');
    expect(wav.toString('ascii', 8, 12), file).toBe('WAVE');
    expect(wav.toString('ascii', 12, 16), file).toBe('fmt ');
    expect(wav.readUInt16LE(20), file).toBe(1); // PCM.
    expect(wav.readUInt16LE(22), file).toBe(1); // Mono.
    expect(wav.readUInt32LE(24), file).toBe(24000);
    expect(wav.readUInt16LE(34), file).toBe(16);
    expect(wav.toString('ascii', 36, 40), file).toBe('data');
    expect(wav.readUInt32LE(40), file).toBe(wav.length - 44);
    expect(wav.length, file).toBeGreaterThan(2000);
    let peak = 0;
    let firstAttack = Infinity;
    for (let offset = 44; offset < wav.length; offset += 2) {
      const amplitude = Math.abs(wav.readInt16LE(offset));
      peak = Math.max(peak, amplitude);
      if (amplitude > 1000 && firstAttack === Infinity)
        firstAttack = (offset - 44) / 48000;
    }
    expect(peak, file).toBeGreaterThan(5000);
    expect(peak, file).toBeLessThan(32767);
    if (!loop) expect(firstAttack, file).toBeLessThan(0.05);
  }
  expect(totalBytes).toBeLessThan(1_000_000);
});
