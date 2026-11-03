import { useCallback, useEffect, useRef, useState } from 'react';
import { createSportsAudio } from '../../../src/audio/sportsAudio';
import { createTvAudioSession } from '../../../src/audio/tvAudioSession';
import { EVENTS } from '@wee/shared/protocol.js';
import { request } from './socket.js';
import { SoundToggle } from '../components/SoundToggle.jsx';

const EMPTY = { muted: false, ready: false, loading: false, unavailable: false, partial: false };

/** The TV page owns one context from the Play click through countdown and play. */
export function useTvAudio(lobby, reconnecting) {
  const output = useRef(null);
  const session = useRef(null);
  const snapshot = useRef(null);
  const changing = useRef(false);
  const [status, setStatus] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  snapshot.current = { gameId: lobby?.gameId ?? null, phase: lobby?.phase ?? null,
    paused: Boolean(reconnecting || lobby?.paused || !lobby) };

  useEffect(() => {
    if (!['tennis', 'bowling'].includes(lobby?.sport)) return;
    const sound = createSportsAudio(lobby.sport);
    const run = createTvAudioSession(sound);
    output.current = sound;
    session.current = run;
    const unsubscribe = sound.subscribe(setStatus);
    // Fetch bytes before Play, without creating a context or autoplaying.
    void sound.preload();
    run.update(snapshot.current);
    return () => {
      unsubscribe(); sound.dispose();
      if (output.current === sound) output.current = null;
      if (session.current === run) session.current = null;
    };
  }, [lobby?.code, lobby?.sport]);

  useEffect(() => { session.current?.update(snapshot.current); },
    [lobby?.gameId, lobby?.phase, lobby?.paused, reconnecting]);

  useEffect(() => {
    const sound = output.current;
    if (!sound || reconnecting) return;
    if (typeof lobby?.soundMuted === 'boolean') sound.setMuted(lobby.soundMuted);
    else if (lobby?.code) {
      // Seed a new lobby once from the TV preference; a later reconnect must
      // never overwrite a phone's explicit choice.
      void request(EVENTS.SOUND_SET, { muted: sound.getStatus().muted, initialize: true });
    }
  }, [lobby?.code, lobby?.sport, lobby?.soundMuted, reconnecting]);

  const activateForPlay = useCallback(() => {
    // Must execute directly in the Play handler, before a network/fullscreen await.
    return output.current?.unlock({ respectMute: true });
  }, []);
  const onCountdown = useCallback(seconds => {
    session.current?.update(snapshot.current);
    session.current?.countdown(seconds);
  }, []);
  const onAudio = useCallback(event => {
    session.current?.update(snapshot.current);
    session.current?.gameEvent(event);
  }, []);
  const toggle = useCallback(async () => {
    const sound = output.current;
    if (!sound || changing.current || reconnecting) return;
    const current = sound.getStatus();
    const muted = !current.muted;
    // Browser activation must happen in this click, not after the server ack.
    if (!muted) void sound.unlock({ respectMute: true });
    changing.current = true; setBusy(true); setError('');
    const result = await request(EVENTS.SOUND_SET, { muted });
    changing.current = false; setBusy(false);
    if (result?.ok) sound.setMuted(result.muted);
    else setError('Sound could not change. Try again when connected.');
  }, [reconnecting]);
  const hint = status.unavailable && status.muted ? 'Unmute and retry sound on this TV' : undefined;
  const controls = <div className="tv-sound-controls">
    <SoundToggle muted={status.muted} onClick={toggle} disabled={reconnecting} busy={busy} title={hint} />
    {error ? <span className="tv-sound-error" role="status">{error}</span> : null}
  </div>;
  return {activateForPlay, onCountdown, onAudio, controls};
}
