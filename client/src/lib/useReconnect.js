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
  const accept = useCallback(result => {
    token.current = result.token;
    needsResume.current = false;
    setStorageWarning(!saveToken(role, code, result.token));
    setSnapshot(result); setReconnecting(false); setEnded(null);
  }, [role, code]);
  useEffect(() => {
    const departureKey = `${role}:${code}`;
    clearTimeout(pendingDepartures.get(departureKey));
    pendingDepartures.delete(departureKey);
    let live = true, pending = false, stopped = false;
    token.current = loadToken(role, code);
    needsResume.current = Boolean(token.current);
    setSnapshot(null); setEnded(null); setReconnecting(needsResume.current);
    async function resume() {
      if (!live || stopped || pending || !token.current || !needsResume.current || !socket.connected) return;
      pending = true;
      const result = await request(EVENTS.SESSION_RESUME, { v: PROTOCOL_VERSION, code, role, token: token.current });
      pending = false;
      if (!live || stopped) return;
      if (result.ok) accept(result);
      else if (['no-room', 'bad-session'].includes(result.error)) {
        clearToken(role, code); token.current = null; needsResume.current = false;
        setReconnecting(false); setSnapshot(null); setEnded(result.error === 'no-room' ? 'ended' : 'expired');
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
    const closed = () => {
      clearToken(role, code); token.current = null; needsResume.current = false;
      setSnapshot(null); setReconnecting(false); setEnded('ended');
    };
    const replaced = () => {
      stopped = true; token.current = null; needsResume.current = false;
      setSnapshot(null); setReconnecting(false); setEnded('replaced');
    };
    const away = () => {
      if (token.current && socket.connected && !stopped) socket.emit(EVENTS.SESSION_AWAY, { code });
      disconnected();
    };
    const pageShow = () => { if (token.current) needsResume.current = true; resume(); };
    window.addEventListener('pagehide', away);
    window.addEventListener('pageshow', pageShow);
    socket.on('connect', resume); socket.on('disconnect', disconnected);
    socket.on(EVENTS.LOBBY_UPDATE, update); socket.on(EVENTS.ROOM_CLOSED, closed); socket.on(EVENTS.SESSION_REPLACED, replaced);
    const timer = setInterval(resume, 2000);
    resume();
    return () => {
      live = false; clearInterval(timer);
      window.removeEventListener('pagehide', away);
      window.removeEventListener('pageshow', pageShow);
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
    const result = await request(role === 'host' ? EVENTS.HOST_CLOSE : EVENTS.PLAYER_LEAVE, {});
    if (!result.ok) return false;
    clearToken(role, code); token.current = null; needsResume.current = false;
    setSnapshot(null); setReconnecting(false); setEnded(null);
    return true;
  }
  return { snapshot, reconnecting, ended, storageWarning, accept, leave };
}
