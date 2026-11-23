import { PHASES } from '@wee/shared/protocol.js';

/** Advance fixture rooms past the tennis avatar confirmation when a test needs gameplay. */
export function finishAvatarScene(store, code, playerIds) {
  if (store.lobby(code)?.phase !== PHASES.AVATARS) return;
  for (const playerId of playerIds) store.setReady(playerId, { ready: true });
}
