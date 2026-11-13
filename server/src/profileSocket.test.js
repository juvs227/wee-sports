import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {io} from 'socket.io-client';
import {EVENTS, PROTOCOL_VERSION as v} from '../../shared/protocol.js';
import {ProfileStore} from '../profiles/store.js';
import {createProfileService} from '../profiles/service.js';
import {createGameServer} from './app.js';
import {RoomStore} from './RoomStore.js';

const send = (socket, event, payload = {}) => socket.timeout(2000).emitWithAck(event, payload);
async function fixture(t) {
  const accounts = new ProfileStore();
  const owner = await accounts.register({username:'socket_owner',password:'socket-test-password',displayName:'Owner'});
  const other = await accounts.register({username:'socket_other',password:'socket-test-password',displayName:'Other'});
  const profiles = createProfileService({store:accounts});
  let now = 0;
  const store = new RoomStore({now:() => now});
  const app = createGameServer({store, profiles, tickMs:10000});
  app.http.listen(0, '127.0.0.1'); await once(app.http, 'listening');
  const origin = `http://127.0.0.1:${app.http.address().port}`;
  const sockets = [];
  t.after(async () => {for (const socket of sockets) socket.disconnect(); await app.close(); profiles.close();});
  async function connect(options = {}) {
    const socket = io(origin, {transports:['websocket'], forceNew:true, reconnection:false, ...options});
    sockets.push(socket); await once(socket, 'connect'); return socket;
  }
  return {accounts, owner, other, profiles, store, origin, connect, advance:ms => {now += ms;}};
}

test('foreign-origin handshakes are rejected and originless cookies cannot bind an account', async t => {
  const f = await fixture(t);
  const denied = io(f.origin, {transports:['websocket'], reconnection:false,
    extraHeaders:{Origin:'https://untrusted.example', Cookie:`wee_profile=${f.owner.token}`}});
  t.after(() => denied.disconnect());
  await once(denied, 'connect_error');
  assert.equal(denied.connected, false);
  assert.equal(f.store.roomCount, 0);
  const socket = await f.connect({extraHeaders:{Cookie:`wee_profile=${f.owner.token}`}});
  const room = await send(socket, EVENTS.HOST_CREATE, {v, sport:'bowling'});
  assert.equal(room.ok, true, 'originless native guest play remains available');
  assert.equal(f.store.sessionContext(socket.id).profileId, null);
  assert.deepEqual(await send(socket, EVENTS.HOST_RESTORE, {matchId:'private-match'}), {ok:false,error:'not-signed-in'});
});

test('same-origin cookie auth is private and native bearer auth takes precedence over cookies', async t => {
  const f = await fixture(t);
  const browser = await f.connect({extraHeaders:{Origin:f.origin, Cookie:`wee_profile=${f.owner.token}`}});
  const browserRoom = await send(browser, EVENTS.HOST_CREATE, {v, sport:'bowling'});
  assert.equal(f.store.sessionContext(browser.id).profileId, f.owner.profile.id);
  assert.equal(JSON.stringify(browserRoom).includes(f.owner.token), false);
  assert.equal(JSON.stringify(f.store.lobby(browserRoom.code)).includes(f.owner.profile.id), false);
  const native = await f.connect({auth:{profileToken:f.other.token}, extraHeaders:{Cookie:`wee_profile=${f.owner.token}`}});
  assert.equal((await send(native, EVENTS.HOST_CREATE, {v,sport:'bowling'})).ok, true);
  assert.equal(f.store.sessionContext(native.id).profileId, f.other.profile.id);
  const invalidNative = await f.connect({auth:{profileToken:'invalid'}, extraHeaders:{Origin:f.origin,Cookie:`wee_profile=${f.owner.token}`}});
  await send(invalidNative, EVENTS.HOST_CREATE, {v,sport:'bowling'});
  assert.equal(f.store.sessionContext(invalidNative.id).profileId, null, 'invalid explicit auth must not silently select another cookie account');
});

test('logout and account changes affect future rounds without reassigning the active match', async t => {
  const f = await fixture(t);
  const tv = await f.connect();
  const room = await send(tv, EVENTS.HOST_CREATE, {v,sport:'bowling'});
  const player = await f.connect({auth:{profileToken:f.owner.token}});
  const seat = await send(player, EVENTS.PLAYER_JOIN, {v,code:room.code,name:'Owner'});
  await send(player, EVENTS.PLAYER_SETUP, {setup:'buttons'});
  await send(player, EVENTS.PLAYER_READY, {ready:true});
  await send(player, EVENTS.PLAYER_START, {});
  f.advance(5000); f.store.finishCountdown(room.code);
  const gameId = f.store.lobby(room.code).gameId;
  assert.equal(f.store.sessionContext(player.id).room.players[0].profileId, f.owner.profile.id);
  f.accounts.logout(f.owner.token);
  player.disconnect();
  const guest = await f.connect({auth:{profileToken:f.owner.token}});
  assert.equal((await send(guest, EVENTS.SESSION_RESUME, {v,role:'player',code:room.code,token:seat.token})).ok, true);
  assert.equal(f.store.sessionContext(guest.id).profileId, null);
  assert.equal(f.store.sessionContext(guest.id).room.players[0].profileId, f.owner.profile.id, 'active round keeps its original attribution');
  f.store.setGameOptions(tv.id, {gameId,sport:'bowling'});
  tv.on(EVENTS.GAME_COMMAND, (_event, ack) => ack({ok:true}));
  assert.equal((await send(guest, EVENTS.PLAYER_GAME_COMMAND, {id:'guest-new-round',gameId,action:'new-match'})).ok, true);
  assert.equal(f.store.sessionContext(guest.id).room.players[0].profileId, null, 'next round is guest-owned after logout');
  guest.disconnect();
  const changed = await f.connect({auth:{profileToken:f.other.token}});
  assert.equal((await send(changed, EVENTS.SESSION_RESUME, {v,role:'player',code:room.code,token:seat.token})).ok, true);
  assert.equal(f.store.sessionContext(changed.id).profileId, f.other.profile.id);
  assert.equal(f.store.sessionContext(changed.id).room.players[0].profileId, null, 'sign-in cannot take ownership of an already-started guest round');
  assert.equal((await send(changed, EVENTS.PLAYER_GAME_COMMAND, {id:'account-new-round',gameId,action:'new-match'})).ok, true);
  assert.equal(f.store.sessionContext(changed.id).room.players[0].profileId, f.other.profile.id);
});

test('profile storage failure falls back to guest play and cannot authorize restore', async t => {
  const f = await fixture(t);
  const socket = await f.connect({auth:{profileToken:f.owner.token}});
  const authenticate = f.accounts.authenticate;
  f.accounts.authenticate = () => {throw new Error('simulated storage failure');};
  try {
    assert.equal((await send(socket, EVENTS.HOST_CREATE, {v,sport:'bowling'})).ok, true);
    assert.equal(f.store.sessionContext(socket.id).profileId, null);
    assert.deepEqual(await send(socket, EVENTS.HOST_RESTORE, {matchId:'private-match'}), {ok:false,error:'not-signed-in'});
  } finally {f.accounts.authenticate = authenticate;}
});
