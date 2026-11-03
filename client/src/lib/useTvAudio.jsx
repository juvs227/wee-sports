import { useCallback, useEffect, useRef, useState } from 'react';
import { createSportsAudio } from '../../../src/audio/sportsAudio';
import { createTvAudioSession } from '../../../src/audio/tvAudioSession';

const EMPTY = { muted: false, ready: false, loading: false, unavailable: false, partial: false };

/** The TV page owns one context from the Play click through countdown and play. */
export function useTvAudio(lobby, reconnecting) {
  const output = useRef(null);
  const session = useRef(null);
  const snapshot = useRef(null);
  const [status, setStatus] = useState(EMPTY);
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
  const toggle = useCallback(() => {
    const sound = output.current;
    if (!sound) return;
    const current = sound.getStatus();
    if (current.ready && !current.muted) sound.setMuted(true);
    else void sound.unlock().then(ok => { if (ok) sound.preview(); });
  }, []);
  const testSound = useCallback(() => {
    const sound = output.current;
    // Test is an explicit request to enable and audition a short cue.
    if (sound) void sound.unlock().then(ok => { if (ok) sound.preview(); });
  }, []);
  const on = status.ready && !status.muted;
  const label = status.muted ? 'Sound off' : status.unavailable ? 'Retry sound'
    : status.loading ? 'Loading sound…' : on ? 'Sound on' : 'Enable sound';
  const controls = <div className="tv-sound-controls">
    <button type="button" className="sports-sound-toggle" aria-pressed={on}
      aria-label={on ? 'Mute game sound' : 'Enable game sound'} onClick={toggle}>{label}</button>
    <details className="tv-sound-help"><summary>Sound check</summary>
      <div className="tv-sound-help__panel">
        <button type="button" onClick={testSound}>Test sound</button>
        <p role="status">{status.unavailable ? 'Sound could not start. Click Test sound to retry.'
          : status.partial ? 'Some sounds could not load. Click Test sound to retry.'
            : 'Sound plays on this screen. Check its volume, output device and browser tab mute.'}</p>
      </div>
    </details>
  </div>;
  return {activateForPlay, onCountdown, onAudio, controls};
}
