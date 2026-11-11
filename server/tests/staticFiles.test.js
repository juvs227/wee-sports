import { afterAll, beforeAll, expect, test } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
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
  await writeFile(join(root, 'assets', 'game-A1b2C3d4.js'), 'export {};');
  await writeFile(join(root, 'sound.wav'), 'audio');
  await writeFile(join(root, 'font.woff2'), 'font');
  await writeFile(`${root}-private.txt`, 'private data outside the build');
  await symlink(`${root}-private.txt`, join(root, 'outside.txt'));
  for (const format of ['webp', 'avif', 'jpeg']) await writeFile(join(root, 'assets', `image.${format}`), 'image');
  handler = await createStaticHandler(root);
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(`${root}-private.txt`, {force: true});
});

// Exercise requests as streams only; no port, HTTP server or browser is started.
async function request(url, method = 'GET', requestHeaders = {}) {
  let body = '';
  const headers = {};
  const response = new Writable({ write(chunk, _encoding, done) { body += chunk; done(); } });
  response.setHeader = (name, value) => { headers[name] = value; };
  response.writeHead = (status, values) => { response.status = status; Object.assign(headers, values); };
  const finished = once(response, 'finish');
  await handler({ url, method, headers: requestHeaders }, response);
  await finished;
  return { status: response.status, headers, body };
}

test('production deep links use the application entry while game/model files remain separate', async () => {
  for (const path of ['/', '/home', '/home/', '/home?region=resort', '/host/ABCD', '/join?code=ABCD', '/profile', '/profile/']) {
    expect(await request(path)).toMatchObject({status: 200, body: 'index', headers: {'cache-control': 'no-cache'}});
  }
  expect((await request('/controller.html?room=lobby-ABCD')).body).toBe('controller');
  expect((await request('/table-tennis.html')).status).toBe(404);
  expect((await request('/table-tennis-controller.html')).status).toBe(404);
  const model = await request('/assets/player.glb');
  expect(model.body).toBe('model');
  expect(model.headers['content-type']).toBe('model/gltf-binary');
  expect((await request('/game.html')).headers['cache-control']).toBe('no-cache');
});

test('optimized image images have image MIME types and revalidate across releases', async () => {
  for (const format of ['webp', 'avif', 'jpeg']) {
    const response = await request(`/assets/image.${format}`);
    expect(response).toMatchObject({status: 200, body: 'image', headers: {
      'content-type': `image/${format}`, 'content-length': 5,
      'cache-control': 'no-cache', 'x-content-type-options': 'nosniff',
    }});
  }
  expect(await request('/home', 'HEAD')).toMatchObject({status: 200, body: '', headers: {'content-length': 5}});
  for (const path of ['/home/missing', '/assets/missing.webp', '/home/%2e%2e/.env']) {
    expect((await request(path)).status).toBe(404);
  }
});

test('unchanged assets return 304 but replaced files invalidate their cached representation', async () => {
  const first = await request('/assets/player.glb');
  expect(await request('/assets/player.glb', 'GET', {'if-none-match': first.headers.etag}))
    .toMatchObject({status: 304, body: '', headers: {'cache-control': 'no-cache'}});
  await writeFile(join(root, 'assets', 'player.glb'), 'updated model');
  expect(await request('/assets/player.glb', 'GET', {'if-none-match': first.headers.etag}))
    .toMatchObject({status: 200, body: 'updated model'});
  expect((await request('/assets/game-A1b2C3d4.js')).headers['cache-control']).toBe('public, max-age=31536000, immutable');
  expect((await request('/sound.wav')).headers['content-type']).toBe('audio/wav');
  expect((await request('/font.woff2')).headers['content-type']).toBe('font/woff2');
});

test('HEAD returns metadata without a body; unknown paths never serve source', async () => {
  expect(await request('/game.html', 'HEAD')).toMatchObject({ status: 200, body: '', headers: { 'content-length': 4 } });
  for (const path of ['/src/main.ts', '/.env', '/../package.json', '/%2e%2e/package.json', '/%5c..%5cpackage.json', '/outside.txt']) {
    expect((await request(path)).status).toBe(404);
  }
  expect((await request('/%zz')).status).toBe(400);
  expect((await request('/game.html', 'POST')).status).toBe(405);
});

test('an incomplete build fails before the server can report ready', async () => {
  await expect(createStaticHandler(join(root, 'missing'))).rejects.toThrow();
});
