/** Bounded disposable real-socket exercise. No endpoint option: this cannot
 * accidentally create load or accounts on an owner's deployed service. */
import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {mkdir, writeFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import os from 'node:os';
import {setTimeout as sleep} from 'node:timers/promises';
import {performance} from 'node:perf_hooks';
import {io} from 'socket.io-client';
import {EVENTS, PROTOCOL_VERSION as v, PHASES} from '../../shared/protocol.js';
import {createControllerCapabilities} from '../../shared/controllerCapabilities.js';

const options = {rooms: 6, cycles: 3, seconds: 15, output: 'stress-results/readiness.json'};
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index].replace(/^--/, '');
  if (!Object.hasOwn(options, key) || !process.argv[index + 1]) throw new Error('Use --rooms, --cycles, --seconds or --output');
  options[key] = key === 'output' ? process.argv[index + 1] : Number(process.argv[index + 1]);
}
for (const [key, maximum] of [['rooms', 20], ['cycles', 12], ['seconds', 120]]) {
  assert.ok(Number.isInteger(options[key]) && options[key] >= 1 && options[key] <= maximum, `Invalid ${key}`);
}
const capabilities = createControllerCapabilities();
const sports = ['tennis', 'bowling'];
const sockets = [], rooms = [], samples = [], errors = [], stages = [];
const expectedDisconnect = new WeakSet();
const child = fork(new URL('./stress-server.js', import.meta.url), [], {
  env: {...process.env, WEE_STRESS_METRICS: '1'}, execArgv: ['--expose-gc'],
  stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
});
const childClosed = new Promise(resolveClosed => child.once('close', resolveClosed));
let metricId = 0, active = false, timer, sent = 0, received = 0, expired = 0;
const latencies = [], pending = new Map(), acknowledgements = new Set(), observed = new Set();
const delivery = {};
const keyFor = (room, kind, player, id) => `${room.index}:${kind}:${player}:${id}`;
const boundedWait = async (check, label, timeout = 12000) => {
  const end = performance.now() + timeout;
  while (!check()) {if (performance.now() >= end) throw new Error(label); await sleep(20);}
};
const request = async (socket, event, payload) => {
  const result = await socket.timeout(5000).emitWithAck(event, payload);
  assert.equal(result?.ok, true, `${event}: ${result?.error || 'No acknowledgement'}`);
  return result;
};
function metrics(label, collect = false) {
  const id = ++metricId;
  return new Promise((resolveMetric, reject) => {
    const onMessage = message => {
      if (message?.id !== id || message.type !== 'metrics') return;
      clearTimeout(timeout); child.off('message', onMessage);
      const value = {label, ...message}; delete value.id; samples.push(value); resolveMetric(value);
    };
    const timeout = setTimeout(() => {child.off('message', onMessage); reject(new Error('Metrics timeout'));}, 5000);
    child.on('message', onMessage); child.send({type: 'metrics', id, collect});
  });
}
function receivedInput(room, kind, event, ack) {
  const key = keyFor(room, kind, event.player, kind === 'swing' ? event.id : event.seq);
  const expected = pending.get(key);
  if (!expected) {
    errors.push(observed.has(key) ? `Duplicate ${kind} delivery` : `Unexpected or late ${kind} delivery`);
    ack?.({ok: false, error: 'unexpected-soak-input'}); return;
  }
  if (event.gameId !== expected.gameId || event.generation !== expected.generation || event.hostEpoch !== expected.hostEpoch) {
    errors.push(`Wrong ${kind} delivery generation`);
    ack?.({ok: false, error: 'wrong-generation'}); return;
  }
  received++; delivery[kind].received++;
  latencies.push(performance.now() - expected.started);
  pending.delete(key); observed.add(key);
  // Old duplicates still fail as unexpected input; bound the diagnostic index.
  if (observed.size > 4096) observed.delete(observed.values().next().value);
  ack?.({ok: true});
}
async function connect(url) {
  const socket = io(url, {transports: ['websocket'], autoConnect: false, reconnection: false, forceNew: true, timeout: 5000});
  sockets.push(socket);
  socket.on('disconnect', reason => {if (!expectedDisconnect.has(socket)) errors.push(`Unexpected disconnect: ${reason}`);});
  socket.on(EVENTS.INPUT_STATUS, status => {if (active && status.error !== 'rate-limited') errors.push(`Input: ${status.error}`);});
  await new Promise((resolveConnect, reject) => {
    const connected = () => {socket.off('connect_error', failed); resolveConnect();};
    const failed = error => {socket.off('connect', connected); reject(error);};
    socket.once('connect', connected); socket.once('connect_error', failed); socket.connect();
  });
  return socket;
}
try {
  const port = await new Promise((resolvePort, reject) => {
    const timeout = setTimeout(() => reject(new Error('Child startup timeout')), 5000);
    child.once('message', message => {clearTimeout(timeout); resolvePort(message.port);});
    child.once('error', error => {clearTimeout(timeout); reject(error);});
  });
  const url = `http://127.0.0.1:${port}`;
  const before = await metrics('empty server', true);
  for (let index = 0; index < options.rooms; index++) {
    const room = {index, host: await connect(url), phones: [], sequences: [0, 0], state: null, nextSwing: 0};
    room.host.on(EVENTS.LOBBY_UPDATE, state => {room.state = state;});
    for (const [event, kind] of [[EVENTS.GAME_POSE, 'pose'], [EVENTS.GAME_AIM, 'aim'], [EVENTS.GAME_SWING, 'swing']]) {
      room.host.on(event, (value, ack) => receivedInput(room, kind, value, ack));
    }
    const created = await request(room.host, EVENTS.HOST_CREATE, {v, sport: sports[index % 3], capabilities});
    room.code = created.code;
    for (let player = 0; player < 2; player++) {
      const socket = await connect(url);
      const joined = await request(socket, EVENTS.PLAYER_JOIN, {v, code: room.code, name: `Soak ${player + 1}`, capabilities});
      room.phones.push({socket, token: joined.token});
      await request(socket, EVENTS.PLAYER_SETUP, {setup: 'buttons'});
    }
    rooms.push(room);
  }
  await metrics('joined');
  for (let cycle = 0; cycle < options.cycles; cycle++) {
    for (const room of rooms) {
      if (cycle) await request(room.phones[0].socket, EVENTS.PLAYER_SWITCH_SPORT, {sport: sports[(room.index + cycle) % 3], gameId: room.state.gameId});
      for (const phone of room.phones) {
        await request(phone.socket, EVENTS.PLAYER_SETUP, {setup: 'buttons'});
        // Match the browser/native Play flow: skip optional Tennis tutorials,
        // while retaining the real countdown and all readiness checks.
        await request(phone.socket, EVENTS.PLAYER_READY, {ready: true, skipTutorial: true});
      }
      await request(room.phones[0].socket, EVENTS.PLAYER_START, {});
    }
    await boundedWait(() => rooms.every(room => room.state?.phase === PHASES.GAME && !room.state.paused), 'Countdown failed');
    for (const room of rooms) if (room.state.sport === 'bowling') {
      await request(room.host, EVENTS.HOST_GAME_STATE, {gameId: room.state.gameId, phase: 'ready', currentPlayer: 1, frame: 1});
    }
    await sleep(100);
    const stageSent = sent, stageReceived = received, stageExpired = expired, start = performance.now();
    const stageDelivery = Object.fromEntries(Object.entries(delivery).map(([kind, count]) => [kind, {...count}]));
    active = true;
    timer = setInterval(() => {
      const now = performance.now();
      // Never catch up old samples after a stalled event loop.
      for (const [key, value] of pending) if (now - value.started > 5000) {pending.delete(key); expired++;}
      for (const room of rooms) {
        const state = room.state, swing = state.sport === 'tennis';
        if (swing && now < room.nextSwing) continue;
        if (swing) room.nextSwing = now + 350;
        for (let player = 1; player <= (state.sport === 'bowling' ? 1 : 2); player++) {
          const kind = swing ? 'swing' : state.sport === 'bowling' ? 'aim' : 'pose';
          const seq = room.sequences[player - 1]++;
          const event = {gameId: state.gameId, generation: state.inputGeneration, hostEpoch: state.hostEpoch};
          if (swing) Object.assign(event, {type: 'swing', id: `soak-${cycle}-${player}-${seq}`, label: 'Forehand', hand: 'Right', power: .5, aim: 0, depth: 0});
          else if (kind === 'aim') Object.assign(event, {seq, aim: Math.sin(now / 1000) * .5, locked: false});
          else Object.assign(event, {seq, orientation: [0, 0, 0, 1], angularVelocity: {x: 0, y: .2, z: 0}, reach: {x: 0, y: 0}, calibrationRevision: 1});
          pending.set(keyFor(room, kind, player, swing ? event.id : seq), {started: now,
            gameId: event.gameId, generation: event.generation, hostEpoch: event.hostEpoch}); sent++;
          delivery[kind] ??= {sent: 0, received: 0}; delivery[kind].sent++;
          const socket = room.phones[player - 1].socket;
          if (!swing) socket.volatile.emit(kind === 'aim' ? EVENTS.PLAYER_AIM : EVENTS.PLAYER_POSE, event);
          else {
            const work = request(socket, EVENTS.PLAYER_SWING, event).catch(error => errors.push(error.message)).finally(() => acknowledgements.delete(work));
            acknowledgements.add(work);
          }
        }
      }
    }, 34);
    await sleep(options.seconds * 1000);
    clearInterval(timer); active = false;
    const emittingSeconds = (performance.now() - start) / 1000;
    await Promise.all(acknowledgements); await sleep(150);
    const counts = Object.fromEntries(Object.entries(delivery).map(([kind, count]) => [kind, {
      sent: count.sent - (stageDelivery[kind]?.sent || 0), received: count.received - (stageDelivery[kind]?.received || 0),
    }]));
    stages.push({cycle: cycle + 1, emittingSeconds, secondsIncludingDrain: (performance.now() - start) / 1000,
      sent: sent - stageSent, received: received - stageReceived, notObserved: sent - stageSent - (received - stageReceived),
      expired: expired - stageExpired, pendingAfterDrain: pending.size, delivery: counts});
    // Latest-state streams may be dropped. Never count their late arrivals as
    // successful delivery in a replacement sport or generation.
    pending.clear();
    const measured = await metrics(`cycle ${cycle + 1}`);
    assert.equal(measured.rooms, options.rooms);
    assert.equal(measured.sockets, options.rooms * 3);
    assert.equal(measured.engineClients, options.rooms * 3);
    assert.deepEqual(measured.serverListeners, before.serverListeners);
    const stage = stages.at(-1);
    console.log(JSON.stringify({cycle: stage.cycle, emittingSeconds: stage.emittingSeconds,
      sent: stage.sent, received: stage.received, notObserved: stage.notObserved,
      rooms: measured.rooms, sockets: measured.sockets, errors: errors.length}));
    for (const room of rooms) {
      // Replace one socket while keeping its private identity and public seat.
      const old = room.phones[1]; expectedDisconnect.add(old.socket); old.socket.disconnect();
      const socket = await connect(url);
      const resumed = await request(socket, EVENTS.SESSION_RESUME, {v, role: 'player', code: room.code, token: old.token, capabilities});
      assert.equal(resumed.slot, 1);
      room.phones[1] = {socket, token: resumed.token || old.token};
      await request(socket, EVENTS.PLAYER_SETUP, {setup: 'buttons'});
      await request(room.host, EVENTS.HOST_RETURN_TO_LOBBY, {gameId: room.state.gameId});
    }
    await boundedWait(() => rooms.every(room => [PHASES.LOBBY, PHASES.READY].includes(room.state.phase)), 'Return to lobby failed');
  }
  for (const room of rooms) await request(room.host, EVENTS.HOST_CLOSE, {});
  for (const socket of sockets) {expectedDisconnect.add(socket); socket.disconnect();}
  await sleep(500);
  const after = await metrics('closed and collected', true);
  assert.equal(after.rooms, 0); assert.equal(after.sockets, 0); assert.equal(after.engineClients, 0); assert.equal(after.socketListeners, 0);
  assert.deepEqual(after.serverListeners, before.serverListeners);
  assert.ok((after.resources.Timeout || 0) <= (before.resources.Timeout || 0) + 2, 'Server timer count did not settle');
  assert.deepEqual(errors, []); assert.ok(received > 0 && stages.every(stage => stage.received > 0));
  for (const [kind, count] of Object.entries(delivery)) assert.ok(count.received > 0, `No ${kind} reached its TV`);
  if (delivery.swing) assert.equal(delivery.swing.received, delivery.swing.sent, 'A deliberate swing was not delivered');
  const ordered = [...latencies].sort((a, b) => a - b), percentile = p => ordered[Math.max(0, Math.ceil(p * ordered.length) - 1)];
  const report = {status: 'passed', recordedAt: new Date().toISOString(), options, environment: {node: process.version, platform: os.platform(), arch: os.arch(), cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length},
    workload: {rooms: options.rooms, players: options.rooms * 2, concurrentSockets: options.rooms * 3, poseAndAimIntervalMs: 34, tennisSwingIntervalMs: 350, sports, countdown: 'normal five seconds', transport: 'websocket'},
    sent, received, delivery, notObserved: sent - received, expired, stages, localDeliveryMs: {p50: percentile(.5), p95: percentile(.95), p99: percentile(.99)}, samples, errors,
    heapChangeAfterCollectionBytes: after.memory.heapUsed - before.memory.heapUsed,
    limitations: ['Synthetic aim/pose/swing routing, phone replacement and sport switching; no bowling releases, scoring, physics, rendering, real sensors, accounts, internet or Wi-Fi.',
      'Configured intervals are nominal; per-stage counts and emitting durations record the actual offered load. Volatile aim/pose packets may be dropped and are included in notObserved.',
      'Both simulated endpoints use the same client clock; timings are local delivery only, not physical motion-to-display latency.',
      'Socket listener totals cover the active registry; stable HTTP/Socket.IO/Engine.IO listener totals and collected memory supplement cleanup checks.',
      'Short bounded run and forced GC measurements do not establish production capacity, an SLO, or absence of all long-term leaks.']};
  await mkdir(dirname(resolve(options.output)), {recursive: true});
  await writeFile(options.output, JSON.stringify(report, null, 2) + '\n', {flag: 'wx'});
  console.log(JSON.stringify({rooms: options.rooms, cycles: options.cycles, sent, received, errors: errors.length, resourcesAfterClose: after, output: options.output}));
} finally {
  clearInterval(timer); active = false;
  for (const socket of sockets) {expectedDisconnect.add(socket); socket.disconnect();}
  child.kill('SIGTERM');
  const forced = setTimeout(() => child.kill('SIGKILL'), 5000);
  await childClosed; clearTimeout(forced);
}
