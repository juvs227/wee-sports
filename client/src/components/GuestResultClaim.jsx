import {useEffect} from 'react';
import {socket} from '../lib/socket.js';
import {captureGuestClaim} from '../lib/profile.js';

/** Capture only this authenticated phone's claim; it never enters a public URL. */
export function GuestResultClaim({lobby}) {
  useEffect(() => {
    if (!lobby?.gameId) return;
    const capture = () => captureGuestClaim(socket);
    capture();
    socket.on('connect', capture);
    return () => socket.off('connect', capture);
  }, [lobby?.gameId, lobby?.matchRound, lobby?.inputGeneration, lobby?.gameState?.phase, lobby?.recovery?.revision]);
  return null;
}
