import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {expect, test, vi} from 'vitest';
import {createSportsAudio, SOUND_MANIFEST} from '../src/audio/sportsAudio';

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
    h.sources.filter(source => !source.stop.mock.calls.length),
  ).toHaveLength(8);
  expect(h.sources[0].stop).not.toHaveBeenCalled();
  sound.play('roll-end');
  expect(h.sources[0].stop).toHaveBeenCalledTimes(1);
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
  expect(h.sources.every(source => source.stop.mock.calls.length === 1)).toBe(
    true,
  );
  expect(sound.play('release')).toBe(false);
  sound.setMuted(false);
  sound.play('roll');
  h.doc.hidden = true;
  h.doc.dispatchEvent(new Event('visibilitychange'));
  expect(h.sources[2].stop).toHaveBeenCalledTimes(1);
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
  expect(h.sources[0].stop).toHaveBeenCalledTimes(1);
  expect(h.sources[0].disconnect).toHaveBeenCalledTimes(1);
  expect(h.context.close).toHaveBeenCalledTimes(1);
  expect(sound.play('roll')).toBe(false);
  await expect(sound.unlock()).resolves.toBe(false);
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
