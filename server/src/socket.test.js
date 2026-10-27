import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { io } from 'socket.io-client';
import { EVENTS, PROTOCOL_VERSION } from '@wee/shared/protocol.js';
import { createGameServer } from './app.js';
import { RoomStore } from './RoomStore.js';
const v = PROTOCOL_VERSION;
const send = (socket, event, payload = {}) => socket.timeout(2000).emitWithAck(event, payload);
async function connect(url) {
  const socket = io(url, { transports: ['websocket'], reconnection: false });
  await once(socket, 'connect'); return socket;
}
async function fixture(t, options = {}) {
  const app = createGameServer({ ...options, tickMs: 10 });
  app.http.listen(0, '127.0.0.1'); await once(app.http, 'listening');
  const url = `http://127.0.0.1:${app.http.address().port}`;
  const sockets = [];
  t.after(async () => { for (const socket of sockets) socket.disconnect(); await app.close(); });
  return { app, client: async () => { const socket = await connect(url); sockets.push(socket); return socket; } };
}
function nextSnapshot(socket, predicate) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.off(EVENTS.LOBBY_UPDATE, handler); reject(new Error('Missing lobby update')); }, 2000);
    const handler = state => { if (predicate(state)) { clearTimeout(timer); socket.off(EVENTS.LOBBY_UPDATE, handler); resolve(state); } };
    socket.on(EVENTS.LOBBY_UPDATE, handler);
  });
}

test('real sockets: phone and TV reconnect to the same room, and a duplicate tab loses access', async t => {
  const { client } = await fixture(t);
  const host = await client(), phone = await client();
  const room = await send(host, EVENTS.HOST_CREATE, { v, sport: 'tennis' });
  const seat = await send(phone, EVENTS.PLAYER_JOIN, { v, code: room.code, name: 'Yit' });
  const paused = nextSnapshot(host, state => state.paused);
  phone.disconnect(); await paused;
  const back = await client();
  const resumed = await send(back, EVENTS.SESSION_RESUME, { v, code: room.code, token: seat.token, role: 'player' });
  assert.equal(resumed.name, 'Yit'); assert.equal(resumed.slot, seat.slot); assert.equal(resumed.paused, false);
  const replaced = once(back, EVENTS.SESSION_REPLACED), twin = await client();
  await send(twin, EVENTS.SESSION_RESUME, { v, code: room.code, token: seat.token, role: 'player' });
  await replaced;
  await send(back, EVENTS.PLAYER_LEAVE);
  const hostState = await send(host, EVENTS.LOBBY_GET, { code: room.code });
  assert.equal(hostState.players.length, 1);
  const waiting = nextSnapshot(twin, state => state.paused);
  host.disconnect(); await waiting;
  const tvBack = await client();
  const restored = await send(tvBack, EVENTS.SESSION_RESUME, { v, code: room.code, token: room.token, role: 'host' });
  assert.equal(restored.players[0].name, 'Yit'); assert.equal(restored.paused, false);
  const closed = once(twin, EVENTS.ROOM_CLOSED);
  await send(tvBack, EVENTS.HOST_CLOSE); await closed;
});

test('real sockets: timeout sweep releases a seat without incoming messages', async t => {
  const { client } = await fixture(t, { store: new RoomStore({ graceMs: 40 }) });
  const host = await client(), phone = await client();
  const room = await send(host, EVENTS.HOST_CREATE, { v, sport: 'tennis' });
  await send(phone, EVENTS.PLAYER_JOIN, { v, code: room.code, name: 'Yit' });
  const expired = nextSnapshot(host, state => state.players.length === 0);
  phone.disconnect(); await expired;
});
