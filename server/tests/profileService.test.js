import {afterEach, expect, test} from 'vitest';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {ProfileStore} from '@server/profiles/store.js';
import {createProfileService} from '@server/profiles/service.js';
import {ProfileError} from '@server/profiles/validation.js';

const resources = [];
afterEach(async () => { for (const cleanup of resources.splice(0).reverse()) await cleanup(); });
async function fixture(options = {}) {
  const store = new ProfileStore(), service = createProfileService({store, ...options});
  const server = createServer((request, response) => service.handle(request, response));
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  resources.push(async () => { await new Promise(resolve => server.close(resolve)); await service.close(); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const post = (path, username = 'first_player') => fetch(origin + '/api/profile/' + path, {
    method: 'POST', headers: {'content-type': 'application/json', origin},
    body: JSON.stringify({username, password: 'a disposable password', ...(path === 'register' ? {displayName: 'Player'} : {})}),
  });
  return {store, service, post};
}

test('one exhausted account quota does not lock other players behind the same ingress address', async () => {
  let now = 1;
  const {store, post} = await fixture({now: () => now});
  store.login = async () => { throw new ProfileError('invalid-login', 401); };
  for (let attempt = 0; attempt < 10; attempt++) expect((await post('login')).status).toBe(401);
  expect((await post('login', 'FIRST_PLAYER')).status).toBe(429);
  expect((await post('login', 'second_player')).status).toBe(401);
  now += 15 * 60 * 1000;
  expect((await post('login')).status).toBe(401);
});

test('authentication work is bounded and excess requests receive a retryable response', async () => {
  const {store, post} = await fixture();
  let release, started, count = 0;
  const gate = new Promise(resolve => { release = resolve; });
  const entered = new Promise(resolve => { started = resolve; });
  store.login = async () => {
    if (++count === 4) started();
    await gate;
    throw new ProfileError('invalid-login', 401);
  };
  const pending = Array.from({length: 4}, (_, i) => post('login', `player_${i}`));
  try {
    await entered;
    const rejected = await post('login', 'extra_player');
    expect(rejected.status).toBe(429);
    expect(await rejected.json()).toEqual({error: 'too-many-attempts'});
    expect(count).toBe(4);
  } finally { release(); await Promise.all(pending); }
  expect((await post('login', 'extra_player')).status).toBe(401);
});

test('shutdown drains in-flight registration before closing SQLite and rejects new profile work', async () => {
  const {store, service, post} = await fixture();
  const register = store.register.bind(store);
  let release, started;
  const gate = new Promise(resolve => { release = resolve; });
  const entered = new Promise(resolve => { started = resolve; });
  store.register = async input => { started(); await gate; return register(input); };
  const pending = post('register');
  try {
    await entered;
    const closed = service.close();
    expect(service.status()).toEqual({available: false, closing: true});
    expect(store.db.isOpen).toBe(true);
    expect((await post('register', 'new_player')).status).toBe(503);
    release();
    expect((await pending).status).toBe(201);
    await closed;
    expect(store.db.isOpen).toBe(false);
    expect(service.close()).toBe(closed);
  } finally { release(); await pending; }
});

test('failed durable registration reports storage unavailable, preserves the username, and can retry after repair', async () => {
  const {store, service, post} = await fixture();
  store.db.exec("CREATE TRIGGER fail_session BEFORE INSERT ON sessions BEGIN SELECT RAISE(ABORT, 'simulated-write-failure'); END;");
  const failed = await post('register');
  expect(failed.status).toBe(503);
  expect(await failed.json()).toEqual({error: 'profile-storage-unavailable'});
  expect(failed.headers.has('set-cookie')).toBe(false);
  expect(service.status()).toEqual({available: false, closing: false});
  store.db.exec('DROP TRIGGER fail_session');
  expect((await post('register')).status).toBe(201);
  expect(service.status()).toEqual({available: true, closing: false});
});
