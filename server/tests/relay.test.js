import { test } from 'vitest';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { WebSocket } from 'ws';
import { attachRelay } from '@server/relay.js';
import { createGameServer } from '@server/src/app.js';
import { io } from 'socket.io-client';
import { EVENTS, PROTOCOL_VERSION } from '@wee/shared/protocol.js';

test('lobby websocket and swing relay coexist on one port and keep separate rooms', async () => {
  const app = createGameServer();
  const relay = attachRelay(app.http);
  const clients = [];
  const lobbySockets = [];
  try {
    app.http.listen(0, '127.0.0.1');
    await once(app.http, 'listening');
    const url = `http://127.0.0.1:${app.http.address().port}`;
    for (let i = 0; i < 2; i += 1) {
      const host = io(url, { transports: ['websocket'], reconnection: false });
      lobbySockets.push(host);
      await once(host, 'connect');
      const room = await host.timeout(2000).emitWithAck(EVENTS.HOST_CREATE, { v: PROTOCOL_VERSION, sport: 'tennis' });
      assert.equal(room.ok, true);
      const game = new WebSocket(`${url.replace('http:', 'ws:')}/swings?room=lobby-${room.code}&role=game`);
      clients.push(game);
      await once(game, 'open');
      if (i === 0) {
        const phone = new WebSocket(`${url.replace('http:', 'ws:')}/swings?room=lobby-${room.code}&role=phone`);
        clients.push(phone);
        await once(phone, 'open');
      }
    }
    // Engine.io must not reap the other relay's upgrade after its one-second timeout.
    await new Promise(resolve => setTimeout(resolve, 1100));
    const [game, phone, otherGame] = clients;
    let leaked = false;
    otherGame.on('message', () => { leaked = true; });
    const received = once(game, 'message', { signal: AbortSignal.timeout(2000) });
    const ack = once(phone, 'message', { signal: AbortSignal.timeout(2000) });
    phone.send(JSON.stringify({ type: 'swing', id: 'combined-test', label: 'Forehand', hand: 'Right' }));
    assert.equal(JSON.parse((await received)[0]).id, 'combined-test');
    assert.equal(JSON.parse((await ack)[0]).receivers, 1);
    const snapshot = await lobbySockets[0].timeout(2000).emitWithAck(EVENTS.HOST_CREATE, { v: PROTOCOL_VERSION, sport: 'tennis' });
    assert.equal(snapshot.ok, true);
    assert.equal(leaked, false);
  } finally {
    for (const socket of lobbySockets) socket.disconnect();
    for (const client of clients) client.terminate();
    for (const client of relay.clients) client.terminate();
    await new Promise(resolve => relay.close(resolve));
    await app.close();
  }
});

test('phone events reach only games in the same room; invalid events are rejected', async () => {
  const server = createServer();
  const relay = attachRelay(server);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `ws://127.0.0.1:${server.address().port}/swings`;
  const clients = [];
  async function connect(room, role) {
    const socket = new WebSocket(`${base}?room=${room}&role=${role}`);
    clients.push(socket);
    await once(socket, 'open');
    return socket;
  }
  const next = socket => once(socket, 'message', { signal: AbortSignal.timeout(2000) }).then(([data]) => JSON.parse(data));
  try {
    const game = await connect('room-one', 'game');
    const phone = await connect('room-one', 'phone');
    const other = await connect('room-two', 'game');
    const otherMessages = [];
    other.on('message', data => otherMessages.push(data));
    const expected = { type: 'swing', id: 'test-1', label: 'Backhand', hand: 'Left', netNormal: [0, 0, 1], swingNormal: [1, 0, 0] };
    const received = next(game);
    const ack = next(phone);
    phone.send(JSON.stringify(expected));
    assert.deepEqual(await received, expected);
    assert.equal((await ack).receivers, 1);
    const invalid = next(phone);
    phone.send(JSON.stringify({ ...expected, label: 'Unknown' }));
    assert.equal((await invalid).type, 'error');
    const malformed = next(phone);
    phone.send('not json');
    assert.equal((await malformed).type, 'error');
    const wrongRole = next(game);
    game.send(JSON.stringify(expected));
    assert.equal((await wrongRole).type, 'error');
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(otherMessages.length, 0);
  } finally {
    for (const client of clients) client.terminate();
    for (const client of relay.clients) client.terminate();
    await new Promise(resolve => relay.close(resolve));
    await new Promise(resolve => server.close(resolve));
  }
});

