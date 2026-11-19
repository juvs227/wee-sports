import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import {io} from 'socket.io-client';
import {ControllerSession} from '../../apps/controller/src/session.js';
import {AutomaticControllerSetup} from '../../apps/controller/src/automaticSetup.js';
import {createControllerCapabilities} from '../../shared/controllerCapabilities.js';
import {EVENTS, PROTOCOL_VERSION} from '../../shared/protocol.js';
import {createGameServer} from './app.js';
import {RoomStore} from './RoomStore.js';

async function until(predicate) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (predicate()) return;
    await delay(10);
  }
  assert.fail('native controller did not reach the expected server state');
}

for (const sport of ['tennis', 'bowling']) {
  test(`native ${sport}: automatic touch setup and one authenticated action reach the real room server`, {timeout: 10000}, async t => {
    const previousDev = globalThis.__DEV__;
    globalThis.__DEV__ = true; // Permit this test's loopback HTTP origin only.
    let now = 1000, flow;
    const store = new RoomStore({now: () => now});
    const app = createGameServer({store, tickMs: 10});
    const events = [];
    app.io.on('connection', socket => socket.onAny(event => events.push(event)));
    app.http.listen(0, '127.0.0.1'); await once(app.http, 'listening');
    const origin = `http://127.0.0.1:${app.http.address().port}`;
    const tv = io(origin, {transports: ['websocket'], reconnection: false});
    const native = new ControllerSession(origin, {changed: (seat, status) => flow?.update(seat, status)});
    flow = new AutomaticControllerSetup({session: native, makeMotion() {throw new Error('touch mode must not start sensors');}});
    flow.select('touch');
    t.after(async () => {
      flow.stop(); native.dispose(); tv.disconnect(); await app.close();
      if (previousDev === undefined) delete globalThis.__DEV__;
      else globalThis.__DEV__ = previousDev;
    });
    await once(tv, 'connect');
    const capabilities = createControllerCapabilities({buttons: true});
    const room = await tv.timeout(2000).emitWithAck(EVENTS.HOST_CREATE, {v: PROTOCOL_VERSION, sport, capabilities});
    assert.equal(room.ok, true);
    assert.equal((await native.join(room.code, 'Native', capabilities)).ok, true);
    await until(() => native.seat?.canStart && native.inputSetup === 'buttons');
    assert.equal((await flow.startGame()).ok, true);
    now += 5000;
    await until(() => native.seat?.phase === 'game');
    const state = sport === 'bowling' ? {phase: 'ready', currentPlayer: 1, frame: 1} : {phase: 'serve', server: 1, winner: null};
    assert.equal((await tv.timeout(2000).emitWithAck(EVENTS.HOST_GAME_STATE, {gameId: native.seat.gameId, ...state})).ok, true);
    await until(() => native.controlsPlaying() && native.seat.gameState?.phase === state.phase);
    const received = [];
    const output = sport === 'bowling' ? EVENTS.GAME_ROLL : EVENTS.GAME_SWING;
    const input = sport === 'bowling' ? EVENTS.PLAYER_ROLL : EVENTS.PLAYER_SWING;
    const payload = sport === 'bowling' ? {type: 'roll', power: .6, aim: .2, spin: 0} : {type: 'swing', label: 'Forehand', hand: 'Right', power: .6, aim: .2, depth: 0};
    tv.on(output, (event, ack) => {received.push(event); ack({ok: true});});
    const result = await native.action(input, payload);
    assert.equal(result.ok, true);
    assert.equal(received.length, 1);
    assert.equal(received[0].id, result.id);
    assert.equal(received[0].player, 1);
    native.setControlsActive(false);
    assert.equal((await native.action(input, payload)).error, 'not-playing');
    assert.equal(received.length, 1);
    assert.equal(events.includes('profile:claim-token'), false, 'guest-only native controllers do not request disabled profile persistence');
  });
}
