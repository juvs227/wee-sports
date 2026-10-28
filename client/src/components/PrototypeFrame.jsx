import { useEffect, useRef, useState } from 'react';
import { EVENTS, isRoll, isSwing } from '@wee/shared/protocol.js';
import { request, socket, useConnection } from '../lib/socket.js';

const NO_PLAYERS = [];
/** Keep the game/controller alive while the outer page owns the lobby session. */
export function PrototypeFrame({ code, controller = false, player = 1, players = NO_PLAYERS, sport = 'tennis', gameId, gameState, playing = true, paused = false, showPause = paused, pauseMessage }) {
  const frame = useRef(null);
  const ready = useRef(false);
  const pending = useRef(new Map());
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [height, setHeight] = useState(1050);
  const connection = useConnection();
  const room = `lobby-${code}`;
  const src = `/${controller ? 'controller' : sport === 'bowling' ? 'bowling' : 'game'}.html?room=${encodeURIComponent(room)}&lobby=${code}&player=${player}&sport=${sport}`;
  function publishState() {
    const post = message => frame.current?.contentWindow?.postMessage(message, window.location.origin);
    post({ type: 'wee:lobby-state', paused: paused || connection !== 'online', connected: connection === 'online', players, playing, sport, gameId });
    if (controller && sport === 'bowling') post({ type: 'wee:bowling-state', ...gameState,
      canRoll: playing && !paused && connection === 'online' && gameState?.phase === 'ready' && gameState.currentPlayer === player });
  }
  useEffect(() => {
    ready.current = false;
    setLoading(true); setFailed(false);
    const timer = setTimeout(() => { if (!ready.current) setFailed(true); }, 15000);
    return () => {
      clearTimeout(timer);
      for (const { ack, timer } of pending.current.values()) { clearTimeout(timer); ack({ ok: false, error: 'game-loading' }); }
      pending.current.clear();
    };
  }, [src, attempt]);
  useEffect(() => {
    const post = message => frame.current?.contentWindow?.postMessage(message, window.location.origin);
    const receive = async event => {
      if (event.source !== frame.current?.contentWindow || event.origin !== window.location.origin) return;
      const data = event.data;
      if (data?.type === 'wee:bridge-ready') {
        ready.current = true; setLoading(false); setFailed(false); publishState();
      } else if (controller && data?.type === 'wee:player-swing' && isSwing(data.event)) {
        const result = paused || connection !== 'online' ? { ok: false, error: 'paused' }
          : await request(EVENTS.PLAYER_SWING, data.event);
        post({ type: 'wee:swing-ack', result });
      } else if (controller && data?.type === 'wee:player-roll' && isRoll(data.event)) {
        const result = paused || connection !== 'online' ? { ok: false, error: 'paused' }
          : await request(EVENTS.PLAYER_ROLL, data.event);
        post({ type: 'wee:roll-ack', result });
      } else if (!controller && data?.type === 'wee:bowling-state' && data.gameId === gameId) {
        await request(EVENTS.HOST_GAME_STATE, { gameId, phase: data.phase, frame: data.frame, currentPlayer: data.currentPlayer });
      } else if (!controller && data?.type === 'wee:roll-result') {
        const delivery = pending.current.get(data.id);
        if (delivery) { clearTimeout(delivery.timer); pending.current.delete(data.id); delivery.ack(data.result); }
      } else if (controller && data?.type === 'wee:controller-setup') {
        const result = await request(EVENTS.PLAYER_SETUP, { setup: data.setup });
        post({ type: 'wee:setup-ack', result });
      } else if (controller && data?.type === 'wee:controller-height' && Number.isFinite(data.height)) {
        setHeight(Math.max(400, Math.min(2200, data.height)));
      }
    };
    const swing = (event, ack) => {
      const ok = !controller && ready.current && !paused && connection === 'online' && isSwing(event);
      if (ok) post({ type: 'wee:game-swing', event });
      if (typeof ack === 'function') ack({ ok });
    };
    const roll = (event, ack = () => {}) => {
      if (controller || !ready.current || paused || connection !== 'online' || event.gameId !== gameId || !isRoll(event)) {
        ack({ ok: false, error: 'game-loading' }); return;
      }
      const timer = setTimeout(() => { pending.current.delete(event.id); ack({ ok: false, error: 'game-loading' }); }, 1800);
      pending.current.set(event.id, { ack, timer });
      post({ type: 'wee:game-roll', event });
    };
    window.addEventListener('message', receive);
    if (!controller) { socket.on(EVENTS.GAME_SWING, swing); socket.on(EVENTS.GAME_ROLL, roll); }
    publishState();
    return () => {
      window.removeEventListener('message', receive);
      socket.off(EVENTS.GAME_SWING, swing); socket.off(EVENTS.GAME_ROLL, roll);
    };
  }, [paused, connection, src, controller, attempt, players, playing, sport, gameId, gameState, player]);
  return (
    <div className={`prototype-frame ${controller ? 'prototype-frame--phone' : ''}`}>
      {loading ? <p role="status">{failed ? 'Taking too long to load.' : `Loading ${controller ? 'controller' : sport}…`}
        {failed ? <button type="button" className="btn btn--ghost" onClick={() => setAttempt(value => value + 1)}>Retry loading</button> : null}</p> : null}
      <iframe key={attempt} ref={frame} src={src} title={`${sport === 'bowling' ? 'Bowling' : 'Tennis'} ${controller ? 'phone controller' : 'game'}`}
        style={controller ? { height } : undefined}
        allow="accelerometer; gyroscope" onLoad={publishState} />
      {showPause ? <div className="prototype-frame__pause" role="status">{pauseMessage || 'Match paused. Reconnect and finish controller setup to continue.'}</div> : null}
    </div>
  );
}
