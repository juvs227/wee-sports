import {test} from 'vitest';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import {io} from 'socket.io-client';
import {EVENTS, PROTOCOL_VERSION as v, VOTE_SECONDS} from '@wee/shared/protocol.js';
import {sendSwingRequest} from '@wee/src/network/swingRequest.js';
import {createGameServer} from '@server/src/app.js';
import {RoomStore} from '@server/src/RoomStore.js';
import {createDirectInput} from '@client/lib/directInput.js';

const send = (socket, event, data = {}) => socket.timeout(2000).emitWithAck(event, data);
function transportTrace(transports) {
  if (process.env.WEE_SWING_TRANSPORT_TRACE !== '1') return {begin() {}, end:()=>null};
  let active=false,started=0,events=[];
  const record=(side,kind,value)=>{if(active)events.push({at:+(performance.now()-started).toFixed(2),side,kind,value});};
  for(const [side,transport] of Object.entries(transports)) {
    let writable=transport.writable;
    Object.defineProperty(transport,'writable',{configurable:true,
      get(){record(side,'read',writable);return writable;},
      set(value){writable=value;record(side,'set',value);}});
    for(const event of ['ready','drain','poll','pollComplete'])transport.on(event,()=>record(side,event,writable));
  }
  return {begin(){events=[];started=performance.now();active=true;},end(){active=false;return events;}};
}
async function fixture(t, transport = 'websocket') {
  let now = 0;
  const store = new RoomStore({now: () => now});
  const app = createGameServer({store, tickMs: 10});
  const clients = [];
  t.onTestFinished(async () => { for (const client of clients) client.disconnect(); await app.close(); });
  app.http.listen(0, '127.0.0.1'); await once(app.http, 'listening');
  const connect = async () => {
    const client = io(`http://127.0.0.1:${app.http.address().port}`, {transports: [transport], reconnection: false});
    clients.push(client); await once(client, 'connect'); return client;
  };
  const tv = await connect(), phone = await connect();
  const room = await send(tv, EVENTS.HOST_CREATE, {v, sport: 'tennis'});
  const seat = await send(phone, EVENTS.PLAYER_JOIN, {v, code: room.code, name: 'P1'});
  await send(phone, EVENTS.PLAYER_SETUP, {setup: 'buttons'});
  const start = async () => {
    await send(phone, EVENTS.PLAYER_READY, {ready: true});
    await send(phone, EVENTS.PLAYER_START, {});
    now += 5000; store.finishCountdown(room.code);
    now += VOTE_SECONDS * 1000; store.expireVote(room.code);
    return store.lobby(room.code).gameId;
  };
  const gameId = await start();
  const stroke = (id, game = gameId) => ({type: 'swing', id, gameId: game, label: 'Forehand', hand: 'Right', power: .5});
  const trace=transportTrace({phone:phone.io.engine.transport,tv:tv.io.engine.transport,server:app.io.sockets.sockets.get(tv.id).conn.transport});
  return {app, store, tv, phone, room, seat, gameId, start, stroke, connect, trace};
}

function onInput(store, id) {
  return new Promise(resolve => {
    const original = store.swingTarget.bind(store);
    store.swingTarget = (...args) => {
      const result = original(...args);
      if (args[1]?.id === id) { store.swingTarget = original; resolve(result); }
      return result;
    };
  });
}

for (const transport of ['websocket', 'polling']) {
  test(`${transport}: sustained healthy swings are delivered once without third-input slowdown`, {timeout: 40000}, async t => {
    const {tv, phone, gameId, stroke, trace} = await fixture(t, transport);
    const received = [], roundTrips = [];
    tv.on(EVENTS.GAME_SWING, (event, ack) => { received.push(event.id); ack({ok: true}); });
    // Includes a heartbeat interval; normal TV state broadcasts run beside input.
    for (let index = 0; index < 104; index++) {
      await delay(250);
      trace.begin();
      const status = send(tv, EVENTS.HOST_GAME_STATE, {gameId, phase: index % 2 ? 'rally' : 'serve', server: 1, winner: null});
      const started = performance.now();
      const result = await sendSwingRequest(phone, EVENTS.PLAYER_SWING, stroke(`stroke-${index}`));
      const events=trace.end();
      if(!result.ok && events)console.info(JSON.stringify({swing:index+1,result,events}));
      roundTrips.push(performance.now() - started);
      assert.equal(result.ok, true, `${transport} swing ${index + 1}: ${result.error}`);
      await status;
    }
    assert.equal(received.length, 104); assert.equal(new Set(received).size, 104);
    assert.deepEqual(phone.sendBuffer, []);
    const ordered = [...roundTrips].sort((a, b) => a - b);
    console.info(`${transport}: 104/104 once; median=${ordered[52].toFixed(2)}ms, p95=${ordered[98].toFixed(2)}ms; third=${roundTrips[2].toFixed(2)}ms; last=${roundTrips.at(-1).toFixed(2)}ms (local relay only)`);
  });
}

