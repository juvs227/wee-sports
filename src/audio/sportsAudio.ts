import './sportsAudio.css';

export type Sport = 'tennis' | 'bowling';

interface SoundDefinition {
  file: string;
  volume: number;
  cooldownMs: number;
  loop?: boolean;
  maxDuration?: number;
}

const START_SOUNDS: Record<string, SoundDefinition> = {
  countdown: {file: '/sounds/ui/countdown.wav', volume: 0.62, cooldownMs: 400},
  'countdown-2': {
    file: '/sounds/ui/countdown-2.wav',
    volume: 0.62,
    cooldownMs: 400,
  },
  'countdown-1': {
    file: '/sounds/ui/countdown-1.wav',
    volume: 0.65,
    cooldownMs: 400,
  },
  start: {file: '/sounds/ui/start.wav', volume: 0.65, cooldownMs: 1000},
  ready: {file: '/sounds/ui/ready.wav', volume: 0.6, cooldownMs: 300},
};

/** Local, short effects only. Gameplay owns when each event actually happened. */
export const SOUND_MANIFEST: Record<Sport, Record<string, SoundDefinition>> = {tennis: {
    ...START_SOUNDS,
    hit: {file: '/sounds/tennis/hit.wav', volume: 0.85, cooldownMs: 55},
    bounce: {file: '/sounds/tennis/bounce.wav', volume: 0.48, cooldownMs: 110},
    serve: {file: '/sounds/tennis/serve.wav', volume: 0.85, cooldownMs: 600},
    point: {file: '/sounds/tennis/point.wav', volume: 0.35, cooldownMs: 300},
    game: {file: '/sounds/tennis/game.wav', volume: 0.4, cooldownMs: 500},
    set: {file: '/sounds/tennis/set.wav', volume: 0.42, cooldownMs: 700},
    match: {file: '/sounds/tennis/match.wav', volume: 0.45, cooldownMs: 1000},
    fault: {file: '/sounds/tennis/fault.wav', volume: 0.4, cooldownMs: 500},
    let: {file: '/sounds/tennis/let.wav', volume: 0.4, cooldownMs: 500},
  }, bowling: {
    ...START_SOUNDS,
    release: {
      file: '/sounds/bowling/release.wav',
      volume: 0.6,
      cooldownMs: 500,
    },
    roll: {
      file: '/sounds/bowling/roll.wav',
      volume: 0.2,
      cooldownMs: 0,
      loop: true,
      maxDuration: 12,
    },
    pin: {file: '/sounds/bowling/pin.wav', volume: 0.75, cooldownMs: 90},
    gutter: {file: '/sounds/bowling/gutter.wav', volume: 0.4, cooldownMs: 700},
    strike: {file: '/sounds/bowling/strike.wav', volume: 0.45, cooldownMs: 800},
    spare: {file: '/sounds/bowling/spare.wav', volume: 0.4, cooldownMs: 800},
    result: {file: '/sounds/bowling/result.wav', volume: 0.35, cooldownMs: 500},
    match: {file: '/sounds/bowling/match.wav', volume: 0.45, cooldownMs: 1000},
  }};

interface Voice {
  event: string;
  source: AudioBufferSourceNode;
  gain: GainNode;
  finish: () => void;
}

/** Injectable browser boundaries let offline tests exercise lifecycle without audio. */
export interface SportsAudioOptions {
  createContext?: () => AudioContext;
  fetch?: typeof fetch;
  document?: Document;
  storage?: Pick<Storage, 'getItem' | 'setItem'>;
  now?: () => number;
}

export interface SportsAudioStatus {
  muted: boolean;
  ready: boolean;
  loading: boolean;
  unavailable: boolean;
  partial: boolean;
}

const MUTE_KEY = 'wee-sports:sound-muted';
const MAX_VOICES = 8;

