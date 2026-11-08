import { afterAll, beforeAll, expect, test } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { once } from 'node:events';
import { createStaticHandler } from '@server/staticFiles.js';

let root, handler;
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'wee-static-'));
  for (const name of ['index', 'game', 'bowling', 'controller']) await writeFile(join(root, `${name}.html`), name);
  await mkdir(join(root, 'assets'));
  await writeFile(join(root, 'assets', 'player.glb'), 'model');
  handler = await createStaticHandler(root);
});
afterAll(async () => { await rm(root, { recursive: true, force: true }); });

// Exercise requests as streams only; no port, HTTP server or browser is started.
async function request(url, method = 'GET') {
  let body = '';
  const headers = {};
  const response = new Writable({ write(chunk, _encoding, done) { body += chunk; done(); } });
  response.setHeader = (name, value) => { headers[name] = value; };
  response.writeHead = (status, values) => { response.status = status; Object.assign(headers, values); };
  const finished = once(response, 'finish');
  await handler({ url, method }, response);
  await finished;
  return { status: response.status, headers, body };
}

test('production routes host/join to the homepage and serves game/model files', async () => {
  for (const path of ['/', '/host/ABCD', '/join?code=ABCD']) expect((await request(path)).body).toBe('index');
  expect((await request('/controller.html?room=lobby-ABCD')).body).toBe('controller');
  const model = await request('/assets/player.glb');
  expect(model.body).toBe('model');
  expect(model.headers['content-type']).toBe('model/gltf-binary');
  expect((await request('/game.html')).headers['cache-control']).toBe('no-cache');
});

test('HEAD returns metadata without a body; unknown paths never serve source', async () => {
  expect(await request('/game.html', 'HEAD')).toMatchObject({ status: 200, body: '', headers: { 'content-length': 4 } });
  for (const path of ['/src/main.ts', '/.env', '/../package.json', '/%2e%2e/package.json', '/%5c..%5cpackage.json']) {
    expect((await request(path)).status).toBe(404);
  }
  expect((await request('/%zz')).status).toBe(400);
  expect((await request('/game.html', 'POST')).status).toBe(405);
});

test('an incomplete build fails before the server can report ready', async () => {
  await expect(createStaticHandler(join(root, 'missing'))).rejects.toThrow();
});