test('a blocked TV transport rejects input instead of releasing old swings after recovery', async t => {
  const {app, tv, phone, stroke} = await fixture(t);
  const received = [];
  tv.on(EVENTS.GAME_SWING, (event, ack) => { received.push(event); ack({ok: true}); });
  const transport = app.io.sockets.sockets.get(tv.id).conn.transport;
  transport.writable = false;
  assert.equal((await send(phone, EVENTS.PLAYER_SWING, stroke('blocked'))).error, 'network-busy');
  transport.writable = true;
  assert.equal((await send(phone, EVENTS.PLAYER_SWING, stroke('fresh'))).ok, true);
  assert.deepEqual(received.map(event => event.id), ['fresh']);
});

test('optional direct leases cannot occupy a slow polling POST and make a fresh swing expire', async t => {
  const {store,tv,phone,room,stroke}=await fixture(t,'polling');
  const lobby=store.lobby(room.code),scope={gameId:lobby.gameId,generation:lobby.inputGeneration,hostEpoch:lobby.hostEpoch};
  const transport=phone.io.engine.transport,write=transport.write;
  const received=[];tv.on(EVENTS.GAME_SWING,(event,ack)=>{received.push(event.id);ack({ok:true});});
  let optionalPosts=0;
  transport.write=function(packets) {
    if(packets.some(packet=>typeof packet.data==='string'&&packet.data.includes('direct:register'))) {
      optionalPosts++;this.writable=false;
      setTimeout(()=>write.call(this,packets),200);return;
    }
    return write.call(this,packets);
  };
  t.onTestFinished(()=>{transport.write=write;});
  // Demonstrate the old failure with an actual delayed polling POST, rather
  // than assuming it from a mocked transport's writable flag.
  const oldLease=send(phone,'direct:register',scope);
  const blocked=await sendSwingRequest(phone,EVENTS.PLAYER_SWING,stroke('behind-lease'));
  assert.equal(blocked.error,'network-busy');await oldLease;
  assert.equal(optionalPosts,1);assert.deepEqual(received,[]);

  const input=createDirectInput({socket:phone,context:{...scope,role:'player',player:1,sport:'tennis'},
    PeerConnection:class{constructor(){throw new Error('Polling should not negotiate a peer');}}});
  t.onTestFinished(()=>input.dispose());
  assert.equal(input.sendSwing(stroke('fresh')),null);
  const result=await sendSwingRequest(phone,EVENTS.PLAYER_SWING,stroke('fresh'));
  assert.equal(result.ok,true);assert.deepEqual(received,['fresh']);
  assert.equal(optionalPosts,1,'No optional register was put ahead of the new swing');
});

test('a fresh tennis swing crosses a 120ms polling GET handoff once within the shared budget', async t => {
  const {app,tv,phone,stroke}=await fixture(t,'polling');
  const transport=app.io.sockets.sockets.get(tv.id).conn.transport, onPoll=transport.onPollRequest;
  const received=[];tv.on(EVENTS.GAME_SWING,(event,ack)=>{received.push(event.id);ack({ok:true});});
  const readyBy=performance.now()+2000;
  while(!transport.writable || !transport.res) {
    assert.ok(performance.now()<readyBy,'The initial polling GET becomes available');
    await delay(1);
  }
  let timer,held;
  transport.onPollRequest=function(req,res) {
    transport.onPollRequest=onPoll;
    held=res;
    timer=setTimeout(()=>{held=null;onPoll.call(this,req,res);},120);
  };
  t.onTestFinished(()=>{clearTimeout(timer);held?.destroy();transport.onPollRequest=onPoll;});
  // Consume the current real GET; the TV's next GET is deliberately held for
  // 120ms, matching a measured normal handoff that exceeded the old 80ms cap.
  transport.send([{type:'noop'}]);
  const result=await sendSwingRequest(phone,EVENTS.PLAYER_SWING,stroke('handoff'));
  assert.equal(result.ok,true);assert.deepEqual(received,['handoff']);
});

test('pause and resume during a brief transport wait cancels the old swing', async t => {
  const {app, store, tv, phone, gameId, stroke} = await fixture(t);
  const received = [];
  tv.on(EVENTS.GAME_SWING, (event, ack) => { received.push(event); ack({ok: true}); });
  const transport = app.io.sockets.sockets.get(tv.id).conn.transport;
  transport.writable = false;
  const waiting = onInput(store, 'before-pause');
  const pending = send(phone, EVENTS.PLAYER_SWING, stroke('before-pause'));
  await waiting;
  assert.equal(store.setPaused(tv.id, {gameId, paused: true}, 'host').ok, true);
  assert.equal(store.setPaused(tv.id, {gameId, paused: false}, 'host').ok, true);
  transport.writable = true;
  assert.equal((await pending).error, 'not-playing');
  assert.deepEqual(received, []);
  assert.equal((await send(phone, EVENTS.PLAYER_SWING, stroke('after-resume'))).ok, true);
});

