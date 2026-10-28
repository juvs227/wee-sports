import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PHASES, PROTOCOL_VERSION, RECONNECT_MS } from '@wee/shared/protocol.js';
import { RoomStore } from './RoomStore.js';
const v = PROTOCOL_VERSION;
function setup(count = 1) {
  const clock = { now: 1000 };
  const store = new RoomStore({ now: () => clock.now });
  const host = store.createRoom('host', { v, sport: 'tennis' });
  const players = Array.from({ length: count }, (_, i) => store.join(`p${i}`, { v, code: host.code, name: `Player ${i}` }));
  for (let i = 0; i < Math.min(count, 2); i++) store.setSetup(`p${i}`, { setup: 'motion' });
  return { store, clock, host, players, code: host.code };
}
const restore = (store, socket, session) => store.resume(socket, { v, code: session.code, token: session.token, role: session.role });

test('a disconnect reserves the same name and seat, including readiness', () => {
  const { store, players, code } = setup(4);
  store.setReady('p0', { ready: true });
  store.disconnect('p0');
  assert.equal(store.lobby(code).paused, true);
  assert.equal(store.lobby(code).players.length, 4);
  assert.equal(store.setReady('p1', { ready: true }).error, 'paused');
  const resumed = restore(store, 'new-phone', players[0]);
  assert.equal(resumed.name, players[0].name);
  assert.equal(resumed.slot, 0);
  assert.equal(resumed.players[0].ready, true);
  assert.equal(resumed.paused, false);
  assert.equal(store.setReady('p0', { ready: false }).ok, false);
  assert.equal(store.setReady('new-phone', { ready: false }).ok, true);
});

test('TV reload preserves the room and players and transfers host permission', () => {
  const { store, host, code } = setup();
  store.disconnect('host');
  assert.equal(store.roomCount, 1);
  const resumed = restore(store, 'new-tv', host);
  assert.equal(resumed.role, 'host');
  assert.equal(resumed.players.length, 1);
  assert.equal(store.hostedBy('new-tv'), code);
  assert.equal(store.hostedBy('host'), null);
});

test('wrong tokens, room codes, roles, and protocol versions cannot resume', () => {
  const { store, players, code } = setup();
  const payload = { v, code, token: players[0].token, role: 'player' };
  for (const change of [{ token: 'guess' }, { token: null }, { role: 'host' }, { code: 'ZZZZ' }, { v: 0 }]) {
    assert.equal(store.resume('intruder', { ...payload, ...change }).ok, false);
  }
  assert.equal(store.resume('intruder', null).ok, false);
  assert.equal(store.createRoom('intruder', null).ok, false);
  assert.equal(store.join('intruder', null).ok, false);
  assert.equal(store.lobby(code).players.length, 1);
});

test('public snapshots never contain session tokens', () => {
  const { store, code, host, players } = setup();
  const publicState = JSON.stringify(store.lobby(code));
  assert.equal(publicState.includes(host.token), false);
  assert.equal(publicState.includes(players[0].token), false);
  assert.equal(publicState.includes('token'), false);
});

test('repeated create and join requests are idempotent', () => {
  const { store, code, host, players } = setup();
  assert.equal(store.createRoom('host', { v, sport: 'tennis' }).token, host.token);
  assert.equal(store.join('p0', { v, code, name: 'Another name' }).token, players[0].token);
  assert.equal(store.lobby(code).players.length, 1);
  assert.equal(store.join('p0', { v, code: 'ZZZZ', name: 'No' }).ok, false);
  assert.equal(store.lobby(code).players[0].name, players[0].name);
});

test('a second tab takes over once and the old socket cannot remove the restored player', () => {
  const { store, players, code } = setup();
  const resumed = restore(store, 'new-tab', players[0]);
  assert.equal(resumed.replacedSocketId, 'p0');
  assert.equal(store.disconnect('p0'), null);
  assert.equal(store.remove('p0'), null);
  assert.equal(store.lobby(code).players.length, 1);
  assert.equal(store.lobby(code).paused, false);
});

