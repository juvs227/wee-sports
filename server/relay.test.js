import { test } from 'vitest';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { WebSocket } from 'ws';
import { attachRelay } from './relay.js';

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
    const expected = { type: 'swing', id: 'test-1', label: 'Backhand', hand: 'Left' };
    const received = next(game);
    const ack = next(phone);
    phone.send(JSON.stringify(expected));
    assert.deepEqual(await received, expected);
    assert.equal((await ack).receivers, 1);
    const aimed = { ...expected, id: 'aimed-1', aimX: 0.65, aimDepth: -0.4, power: 0.8 };
    const aimedReceived = next(game);
    const aimedAck = next(phone);
    phone.send(JSON.stringify(aimed));
    assert.deepEqual(await aimedReceived, aimed);
    assert.equal((await aimedAck).receivers, 1);
    for (const aimX of [null, '0.5', 2, -2]) {
      const rejected = next(phone);
      phone.send(JSON.stringify({ ...expected, power: aimX }));
      assert.equal((await rejected).type, 'error');
    }
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
    for (const path of ['/', '/controller.html?room=room-one', '/src/main.ts', '/src/controller/main.js']) {
      const response = await fetch(base + path);
      assert.equal(response.status, 200, path);
      assert.ok((await response.text()).length > 100);
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
