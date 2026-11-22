import {expect, test} from 'vitest';



import {RoomStore} from '@server/src/RoomStore.js';
import {PROTOCOL_VERSION as v, PHASES, VOTE_SECONDS, playerCapacity} from '@wee/shared/protocol.js';
import {createControllerCapabilities} from '@wee/shared/controllerCapabilities.js';

function fixture(sport = 'bowling', count = 8) {
  let now = 1000;
  const store = new RoomStore({now: () => now});
  const capabilities = createControllerCapabilities();
  const host = store.createRoom('tv', {v, sport, capabilities});
  const phones = Array.from({length: count}, (_, i) => store.join(`p${i + 1}`, {v, code: host.code, name: `Player ${i + 1}`, capabilities}));
  const ready = player => {store.setSetup(`p${player}`, {setup: 'buttons'}); return store.setReady(`p${player}`, {ready: true});};
  const start = () => {
    for (let i = 1; i <= count; i++) ready(i);
    store.startGame('p1');
    now += 5000; store.finishCountdown(host.code);
    now += VOTE_SECONDS * 1000; store.expireVote(host.code);
    return store.lobby(host.code);
  };
  return {store, host, phones, ready, start, advance: ms => {now += ms;}};
}

test('eight bowling phones have unique seats, a ninth is rejected, and the leader confirms play', () => {
  const {store, host, phones, ready, advance} = fixture();
  expect(phones.map(phone => phone.slot)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  expect(store.join('p9', {v, code: host.code, name: 'Ninth'}).error).toBe('room-full');
  for (let i = 1; i <= 7; i++) expect(ready(i).countdownStarted).toBeUndefined();
  expect(store.lobby(host.code).phase).toBe(PHASES.READY);
  expect(ready(8).countdownStarted).toBeUndefined();
  expect(store.startGame('p1').countdownStarted).toBe(true);
  advance(5000); store.finishCountdown(host.code);
  expect(store.lobby(host.code).phase).toBe(PHASES.GAME);
  expect(store.lobby(host.code).leaderSlot).toBe(0);
});

test('a smaller ready party waits for its leader to choose Start, without configuring the TV', () => {
  const {store, host, ready} = fixture('bowling', 2);
  expect(store.startGame('tv').error).toBe('not-game-leader');
  expect(store.startGame('p2').error).toBe('not-game-leader');
  expect(store.startGame('p1').error).toBe('players-not-ready');
  expect(ready(1).countdownStarted).toBeUndefined();
  expect(ready(2).countdownStarted).toBeUndefined();
  expect(store.lobby(host.code)).toMatchObject({phase: PHASES.READY, canStart: true, leaderSlot: 0});
  expect(store.startGame('p1').countdownStarted).toBe(true);
  expect(store.lobby(host.code).phase).toBe(PHASES.COUNTDOWN);
});

test('eighth bowler can aim at 60Hz, roll, reconnect into the same seat, and remain isolated from spoofed players', () => {
  const {store, host, phones, start, advance} = fixture();
  const state = start();
  expect(store.setGameState('tv', {gameId: state.gameId, phase: 'ready', currentPlayer: 8, frame: 1}).ok).toBe(true);
  const aim = {gameId: state.gameId, generation: state.inputGeneration, hostEpoch: state.hostEpoch, seq: 1, aim: .3, locked: false};
  expect(store.continuousTarget('p1', aim, 'aim').error).toBe('not-your-turn');
  expect(store.continuousTarget('p8', {...aim, player: 1}, 'aim').event.player).toBe(8);
  advance(17);
  expect(store.continuousTarget('p8', {...aim, seq: 2, aim: -.2}, 'aim').ok).toBe(true);
  expect(store.rollTarget('p8', {...aim, type: 'roll', id: 'eight-roll', power: .6, spin: .2, aim: -.2, player: 1}).event.player).toBe(8);
  store.disconnect('p8');
  expect(store.lobby(host.code).paused).toBe(true);
  expect(store.join('p9', {v, code: host.code, name: 'Ninth'}).error).toBe('room-full');
  const returned = store.resume('p8-back', {v, code: host.code, role: 'player', token: phones[7].token});
  expect(returned.slot).toBe(7);
  expect(returned.players).toHaveLength(8);
  expect(returned.paused).toBe(false);
  expect(store.resume('new-tv', {v, code: host.code, role: 'host', token: host.token}).players).toHaveLength(8);
});








test('eight friends can scan and tap Play one at a time without unreadying earlier phones', () => {
  const capabilities = createControllerCapabilities();
  const store = new RoomStore();
  const host = store.createRoom('tv', {v, sport: 'bowling', capabilities});
  for (let player = 1; player <= 8; player++) {
    expect(store.join(`p${player}`, {v, code: host.code, name: `Friend ${player}`, capabilities}).ok).toBe(true);
    expect(store.lobby(host.code).players.slice(0, -1).every(seat => seat.ready)).toBe(true);
    store.setSetup(`p${player}`, {setup: 'buttons'});
    const result = store.setReady(`p${player}`, {ready: true});
    expect(result.countdownStarted).toBeUndefined();
  }
  expect(store.lobby(host.code).players.every(seat => seat.ready)).toBe(true);
});



for (const sport of ['tennis', 'bowling']) {
  test(`${sport}: solo waits for Start and can return, choose another sport and restart without stale input`, () => {
    const f = fixture(sport, 1);
    expect(f.ready(1).countdownStarted).toBeUndefined();
    expect(f.store.lobby(f.host.code)).toMatchObject({phase: PHASES.READY, canStart: true});
    const game = f.start();
    expect(game.phase).toBe(PHASES.GAME);
    expect(f.store.returnToLobby('p1', {gameId: game.gameId}, 'player').ok).toBe(true);
    expect(f.store.lobby(f.host.code).players[0]).toMatchObject({ready: false, setup: 'buttons'});
    expect(f.ready(1).countdownStarted).toBeUndefined();
    const nextSport = sport === 'bowling' ? 'tennis' : 'bowling';
    expect(f.store.switchSport('p1', {sport: nextSport, gameId: null}, 'player').ok).toBe(true);
    f.ready(1);
    expect(f.store.startGame('p1').countdownStarted).toBe(true);
    const next = f.store.lobby(f.host.code);
    expect(next.gameId).not.toBe(game.gameId);
    expect(next.inputGeneration).toBeGreaterThan(game.inputGeneration);
    expect(f.store.returnToLobby('p1', {gameId: game.gameId}, 'player').error).toBe('not-playing');
  });
  test(`${sport}: a full roster waits for confirmation on initial play and on return`, () => {
    const f = fixture(sport, playerCapacity(sport));
    for (let i = 1; i < playerCapacity(sport); i++) expect(f.ready(i).countdownStarted).toBeUndefined();
    expect(f.ready(playerCapacity(sport)).countdownStarted).toBeUndefined();
    expect(f.store.startGame('p1').countdownStarted).toBe(true);
    const gameId = f.store.lobby(f.host.code).gameId;
    expect(f.store.returnToLobby('p1', {gameId}, 'player').ok).toBe(true);
    for (let i = 1; i <= playerCapacity(sport); i++) expect(f.ready(i).countdownStarted).toBeUndefined();
    expect(f.store.lobby(f.host.code)).toMatchObject({phase: PHASES.READY, canStart: true});
    expect(f.store.startGame('p1').countdownStarted).toBe(true);
  });
  test(`${sport}: leaving leader releases P1 to the remaining phone and invalidates old input`, () => {
    const f = fixture(sport, 2);
    const game = f.start();
    expect(f.store.remove('p1').closed).toBe(false);
    const view = f.store.lobby(f.host.code);
    expect(view).toMatchObject({phase: PHASES.READY, gameId: null, leaderSlot: 0});
    expect(view.inputGeneration).toBeGreaterThan(game.inputGeneration);
    expect(view.players).toEqual([{slot: 0, name: 'Player 2', ready: false, setup: 'buttons'}]);
    expect(f.store.lobbyForSocket('p2', view)).toMatchObject({slot: 0, name: 'Player 2'});
    expect(f.store.resume('p2-back', {v, code: f.host.code, role: 'player', token: f.phones[1].token}).slot).toBe(0);
    expect(f.store.setReady('p2-back', {ready: true}).countdownStarted).toBeUndefined();
    expect(f.store.startGame('p2-back').countdownStarted).toBe(true);
  });
}
