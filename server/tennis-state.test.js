import { expect, test } from 'vitest';
import { RoomStore } from './src/RoomStore.js';
import { COUNTDOWN_SECONDS, PROTOCOL_VERSION as v, isTennisState } from '../shared/protocol.js';

test('only the current host can publish validated tennis serve/match status', () => {
  let now = 0;
  const store = new RoomStore({ now: () => now });
  const { code } = store.createRoom('tv', { v, sport: 'tennis' });
  store.join('phone', { v, code, name: 'Player' });
  store.setSetup('phone', { setup: 'motion' });
  store.setReady('phone', { ready: true });
  store.start('tv');
  now += COUNTDOWN_SECONDS * 1000;
  store.finishCountdown(code);
  const { gameId } = store.lobby(code);
  const status = { gameId, phase: 'serve', server: 1, winner: null };
  expect(store.setGameState('phone', status).ok).toBe(false);
  expect(store.setGameState('tv', { ...status, gameId: 'old' }).ok).toBe(false);
  expect(store.setGameState('tv', status).ok).toBe(true);
  expect(store.lobby(code).gameState).toEqual({ phase: 'serve', server: 1, winner: null });
  for (const invalid of [{ ...status, server: 3 }, { ...status, phase: 'complete' }, { ...status, winner: 1 }]) {
    expect(isTennisState(invalid)).toBe(false);
    expect(store.setGameState('tv', invalid).ok).toBe(false);
  }
  expect(store.setGameState('tv', { ...status, phase: 'complete', winner: 2 }).ok).toBe(true);
  expect(store.lobby(code).gameState.winner).toBe(2);
  const swing = { type: 'swing', id: 'late-swing', hand: 'Right', label: 'Forehand' };
  expect(store.swingTarget('phone', swing)).toMatchObject({ ok: false, error: 'not-playing' });
  expect(store.setGameState('tv', { ...status, phase: 'prepare' }).ok).toBe(true);
  expect(store.lobby(code).gameState.phase).toBe('prepare');
  expect(store.swingTarget('phone', swing).ok).toBe(true);
});
