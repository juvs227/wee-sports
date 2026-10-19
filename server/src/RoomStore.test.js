import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ERRORS, MAX_PLAYERS, NAME_MAX, PROTOCOL_VERSION, isRoomCode } from '@wee/shared/protocol.js';
import { RoomStore } from './RoomStore.js';

const v = PROTOCOL_VERSION;

function openRoom(store = new RoomStore()) {
  const room = store.createRoom('tv', { v, sport: 'tennis' });
  assert.equal(room.ok, true);
  return { store, code: room.code };
}

test('createRoom opens a tennis lobby with a valid, empty code', () => {
  const store = new RoomStore();
  const room = store.createRoom('tv', { v, sport: 'tennis' });
  assert.equal(room.ok, true);
  assert.ok(isRoomCode(room.code), `${room.code} is not a room code`);
  assert.equal(room.sport, 'tennis');
  assert.deepEqual(room.players, []);
  assert.equal(store.hostedBy('tv'), room.code);
});

test('createRoom rejects an old client and a sport that is not open', () => {
  const store = new RoomStore();
  assert.deepEqual(store.createRoom('tv', { v: 0, sport: 'tennis' }), { ok: false, error: ERRORS.BAD_VERSION });
  assert.deepEqual(store.createRoom('tv', { v, sport: 'bowling' }), { ok: false, error: ERRORS.BAD_SPORT });
  assert.equal(store.roomCount, 0);
});

test('createRoom retries when a code is already taken', () => {
  const codes = ['CCCC', 'CCCC', 'DDDD'];
  const store = new RoomStore({ makeCode: () => codes.shift() });
  assert.equal(store.createRoom('tv1', { v, sport: 'tennis' }).code, 'CCCC');
  assert.equal(store.createRoom('tv2', { v, sport: 'tennis' }).code, 'DDDD');
});

test('players take the lowest seat and every join returns the lobby', () => {
  const { store, code } = openRoom();
  const first = store.join('a', { v, code, name: 'Ada' });
  const second = store.join('b', { v, code, name: 'Bo' });
  assert.equal(first.slot, 0);
  assert.equal(second.slot, 1);
  assert.deepEqual(second.players, [
    { slot: 0, name: 'Ada' },
    { slot: 1, name: 'Bo' },
  ]);
});

test(`the lobby is full after ${MAX_PLAYERS} players`, () => {
  const { store, code } = openRoom();
  for (let i = 0; i < MAX_PLAYERS; i += 1) {
    assert.equal(store.join(`p${i}`, { v, code, name: `P${i}` }).ok, true);
  }
  assert.deepEqual(store.join('late', { v, code, name: 'Late' }), { ok: false, error: ERRORS.ROOM_FULL });
});

test('a wrong or malformed code is no-room', () => {
  const { store } = openRoom(new RoomStore({ makeCode: () => 'CCCC' }));
  assert.equal(store.join('a', { v, code: 'DDDD', name: 'Ada' }).error, ERRORS.NO_ROOM);
  assert.equal(store.join('a', { v, code: 'cccc', name: 'Ada' }).error, ERRORS.NO_ROOM);
  assert.equal(store.join('a', { v, code: 'OOOO', name: 'Ada' }).error, ERRORS.NO_ROOM);
  assert.equal(store.join('a', { v, code: undefined, name: 'Ada' }).error, ERRORS.NO_ROOM);
});

test('names are cleaned, capped, and required', () => {
  const { store, code } = openRoom();
  assert.equal(store.join('a', { v, code, name: '   ' }).error, ERRORS.BAD_NAME);
  assert.equal(store.join('a', { v, code, name: 42 }).error, ERRORS.BAD_NAME);
  const long = store.join('b', { v, code, name: '  Maximilian   the Great  ' });
  assert.equal(long.name, 'Maximilian t');
  assert.ok([...long.name].length <= NAME_MAX);
});

test('duplicate names get a number and still fit', () => {
  const { store, code } = openRoom();
  assert.equal(store.join('a', { v, code, name: 'Sam' }).name, 'Sam');
  assert.equal(store.join('b', { v, code, name: 'sam' }).name, 'sam 2');
  assert.equal(store.join('c', { v, code, name: 'Sam' }).name, 'Sam 3');
});

test('a numbered duplicate of a full-length name still fits NAME_MAX', () => {
  const { store, code } = openRoom();
  store.join('a', { v, code, name: 'Christopher!' });
  const twin = store.join('b', { v, code, name: 'Christopher!' });
  assert.equal(twin.name, 'Christophe 2');
  assert.ok([...twin.name].length <= NAME_MAX);
});

test('leaving frees the seat for the next player', () => {
  const { store, code } = openRoom();
  store.join('a', { v, code, name: 'Ada' });
  store.join('b', { v, code, name: 'Bo' });
  assert.deepEqual(store.remove('a'), { code, closed: false });
  assert.equal(store.join('c', { v, code, name: 'Cy' }).slot, 0);
  assert.deepEqual(store.lobby(code).players.map((p) => p.name), ['Cy', 'Bo']);
});

test('the host leaving closes the room and lists who to tell', () => {
  const { store, code } = openRoom();
  store.join('a', { v, code, name: 'Ada' });
  store.join('b', { v, code, name: 'Bo' });
  const result = store.remove('tv');
  assert.equal(result.closed, true);
  assert.deepEqual(result.playerIds.sort(), ['a', 'b']);
  assert.equal(store.lobby(code), null);
  assert.equal(store.roomCount, 0);
  assert.equal(store.join('c', { v, code, name: 'Cy' }).error, ERRORS.NO_ROOM);
  // The closed room's players are no longer members of anything.
  assert.equal(store.remove('a'), null);
});

test('removing someone who is not in a room is a no-op', () => {
  const store = new RoomStore();
  assert.equal(store.remove('nobody'), null);
});
