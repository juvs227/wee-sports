import {io} from 'socket.io-client';
import {WebSocket} from 'ws';
import {afterAll, beforeAll, expect, test} from 'vitest';
import {mkdtemp, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {connect} from 'node:net';



let directory;
const children = [];
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'wee-runtime-'));
  for (const name of ['index', 'game', 'bowling', 'controller']) {
    await writeFile(join(directory, `${name}.html`), `<html>${name}</html>`);
  }
});
afterAll(async () => {
  for (const {child, done} of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await done;
  }
  await rm(directory, {recursive: true, force: true});
});

async function start(overrides = {}) {
  const env = {...process.env, NODE_ENV: 'production', PORT: '0', WEE_BUILD_DIR: directory,
    WEE_PROFILE_DB: join(directory, `profiles-${children.length}.sqlite`)};
  for (const key of ['PUBLIC_GAME_URL', 'RAILWAY_PUBLIC_DOMAIN', 'VITE_PUBLIC_URL', 'NGROK_HOST', 'PHONE_LINK_MANAGED', 'CLIENT_ORIGIN']) delete env[key];
  const child = spawn(process.execPath, ['server/main.js', '--production'], {
    cwd: new URL('../..', import.meta.url), env: {...env, ...overrides}, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const run = {child, output: '', done: once(child, 'exit')};
  children.push(run);
  child.stdout.on('data', chunk => { run.output += chunk; });
  child.stderr.on('data', chunk => { run.output += chunk; });
  run.origin = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Runtime did not start: ${run.output}`)), 5000);
    const read = chunk => {
      const port = String(chunk).match(/Game: http:\/\/localhost:(\d+)/)?.[1];
      if (port) { clearTimeout(timer); child.stdout.off('data', read); resolve(`http://127.0.0.1:${port}`); }
    };
    child.stdout.on('data', read);
    void run.done.then(() => { clearTimeout(timer); reject(new Error(`Runtime exited before readiness: ${run.output}`)); });
  });
  return run;
}

test('production serves all direct routes and shuts down with both realtime transports connected', async () => {
  const run = await start();
  const socket = io(run.origin, {transports: ['websocket'], reconnection: false});
  const relay = new WebSocket(`${run.origin.replace('http:', 'ws:')}/swings?room=runtime-room&role=game`);
  try {
    await Promise.all([once(socket, 'connect'), once(relay, 'open')]);
    const health = await fetch(`${run.origin}/health`);
    expect(health.status).toBe(200);
    expect(await health.text()).toBe('ok');
    expect(health.headers.get('x-wee-profiles')).toBe('ready');
    for (const path of ['/', '/home', '/join', '/host/ABCD', '/profile', '/game.html', '/bowling.html', '/controller.html']) {
      expect((await fetch(run.origin + path)).status, path).toBe(200);
    }
    for (const path of ['/unknown', '/assets/missing.js', '/server/main.js']) expect((await fetch(run.origin + path)).status).toBe(404);
    run.child.kill('SIGTERM');
    expect(await run.done).toEqual([0, null]);
    expect(run.output).toContain('Shutting down (SIGTERM)');
  } finally { socket.disconnect(); relay.terminate(); }
}, 10000);

test('optional profile failure preserves guest readiness and reports unavailable storage', async () => {
  const run = await start({WEE_PROFILE_DB: join(directory, 'index.html', 'profiles.sqlite')});
  const health = await fetch(`${run.origin}/health`);
  expect(health.status).toBe(200);
  expect(health.headers.get('x-wee-profiles')).toBe('unavailable');
  const profile = await fetch(`${run.origin}/api/profile`);
  expect(profile.status).toBe(503);
  expect(await profile.json()).toEqual({error: 'profile-storage-unavailable'});
  run.child.kill('SIGTERM');
  expect(await run.done).toEqual([0, null]);
});

test('an unfinished HTTP request cannot prevent the ten-second shutdown deadline', async () => {
  const run = await start();
  const socket = connect({host: '127.0.0.1', port: Number(new URL(run.origin).port)});
  socket.on('error', () => {});
  try {
    await once(socket, 'connect');
    socket.write('GET /health HTTP/1.1\r\nHost: localhost\r\n');
    const began = Date.now();
    run.child.kill('SIGTERM');
    expect(await run.done).toEqual([1, null]);
    expect(Date.now() - began).toBeGreaterThanOrEqual(9500);
    expect(run.output).toContain('Shutdown exceeded 10 seconds');
  } finally { socket.destroy(); }
}, 15000);