test('one socket cannot claim a different session without leaving its own', () => {
  const { store, players } = setup(2);
  assert.equal(restore(store, 'p1', players[0]).error, 'already-in-room');
});

test('all missing participants must return before the flow resumes', () => {
  const { store, host, players, code } = setup(2);
  store.disconnect('host'); store.disconnect('p0'); store.disconnect('p1');
  restore(store, 'tv-back', host); restore(store, 'phone-back', players[0]);
  assert.equal(store.lobby(code).paused, true);
  assert.equal(store.lobby(code).reconnecting.length, 1);
  restore(store, 'other-back', players[1]);
  assert.equal(store.lobby(code).paused, false);
});

test('countdown freezes on disconnect and continues with its remaining duration', () => {
  const { store, players, clock, code } = setup(4);
  for (let i = 0; i < 4; i++) store.setReady(`p${i}`, { ready: true });
  store.start('host'); clock.now += 2000;
  store.disconnect('p0'); clock.now += 20_000;
  assert.equal(store.finishCountdown(code), null);
  assert.equal(store.lobby(code).countdown.msLeft, 3000);
  restore(store, 'back', players[0]);
  clock.now += 2999; assert.equal(store.finishCountdown(code), null);
  clock.now++; assert.deepEqual(store.finishCountdown(code), { code });
  assert.equal(store.lobby(code).phase, PHASES.TUTORIAL);
});

test('reconnecting during the tutorial preserves the current flow', () => {
  const { store, players, clock, code } = setup(4);
  for (let i = 0; i < 4; i++) store.setReady(`p${i}`, { ready: true });
  store.start('host'); clock.now += 5000; store.finishCountdown(code);
  store.disconnect('p1');
  assert.equal(store.lobby(code).paused, true);
  assert.equal(restore(store, 'back', players[1]).phase, PHASES.TUTORIAL);
});

test('expiration frees the reserved seat and invalidates the old token', () => {
  const { store, players, clock, code } = setup(4);
  store.disconnect('p0'); clock.now += RECONNECT_MS;
  // Expired tokens are rejected even before the background sweep runs.
  assert.equal(restore(store, 'late', players[0]).error, 'bad-session');
  store.expireDisconnected();
  assert.equal(store.lobby(code).phase, PHASES.LOBBY);
  assert.equal(store.lobby(code).players.length, 3);
  assert.equal(store.join('replacement', { v, code, name: 'Replacement' }).slot, 0);
  assert.equal(restore(store, 'late', players[0]).ok, false);
});

test('a host timeout closes the room and invalidates all player sessions', () => {
  const { store, host, players, clock, code } = setup();
  store.disconnect('host'); clock.now += RECONNECT_MS;
  assert.equal(store.expireDisconnected()[0].closed, true);
  assert.equal(store.lobby(code), null);
  assert.equal(restore(store, 'host-back', host).error, 'no-room');
  assert.equal(restore(store, 'phone-back', players[0]).error, 'no-room');
});

test('explicit Leave immediately releases a seat and prevents session recovery', () => {
  const { store, players, code } = setup();
  store.remove('p0');
  assert.equal(store.lobby(code).players.length, 0);
  assert.equal(restore(store, 'back', players[0]).error, 'bad-session');
});

test('a server restart reports an ended game rather than inventing a new session', () => {
  const { players } = setup();
  assert.equal(restore(new RoomStore(), 'back', players[0]).error, 'no-room');
});

test('navigating away and creating another lobby on the same socket does not overwrite the reserved session', () => {
  const { store, host, code, clock } = setup();
  store.disconnect('host', code);
  const next = store.createRoom('host', { v, sport: 'tennis' });
  assert.notEqual(next.code, code);
  assert.equal(store.roomCount, 2);
  // A delayed navigation message for the old page must not pause the new room.
  assert.equal(store.disconnect('host', code), null);
  assert.equal(store.lobby(next.code).paused, false);
  clock.now += RECONNECT_MS;
  store.expireDisconnected();
  assert.equal(store.lobby(code), null);
  assert.equal(store.hostedBy('host'), next.code);
  assert.equal(restore(store, 'back', host).error, 'no-room');
});