export function createSportsAudio(
  sport: Sport,
  options: SportsAudioOptions = {},
) {
  const doc = options.document ?? globalThis.document;
  const now = options.now ?? (() => performance.now());
  const fetchAsset = options.fetch ?? globalThis.fetch?.bind(globalThis);
  let storage = options.storage;
  try {
    storage ??= globalThis.localStorage;
  } catch {
    // Private browsing can deny storage; sound still works for this visit.
  }
  let muted = false;
  try {
    muted = storage?.getItem(MUTE_KEY) === 'true';
  } catch {
    // A blocked preference store must not interrupt gameplay.
  }

  let context: AudioContext | undefined;
  let master: GainNode | undefined;
  let loading: Promise<void> | undefined;
  let preloading: Promise<void> | undefined;
  let unlocked = false;
  let loadingSounds = false;
  let unavailable = false;
  let disposed = false;
  let active = true;
  const buffers = new Map<string, AudioBuffer>();
  const encoded = new Map<string, ArrayBuffer>();
  const downloads = new Map<string, Promise<ArrayBuffer | undefined>>();
  const voices = new Set<Voice>();
  const lastPlayed = new Map<string, number>();
  const buttons = new Map<HTMLButtonElement, () => void>();
  const requests = new AbortController();
  const listeners = new Set<(status: SportsAudioStatus) => void>();

  const readyCount = () => Object.values(SOUND_MANIFEST[sport])
    .filter(definition => buffers.has(definition.file)).length;

  function getStatus(): SportsAudioStatus {
    return {
      muted,
      ready: unlocked && context?.state === 'running' && readyCount() > 0,
      loading: loadingSounds,
      unavailable,
      partial:
        !loadingSounds &&
        readyCount() > 0 &&
        readyCount() < Object.keys(SOUND_MANIFEST[sport]).length,
    };
  }

  function subscribe(
    listener: (status: SportsAudioStatus) => void,
  ): () => void {
    listeners.add(listener);
    listener(getStatus());
    return () => {
      listeners.delete(listener);
    };
  }

  function refreshButtons() {
    for (const listener of listeners) listener(getStatus());
    for (const button of buttons.keys()) {
      const on = getStatus().ready && !muted;
      button.textContent = muted
        ? 'Sound off'
        : unavailable
          ? 'Retry sound'
          : loadingSounds
            ? 'Loading sound…'
            : on
              ? 'Sound on'
              : 'Enable sound';
      button.setAttribute('aria-pressed', String(on));
      button.setAttribute(
        'aria-label',
        on ? 'Mute game sound' : 'Enable game sound',
      );
      button.title = on ? 'Mute game sound' : 'Enable sound on this screen';
    }
  }

  function download(
    _event: string,
    definition: SoundDefinition,
  ): Promise<ArrayBuffer | undefined> {
    const event = definition.file;
    if (encoded.has(event)) return Promise.resolve(encoded.get(event));
    const pending = downloads.get(event);
    if (pending) return pending;
    if (!fetchAsset || disposed) return Promise.resolve(undefined);
    const task = fetchAsset(definition.file, {signal: requests.signal})
      .then(async response => {
        if (!response.ok) throw new Error('Sound asset unavailable');
        const bytes = await response.arrayBuffer();
        if (!disposed) encoded.set(event, bytes);
        return disposed ? undefined : bytes;
      })
      .finally(() => {
        downloads.delete(event);
      });
    downloads.set(event, task);
    return task;
  }

  /** Download bytes in the lobby without creating an AudioContext or playing anything. */
  function preload(): Promise<void> {
    if (disposed || !fetchAsset) return Promise.resolve();
    if (preloading) return preloading;
    preloading = Promise.allSettled(
      Object.entries(SOUND_MANIFEST[sport]).map(async ([event, definition]) => {
        if (!buffers.has(definition.file)) await download(event, definition);
      }),
    )
      .then(() => {})
      .finally(() => {
        if (preloading === task) preloading = undefined;
      });
    const task = preloading;
    return task;
  }

  function stop(event?: string) {
    for (const voice of [...voices]) {
      if (event && voice.event !== event) continue;
      try {
        voice.source.stop();
      } catch {
        // The source may have finished between the event and this cleanup.
      }
      voice.finish();
    }
  }

  function setMuted(value: boolean) {
    if (disposed) return;
    muted = value;
    if (muted) stop();
    try {
      storage?.setItem(MUTE_KEY, String(value));
    } catch {
      // Keep the local preference when persistence is unavailable.
    }
    refreshButtons();
  }

  async function loadSounds() {
    const audioContext = context;
    if (!audioContext || !fetchAsset) return;
    await Promise.allSettled(
      Object.entries(SOUND_MANIFEST[sport]).map(async ([event, definition]) => {
        if (buffers.has(definition.file)) return;
        const bytes = await download(event, definition);
        if (!bytes) return;
        try {
          const buffer = await audioContext.decodeAudioData(bytes.slice(0));
          if (!disposed) {
            buffers.set(definition.file, buffer);
            refreshButtons();
          }
        } catch {
          encoded.delete(definition.file); // An explicit retry fetches a damaged response again.
        }
      }),
    );
  }

  function prepareSounds(): Promise<void> {
    if (loading) return loading;
    loadingSounds = true;
    const task = loadSounds().finally(() => {
      if (loading === task) {
        loading = undefined;
        loadingSounds = false;
        refreshButtons();
      }
    });
    loading = task;
    return task;
  }

  /** Keep the TV's activated audio context when the phone changes sports. */
  async function setSport(next: Sport): Promise<void> {
    if (disposed || next === sport || !Object.hasOwn(SOUND_MANIFEST, next)) return;
    stop();
    sport = next;
    lastPlayed.clear();
    loading = undefined;
    preloading = undefined;
    unavailable = false;
    if (context) await prepareSounds();
    else await preload();
    if (!disposed) refreshButtons();
  }

  /** Call directly from a click/tap. Never queues a game event for later playback. */
  async function unlock({respectMute = false} = {}): Promise<boolean> {
    if (disposed) return false;
    // Prime the context even while muted. A phone can later unmute the TV
    // without needing another browser activation gesture on the TV itself.
    if (!respectMute) setMuted(false);
    unavailable = false;
    try {
      if (!context) {
        const createContext =
          options.createContext ??
          (() => {
            const AudioContextClass =
              globalThis.AudioContext ??
              (
                globalThis as typeof globalThis & {
                  webkitAudioContext?: typeof AudioContext;
                }
              ).webkitAudioContext;
            if (!AudioContextClass) throw new Error('Web Audio unavailable');
            return new AudioContextClass({latencyHint: 'interactive'});
          });
        context = createContext();
        master = context.createGain();
        master.gain.value = 0.55;
        master.connect(context.destination);
        context.addEventListener?.('statechange', refreshButtons);
      }
      // Resume synchronously within the gesture, before waiting on downloads.
      const resumed = context.resume();
      const prepared = prepareSounds();
      refreshButtons();
      await resumed;
      if (disposed) return false;
      unlocked = context.state === 'running';
      refreshButtons();
      await prepared;
      if (disposed) return false;
      unavailable = !unlocked || readyCount() === 0;
      refreshButtons();
      return !unavailable;
    } catch {
      unlocked = false;
      unavailable = true;
      refreshButtons();
      return false;
    }
  }

  function play(event: string): boolean {
    if (event === 'stop') {
      stop();
      return false;
    }
    if (event === 'roll-end') {
      stop('roll');
      return false;
    }
    const definition = SOUND_MANIFEST[sport][event];
    const buffer = definition && buffers.get(definition.file);
    if (
      disposed ||
      !active ||
      doc?.hidden ||
      muted ||
      !unlocked ||
      context?.state !== 'running' ||
      !master ||
      !definition ||
      !buffer
    )
      return false;
    const time = now();
    if (time - (lastPlayed.get(event) ?? -Infinity) < definition.cooldownMs)
      return false;
    if (definition.loop && [...voices].some(voice => voice.event === event))
      return false;
    try {
      // Prefer a new event over an old effect; preserve the quiet rolling bed.
      if (voices.size >= MAX_VOICES) {
        const oldest =
          [...voices].find(voice => !voice.source.loop) ??
          voices.values().next().value;
        if (oldest) {
          oldest.source.stop();
          oldest.finish();
        }
      }
      const source = context.createBufferSource();
      const gain = context.createGain();
      source.buffer = buffer;
      source.loop = !!definition.loop;
      gain.gain.value = definition.volume;
      source.connect(gain);
      gain.connect(master);
      const voice: Voice = {
        event,
        source,
        gain,
        finish: () => {
          voices.delete(voice);
          source.onended = null;
          try {
            source.disconnect();
            gain.disconnect();
          } catch {
            // Browser teardown can disconnect the graph before our cleanup runs.
          }
        },
      };
      source.onended = voice.finish;
      voices.add(voice);
      try {
        source.start();
        // Audio-clock deadline also stops a loop if its final game event is lost.
        if (definition.maxDuration) source.stop(context.currentTime + definition.maxDuration);
      } catch {
        voice.finish();
        return false;
      }
      lastPlayed.set(event, time);
      return true;
    } catch {
      // Optional feedback must never break a physics frame or a network handler.
      return false;
    }
  }

  function setActive(value: boolean) {
    active = value;
    if (!active) {
      stop();
      lastPlayed.clear();
    }
  }

  function onVisibilityChange() {
    if (doc?.hidden) stop();
  }
  doc?.addEventListener('visibilitychange', onVisibilityChange);

  function mountButton(container: HTMLElement): HTMLButtonElement | undefined {
    if (!doc || disposed) return;
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = 'sports-sound-toggle';
    const onClick = () => {
      if (unlocked && !muted && context?.state === 'running') setMuted(true);
      else void unlock();
    };
    button.addEventListener('click', onClick);
    buttons.set(button, onClick);
    container.appendChild(button);
    refreshButtons();
    return button;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    stop();
    requests.abort();
    doc?.removeEventListener('visibilitychange', onVisibilityChange);
    for (const [button, onClick] of buttons) {
      button.removeEventListener('click', onClick);
      button.remove();
    }
    buttons.clear();
    buffers.clear();
    encoded.clear();
    downloads.clear();
    lastPlayed.clear();
    listeners.clear();
    context?.removeEventListener?.('statechange', refreshButtons);
    try {
      void context?.close().catch(() => {});
    } catch {
      // Closing an already-closed browser audio device is harmless.
    }
  }

  return {
    play: (event: string) => play(event),
    stop,
    preload,
    unlock,
    setMuted,
    setSport,
    setActive,
    getStatus,
    subscribe,
    mountButton,
    dispose,
  };
}