test('Play again invalidates a waiting swing even when the lobby game id is retained', async t => {
  const {app, store, tv, phone, gameId, stroke} = await fixture(t);
  const received = [];
  tv.on(EVENTS.GAME_SWING, (event, ack) => { received.push(event); ack({ok: true}); });
  assert.equal(store.setGameOptions(tv.id, {gameId, sport: 'tennis', settings: {
    assistance: 'standard', botDifficulty: 'standard', autoMove: true, timingAssist: true, splitView: true, format: 'full',
  }, practice: {active: false, stroke: 'alternate', hand: 'Right'}, humanOpponent: false}).ok, true);
  const transport = app.io.sockets.sockets.get(tv.id).conn.transport;
  transport.writable = false;
  const waiting = onInput(store, 'before-replay');
  const pending = send(phone, EVENTS.PLAYER_SWING, stroke('before-replay'));
  await waiting;
  const reset = store.gameCommandTarget(phone.id, {id: 'replay', gameId, action: 'new-match', format: 'full'});
  assert.equal(reset.ok, true);
  store.finishGameCommand(reset.code, reset.event.id, gameId);
  transport.writable = true;
  assert.equal((await pending).error, 'not-playing');
  assert.deepEqual(received, []);
});

test('server retains at most one waiting swing for a phone rather than releasing a queued burst', async t => {
  const {app, store, tv, phone, stroke} = await fixture(t);
  const received = [];
  tv.on(EVENTS.GAME_SWING, (event, ack) => { received.push(event.id); ack({ok: true}); });
  const transport = app.io.sockets.sockets.get(tv.id).conn.transport;
  transport.writable = false;
  const waiting = onInput(store, 'waiting');
  const pending = send(phone, EVENTS.PLAYER_SWING, stroke('waiting'));
  await waiting;
  const excess = await Promise.all(Array.from({length: 12}, (_, i) => send(phone, EVENTS.PLAYER_SWING, stroke(`excess-${i}`))));
  assert.ok(excess.every(result => result.error === 'network-busy'));
  transport.writable = true;
  assert.equal((await pending).ok, true);
  assert.deepEqual(received, ['waiting']);
});

for (const role of ['host', 'player']) test(`session replacement cancels waiting input from the old ${role} socket`, async t => {
  const {app, store, tv, phone, room, seat, stroke, connect} = await fixture(t);
  const replacement = await connect();
  const received = [];
  for (const client of [tv, replacement]) client.on(EVENTS.GAME_SWING, (event, ack) => { received.push(event); ack({ok: true}); });
  const transport = app.io.sockets.sockets.get(tv.id).conn.transport;
  transport.writable = false;
  const waiting = onInput(store, 'before-replacement');
  const pending = send(phone, EVENTS.PLAYER_SWING, stroke('before-replacement'));
  await waiting;
  assert.equal((await send(replacement, EVENTS.SESSION_RESUME, {v, code: room.code, role, token: role === 'host' ? room.token : seat.token})).ok, true);
  transport.writable = true;
  assert.equal((await pending).ok, false);
  assert.deepEqual(received, []);
});

test('old lobby swings and their late delivery replies cannot enter a replacement game', async t => {
  const {tv, phone, room, gameId, start, stroke} = await fixture(t);
  let acknowledge;
  const received = [];
  tv.on(EVENTS.GAME_SWING, (event, ack) => { received.push(event); acknowledge = ack; });
  const arrived = once(tv, EVENTS.GAME_SWING);
  const pending = send(phone, EVENTS.PLAYER_SWING, stroke('old-delivery'));
  await arrived;
  await send(tv, EVENTS.HOST_RETURN_TO_LOBBY, {gameId});
  const next = await start();
  acknowledge({ok: true});
  assert.equal((await pending).error, 'not-playing');
  assert.equal((await send(phone, EVENTS.PLAYER_SWING, stroke('late-old-input'))).error, 'not-playing');
  assert.equal(received.length, 1);
  tv.off(EVENTS.GAME_SWING); tv.on(EVENTS.GAME_SWING, (_event, ack) => ack({ok: true}));
  assert.equal((await send(phone, EVENTS.PLAYER_SWING, stroke('new-input', next))).ok, true);
  assert.equal((await send(tv, EVENTS.LOBBY_GET, {code: room.code})).gameId, next);
});
