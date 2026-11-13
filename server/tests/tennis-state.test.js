import { expect, test } from 'vitest';
import { RoomStore } from '@server/src/RoomStore.js';
import { COUNTDOWN_SECONDS, PROTOCOL_VERSION as v, VOTE_SECONDS, isTennisState } from '@wee/shared/protocol.js';

test('only the current host can publish validated tennis serve/match status', () => {
  let now = 0;
  const store = new RoomStore({ now: () => now });
  const { code } = store.createRoom('tv', { v, sport: 'tennis' });
  store.join('phone', { v, code, name: 'Player' });
  store.setSetup('phone', { setup: 'motion' });
  store.setReady('phone', { ready: true }); store.startGame('phone');
  now += COUNTDOWN_SECONDS * 1000;
  store.finishCountdown(code);
  now += VOTE_SECONDS * 1000;
  store.expireVote(code);
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
  const modern = {...status, score: [3, 2], sets: [1, 0], completedSets: [{player1: 7, player2: 5}], targetPoints: 7, setsToWin: 2};
  expect(store.setGameState('tv', modern).ok).toBe(true);
  modern.score[0] = 99; modern.sets[0] = 99; modern.completedSets[0].player1 = 99;
  expect(store.lobby(code).gameState).toMatchObject({score: [3, 2], sets: [1, 0], completedSets: [{player1: 7, player2: 5}]});
  expect(store.setGameState('tv', { ...status, phase: 'complete', winner: 2 }).ok).toBe(true);
  expect(store.lobby(code).gameState.winner).toBe(2);
  const swing = { type: 'swing', id: 'late-swing', gameId, hand: 'Right', label: 'Forehand' };
  expect(store.swingTarget('phone', swing)).toMatchObject({ ok: false, error: 'not-playing' });
  expect(store.setGameState('tv', { ...status, phase: 'prepare' }).ok).toBe(true);
  expect(store.lobby(code).gameState.phase).toBe('prepare');
  expect(store.swingTarget('phone', swing).ok).toBe(true);
});


test('seven-point set snapshots validate the complete score bundle and remain compatible with status-only TVs', () => {
  const base = {phase: 'serve', server: 2, winner: null, practice: false, score: [7, 6], sets: [1, 1],
    completedSets: [{player1: 7, player2: 0}, {player1: 4, player2: 7}], targetPoints: 7, setsToWin: 2};
  expect(isTennisState(base)).toBe(true);
  for (const change of [{score: [8, 6]}, {score: [1]}, {score: [1.5, 2]}, {sets: [2, 1]},
    {completedSets: [{player1: 7, player2: 6}]}, {targetPoints: 6}, {setsToWin: 3}]) expect(isTennisState({...base, ...change})).toBe(false);
  expect(isTennisState({phase: 'serve', server: 1, winner: null, score: [0, 0]})).toBe(false);
  const final = {...base, phase: 'complete', winner: 1, score: [8, 6], sets: [2, 1],
    completedSets: [...base.completedSets, {player1: 8, player2: 6}]};
  expect(isTennisState(final)).toBe(true);
  expect(isTennisState({...final, winner: 2})).toBe(false);
  expect(isTennisState({...final, score: [0, 0]})).toBe(false);
  expect(isTennisState({...final, phase: 'rally', winner: null, practice: true})).toBe(true);
  expect(isTennisState({phase: 'complete', server: 1, winner: 2})).toBe(true);
});
