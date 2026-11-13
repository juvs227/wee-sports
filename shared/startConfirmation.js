/** A confirmation belongs to this sport and roster, never to a replacement room. */
export function startConfirmationKey(lobby) {
  if (!lobby || lobby.phase !== 'ready' || lobby.paused || !lobby.canStart) return null;
  return JSON.stringify([lobby.code, lobby.sport, lobby.gameId, lobby.inputGeneration, lobby.leaderSlot,
    lobby.players.map(player => [player.id, player.slot, player.name, player.ready, player.setup])]);
}