test('standalone relay enforces browser origins while preserving same-origin and native guests', async () => {
  const server = createServer();
  const relay = attachRelay(server, {origins:['https://controller.example']});
  const clients = [];
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  const endpoint = `${origin.replace('http:', 'ws:')}/swings?room=test-origin&role=phone`;
  try {
    for (const Origin of [origin, 'https://controller.example', undefined]) {
      const socket = new WebSocket(endpoint, Origin ? {headers:{Origin}} : {});
      clients.push(socket); await once(socket, 'open');
      assert.equal(socket.readyState, WebSocket.OPEN);
    }
    for (const Origin of ['https://untrusted.example', 'null']) {
      const socket = new WebSocket(endpoint, {headers:{Origin}});
      clients.push(socket); await once(socket, 'error');
      assert.notEqual(socket.readyState, WebSocket.OPEN);
    }
  } finally {
    clients.forEach(client => client.terminate());
    for (const client of relay.clients) client.terminate();
    await new Promise(resolve => relay.close(resolve));
    await new Promise(resolve => server.close(resolve));
  }
});

test('a blocked standalone game receives no queued swing when transport recovers', async () => {
  const server = createServer();
  const relay = attachRelay(server);
  const clients = [];
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `ws://127.0.0.1:${server.address().port}/swings?room=slow-game`;
  try {
    for (const role of ['game', 'phone']) {
      const client = new WebSocket(`${base}&role=${role}`);
      clients.push(client); await once(client, 'open');
    }
    const [game, phone] = clients;
    const gamePeer = [...relay.clients].find(client => client.role === 'game');
    Object.defineProperty(gamePeer, 'bufferedAmount', {configurable:true, value:8192});
    const received = [];
    game.on('message', message => received.push(JSON.parse(message).id));
    const swing = id => JSON.stringify({id, type:'swing', label:'Forehand', hand:'Right'});
    const dropped = once(phone, 'message'); phone.send(swing('blocked'));
    assert.equal(JSON.parse((await dropped)[0]).receivers, 0);
    delete gamePeer.bufferedAmount;
    const delivered = once(game, 'message'); phone.send(swing('fresh'));
    await delivered;
    assert.deepEqual(received, ['fresh']);
  } finally {
    clients.forEach(client => client.terminate());
    for (const client of relay.clients) client.terminate();
    await new Promise(resolve => relay.close(resolve));
    await new Promise(resolve => server.close(resolve));
  }
});

test('oversized standalone input is closed before relay and releases its client entry', async () => {
  const server = createServer();
  const relay = attachRelay(server);
  const clients = [];
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `ws://127.0.0.1:${server.address().port}/swings?room=size-check`;
  try {
    for (const role of ['game', 'phone']) {
      const client = new WebSocket(`${base}&role=${role}`);
      clients.push(client); await once(client, 'open');
    }
    const [game, phone] = clients;
    const received = [];
    game.on('message', message => received.push(message));
    const peer = [...relay.clients].find(client => client.role === 'phone');
    // The server emits the expected max-payload error before closing this peer.
    const closedPeer = new Promise(resolve => peer.once('close', resolve));
    const closedPhone = once(phone, 'close');
    phone.send(JSON.stringify({id:'oversized', type:'swing', label:'Forehand', hand:'Right', padding:'x'.repeat(4096)}));
    assert.equal((await closedPhone)[0], 1009);
    await closedPeer;
    assert.deepEqual(received, []);
    assert.equal(relay.clients.size, 1);
  } finally {
    clients.forEach(client => client.terminate());
    for (const client of relay.clients) client.terminate();
    await new Promise(resolve => relay.close(resolve));
    await new Promise(resolve => server.close(resolve));
  }
});

test('combined server serves both pages and controller module', async () => {
  const process = spawn(globalThis.process.execPath, ['server/main.js'], {
    env: { ...globalThis.process.env, PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let errors = '';
  process.stderr.on('data', data => { errors += data; });
  const lines = createInterface({ input: process.stdout });
  const timeout = setTimeout(() => process.kill(), 10000);
  try {
    let port;
    for await (const line of lines) {
      const match = line.match(/^Game: http:\/\/localhost:(\d+)/);
      if (match) { port = Number(match[1]); break; }
    }
    assert.ok(port, `Server failed to start: ${errors}`);
    const base = `http://127.0.0.1:${port}`;
    for (const path of ['/', '/host/ABCD', '/join?code=ABCD', '/game.html?room=room-one', '/controller.html?room=room-one', '/src/main.ts', '/src/controller/main.js']) {
      const response = await fetch(base + path);
      assert.equal(response.status, 200, path);
      const content = await response.text();
      assert.ok(content.length > 100);
      if (['/', '/host/ABCD', '/join?code=ABCD'].includes(path)) assert.match(content, /client\/src\/main.jsx/);
      if (path.startsWith('/game.html')) assert.match(content, /scene-container/);
    }
    for (const name of ['player', 'racket']) {
      const response = await fetch(`${base}/assets/${name}.glb`);
      assert.equal(response.status, 200);
      const bytes = Buffer.from(await response.arrayBuffer());
      assert.equal(bytes.toString('ascii', 0, 4), 'glTF');
      assert.equal(bytes.readUInt32LE(8), bytes.length);
    }
  } finally {
    clearTimeout(timeout);
    lines.close();
    const exited = once(process, 'exit');
    process.kill();
    if (process.exitCode === null && process.signalCode === null) await exited;
  }
}, 15000);
