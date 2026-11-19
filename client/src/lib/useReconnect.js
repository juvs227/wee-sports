import { useCallback, useEffect, useRef, useState } from 'react';
import { EVENTS, PROTOCOL_VERSION } from '@wee/shared/protocol.js';
import { clearToken, loadToken, saveToken } from './reconnect.js';
import { request, socket } from './socket.js';

const pendingDepartures = new Map();

/** Shared by the existing host/phone pages. Refreshing is not an explicit Leave. */
export function useReconnect(role, code) {
  const [snapshot, setSnapshot] = useState(null);
  const [reconnecting, setReconnecting] = useState(() => Boolean(loadToken(role, code)));
  const [ended, setEnded] = useState(null);
  const [storageWarning, setStorageWarning] = useState(false);
  const token = useRef(null);
  const needsResume = useRef(false);
  const operation = useRef(0);
  const leaving = useRef(false);
  const accept = useCallback((result, expectedOperation) => {
    if (expectedOperation !== undefined && expectedOperation !== operation.current) return false;
    token.current = result.token;
    needsResume.current = false;
    setStorageWarning(!saveToken(role, code, result.token));
    setSnapshot(result); setReconnecting(false); setEnded(null);
    return true;
  }, [role, code]);
  useEffect(() => {
    const departureKey = `${role}:${code}`;
    clearTimeout(pendingDepartures.get(departureKey));
    pendingDepartures.delete(departureKey);
    let live = true, pending = false, stopped = false;
    token.current = loadToken(role, code);
    needsResume.current = Boolean(token.current);
    leaving.current = false;
    operation.current++;
    setSnapshot(null); setEnded(null); setReconnecting(needsResume.current);
    async function resume() {
      if (!live || stopped || pending || leaving.current || !token.current || !needsResume.current || !socket.connected) return;
      pending = true;
      const attempt = operation.current;
      const result = await request(EVENTS.SESSION_RESUME, { v: PROTOCOL_VERSION, code, role, token: token.current });
      pending = false;
      if (!live || stopped || leaving.current || attempt !== operation.current) return;
      if (result.ok) accept(result);
      else if (['no-room', 'bad-session'].includes(result.error)) {
        clearToken(role, code); token.current = null; needsResume.current = false;
        setReconnecting(false); setSnapshot(null); setEnded(result.error === 'no-room' ? 'ended' : 'expired');
      } else if (result.error === 'recovery-owner-required') {
        // The seat proof remains valid; signing back into its owner can reclaim
        // it. Stop background retries until the player returns from sign-in.
        token.current = null; needsResume.current = false;
        setReconnecting(false); setSnapshot(null); setEnded(result.error);
      }
    }
    const update = next => {
      if (next?.code !== code || stopped || !token.current) return;
      setSnapshot(previous => previous ? { ...previous, ...next } : previous);
    };
    const disconnected = () => {
      if (!token.current || stopped) return;
      needsResume.current = true; setReconnecting(true);
    };
    const closed = event => {
      if (event?.code && event.code !== code) return;
      operation.current++;
      clearToken(role, code); token.current = null; needsResume.current = false;
      setSnapshot(null); setReconnecting(false); setEnded('ended');
    };
    const replaced = () => {
      operation.current++;
      stopped = true; token.current = null; needsResume.current = false;
      setSnapshot(null); setReconnecting(false); setEnded('replaced');
    };
    const away = () => {
      if (token.current && socket.connected && !stopped) socket.emit(EVENTS.SESSION_AWAY, { code });
      disconnected();
    };
    // pageshow also fires for an ordinary initial load. Only reclaim a seat
    // after a real departure/disconnect; repeated resumes rotate generations.
    const pageShow = () => {
      if (!token.current || stopped) return;
      if (!socket.connected) socket.connect();
      resume();
    };
    const online = () => {if (!socket.connected) socket.connect(); resume();};
    const visible = () => {if (!document.hidden) online();};
    window.addEventListener('pagehide', away);
    window.addEventListener('pageshow', pageShow);
    window.addEventListener('online', online);
    document.addEventListener('visibilitychange', visible);
    socket.on('connect', resume); socket.on('disconnect', disconnected);
    socket.on(EVENTS.LOBBY_UPDATE, update); socket.on(EVENTS.ROOM_CLOSED, closed); socket.on(EVENTS.SESSION_REPLACED, replaced);
    const timer = setInterval(resume, 2000);
    resume();
    return () => {
      operation.current++;
      live = false; clearInterval(timer);
      window.removeEventListener('pagehide', away);
      window.removeEventListener('pageshow', pageShow);
      window.removeEventListener('online', online);
      document.removeEventListener('visibilitychange', visible);
      // StrictMode remounts cancel this; actual navigation reserves the seat.
      if (token.current && !stopped) pendingDepartures.set(departureKey, setTimeout(() => {
        pendingDepartures.delete(departureKey);
        if (socket.connected) socket.emit(EVENTS.SESSION_AWAY, { code });
      }, 0));
      socket.off('connect', resume); socket.off('disconnect', disconnected);
      socket.off(EVENTS.LOBBY_UPDATE, update); socket.off(EVENTS.ROOM_CLOSED, closed); socket.off(EVENTS.SESSION_REPLACED, replaced);
    };
  }, [role, code, accept]);
  async function leave() {
    if (leaving.current) return false;
    leaving.current = true; operation.current++;
    const proof = token.current;
    if (role === 'host') {
      const result = await request(EVENTS.HOST_CLOSE, {code, token:proof});
      if (!result?.ok) {leaving.current = false; return false;}
    } else if (socket.connected) {
      // A phone can always leave locally. Never let a missing acknowledgement
      // trap it, or queue a stale Leave to run after a different room is joined.
      void request(EVENTS.PLAYER_LEAVE, {code, token:proof}).catch(() => {});
    }
    clearTimeout(pendingDepartures.get(`${role}:${code}`));
    pendingDepartures.delete(`${role}:${code}`);
    clearToken(role, code); token.current = null; needsResume.current = false;
    setSnapshot(null); setReconnecting(false); setEnded(null);
    leaving.current = false;
    return true;
  }
  return { snapshot, reconnecting, ended, storageWarning, accept, leave, beginJoin: () => ++operation.current };
}
