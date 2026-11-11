import { test } from 'vitest';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { io } from 'socket.io-client';
import { EVENTS, PROTOCOL_VERSION as v } from '@wee/shared/protocol.js';
import { RoomStore } from '@server/src/RoomStore.js';
import { createGameServer } from '@server/src/app.js';

test('shared sound is scoped to members and initialization never overwrites a chosen mute', () => {
  const store = new RoomStore();
  const room = store.createRoom('tv', { v, sport: 'bowling' });
  const phone = store.join('phone', { v, code: room.code, name: 'Player' });
  const other = store.createRoom('other-tv', { v, sport: 'tennis' });
  assert.equal(store.lobby(room.code).soundMuted, null);
  assert.equal(store.setSound('stranger', { muted: true, code: room.code }).ok, false);
  for (const payload of [null, {}, { muted: 'true' }, { muted: false, initialize: 'yes' }]) {
    assert.equal(store.setSound('phone', payload).error, 'bad-sound');
  }
  assert.equal(store.setSound('phone', { muted: true, initialize: true }).error, 'not-host');
  assert.equal(store.setSound('tv', { muted: true, initialize: true }).muted, true);
  assert.equal(store.setSound('phone', { muted: false }).muted, false);
  assert.equal(store.setSound('tv', { muted: true, initialize: true }).changed, false);
  store.setSound('other-tv', { muted: true, code: room.code });
  assert.equal(store.lobby(room.code).soundMuted, false);
  assert.equal(store.lobby(other.code).soundMuted, true);
  store.setSound('phone', { muted: true });
  store.disconnect('phone');
  assert.equal(store.setSound('phone', { muted: false }).ok, false);
  store.resume('new-phone', { v, code: room.code, token: phone.token, role: 'player' });
  assert.equal(store.lobby(room.code).soundMuted, true);
  assert.equal(store.setSound('new-phone', { muted: false }).ok, true);
});

test('phone mute and unmute broadcast to its TV over real sockets and survive TV replacement', async t => {
  const app = createGameServer();
  app.http.listen(0, '127.0.0.1');
  await once(app.http, 'listening');
  const clients = [];
  t.onTestFinished(async () => { clients.forEach(client => client.disconnect()); await app.close(); });
  async function connect() {
    const client = io(`http://127.0.0.1:${app.http.address().port}`, { transports: ['websocket'], reconnection: false });
    clients.push(client); await once(client, 'connect'); return client;
  }
  const send = (client, event, payload) => client.timeout(2000).emitWithAck(event, payload);
  const waitForSound = (client, muted) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => { client.off(EVENTS.LOBBY_UPDATE, changed); reject(new Error('No sound snapshot')); }, 2000);
    function changed(snapshot) {
      if (snapshot.soundMuted !== muted) return;
      clearTimeout(timer); client.off(EVENTS.LOBBY_UPDATE, changed); resolve(snapshot);
    }
    client.on(EVENTS.LOBBY_UPDATE, changed);
  });
  const tv = await connect(), phone = await connect();
  const room = await send(tv, EVENTS.HOST_CREATE, { v, sport: 'bowling' });
  await send(phone, EVENTS.PLAYER_JOIN, { v, code: room.code, name: 'Player' });
  await send(tv, EVENTS.SOUND_SET, { muted: false, initialize: true });
  for (const muted of [true, false]) {
    const snapshot = waitForSound(tv, muted);
    assert.equal((await send(phone, EVENTS.SOUND_SET, { muted })).ok, true);
    assert.equal((await snapshot).soundMuted, muted);
  }
  await send(phone, EVENTS.SOUND_SET, { muted: true });
  const replacement = await connect();
  const resumed = await send(replacement, EVENTS.SESSION_RESUME, { v, code: room.code, token: room.token, role: 'host' });
  assert.equal(resumed.soundMuted, true);
  assert.equal((await send(tv, EVENTS.SOUND_SET, { muted: false })).ok, false);
  assert.equal((await send(replacement, EVENTS.SOUND_SET, { muted: false, initialize: true })).muted, true);
});
