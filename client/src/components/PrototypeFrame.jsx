import { useEffect, useRef, useState } from 'react';
import { EVENTS, isSwing } from '@wee/shared/protocol.js';
import { request, socket, useConnection } from '../lib/socket.js';

const NO_PLAYERS = [];
/** Keep the existing game/controller alive while the outer page owns the lobby session. */
export function PrototypeFrame({ code, controller = false, player = 1, players = NO_PLAYERS, playing = true, paused = false, showPause = paused, pauseMessage }) {
  const frame = useRef(null);
  const ready = useRef(false);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [height, setHeight] = useState(1050);
  const connection = useConnection();
  const room = `lobby-${code}`;
  const src = `/${controller ? 'controller' : 'game'}.html?room=${encodeURIComponent(room)}&lobby=${code}&player=${player}`;
  function publishState() {
    frame.current?.contentWindow?.postMessage({ type: 'wee:lobby-state',
      paused: paused || connection !== 'online', connected: connection === 'online', players, playing }, window.location.origin);
  }
  useEffect(() => {
    ready.current = false;
    setLoading(true); setFailed(false);
    const timer = setTimeout(() => { if (!ready.current) setFailed(true); }, 15000);
    return () => clearTimeout(timer);
  }, [src, attempt]);
  useEffect(() => {
    const post = message => frame.current?.contentWindow?.postMessage(message, window.location.origin);
    const receive = async event => {
      if (event.source !== frame.current?.contentWindow || event.origin !== window.location.origin) return;
      if (event.data?.type === 'wee:bridge-ready') {
        ready.current = true; setLoading(false); setFailed(false);
        publishState();
      } else if (controller && event.data?.type === 'wee:player-swing' && isSwing(event.data.event)) {
        const result = paused || connection !== 'online' ? { ok: false, error: 'paused' }
          : await request(EVENTS.PLAYER_SWING, event.data.event);
        post({ type: 'wee:swing-ack', result });
      } else if (controller && event.data?.type === 'wee:controller-setup') {
        const result = await request(EVENTS.PLAYER_SETUP, { setup: event.data.setup });
        post({ type: 'wee:setup-ack', result });
      } else if (controller && event.data?.type === 'wee:controller-height' && Number.isFinite(event.data.height)) {
        setHeight(Math.max(400, Math.min(2200, event.data.height)));
      }
    };
    const swing = (event, ack) => {
      const ok = !controller && ready.current && !paused && connection === 'online' && isSwing(event);
      if (ok) post({ type: 'wee:game-swing', event });
      if (typeof ack === 'function') ack({ ok });
    };
    window.addEventListener('message', receive);
    if (!controller) socket.on(EVENTS.GAME_SWING, swing);
    publishState();
    return () => {
      window.removeEventListener('message', receive);
      socket.off(EVENTS.GAME_SWING, swing);
    };
  }, [paused, connection, src, controller, attempt, players, playing]);
  return (
    <div className={`prototype-frame ${controller ? 'prototype-frame--phone' : ''}`}>
      {loading ? <p role="status">{failed ? 'Taking too long to load.' : `Loading ${controller ? 'controller' : 'tennis'}…`}
        {failed ? <button type="button" className="btn btn--ghost" onClick={() => setAttempt(value => value + 1)}>Retry loading</button> : null}</p> : null}
      <iframe key={attempt} ref={frame} src={src} title={controller ? 'Tennis phone controller' : 'Tennis game'}
        style={controller ? { height } : undefined}
        allow="accelerometer; gyroscope" onLoad={publishState} />
      {showPause ? <div className="prototype-frame__pause" role="status">{pauseMessage || 'Match paused. Reconnect and finish controller setup to continue.'}</div> : null}
    </div>
  );
}
