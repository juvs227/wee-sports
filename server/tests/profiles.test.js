import {afterEach, expect, test} from 'vitest';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {ProfileStore} from '@server/profiles/store.js';
import {createProfileService} from '@server/profiles/service.js';
import {createRoomPersistence} from '@server/profiles/roomPersistence.js';

const resources = [];
afterEach(async () => { for (const cleanup of resources.splice(0).reverse()) await cleanup(); });
const makeStore = options => { const store = new ProfileStore(options); resources.push(() => store.close()); return store; };
const register = (store, name = 'player_one') => store.register({username: name, password: 'a long personal password', displayName: name});
const pins = () => Array.from({length: 10}, (_, i) => ({id: i + 1, position: [i * .1, .4, -9], quaternion: [0, 0, 0, 1], standing: true}));
const bowling = () => ({version: 1, boundary: 'settled', match: {version: 1, players: [{player: 1, name: 'Player'}], deliveries: []}, pins: pins(), settings: {aim: 0}});
const createMatch = (store, profileId = null) => store.createMatch({matchId: 'match-a', sport: 'bowling', hostMemberId: 'host-member', participants: [{memberId: 'player-member', profileId, name: 'Player'}]});
const save = (store, state = bowling(), extra = {}) => store.saveCheckpoint({matchId: 'match-a', hostMemberId: 'host-member', hostEpoch: 1, expectedRevision: 0, state, ...extra});

test('accounts hash passwords, normalize username, authenticate opaque revocable sessions, and isolate profile revisions', async () => {
  const store = makeStore();
  const first = await register(store, 'Player_One');
  expect(first.profile.username).toBe('player_one');
  expect(first.profile).not.toHaveProperty('password_hash');
  const row = store.db.prepare('SELECT password_hash FROM profiles').get();
  expect(row.password_hash).not.toContain('personal');
  await expect(store.login({username: 'player_one', password: 'wrong-password'})).rejects.toThrow('invalid-login');
  const second = await store.login({username: 'PLAYER_ONE', password: 'a long personal password'});
  expect(store.authenticate(second.token).id).toBe(first.profile.id);
  const updated = store.updateProfile(first.profile.id, {revision: 1, preferences: {hand: 'Left'}});
  expect(updated.preferences.hand).toBe('Left');
  expect(() => store.updateProfile(first.profile.id, {revision: 1, displayName: 'stale'})).toThrow('revision-conflict');
  expect(() => store.updateProfile(first.profile.id, {revision: 2, preferences: {gyroBias: 3}})).toThrow('invalid-fields');
  store.logout(second.token); expect(store.authenticate(second.token)).toBeNull();
  expect(store.authenticate(first.token)).not.toBeNull();
});

test('session expiry and username/password constraints are enforced', async () => {
  let now = 1;
  const store = makeStore({now: () => now});
  await expect(store.register({username: 'bad space', displayName: 'Bad', password: 'a long personal password'})).rejects.toThrow('invalid-username');
  await expect(store.register({username: 'valid', displayName: 'Bad', password: 'short'})).rejects.toThrow('password-length');
  const session = await register(store);
  await expect(register(store)).rejects.toThrow('username-taken');
  now += 8 * 24 * 60 * 60 * 1000;
  expect(store.authenticate(session.token)).toBeNull();
});

test('checkpoint CAS rejects stale hosts/revisions and retains exact off-spot pin transforms after process reopen', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'wee-profiles-'));
  resources.push(() => rmSync(directory, {recursive: true, force: true}));
  const filename = join(directory, 'profiles.sqlite');
  let store = new ProfileStore({filename});
  const session = await register(store);
  createMatch(store, session.profile.id);
  const state = bowling(); state.pins[0].position = [.123, .456, -8.765];
  save(store, state);
  expect(() => save(store, {...state, settings: {aim: .1}})).toThrow('revision-conflict');
  store.claimHost({matchId: 'match-a', hostMemberId: 'host-member', expectedEpoch: 1});
  expect(() => save(store, state, {expectedRevision: 1})).toThrow('stale-host');
  store.close();
  store = new ProfileStore({filename}); resources.push(() => store.close());
  expect(store.getCheckpointForProfile(session.profile.id, 'match-a').state.pins[0].position).toEqual([.123, .456, -8.765]);
  expect(store.matchMetadata('match-a').hostEpoch).toBe(2);
  expect(store.authenticate(session.token)?.id).toBe(session.profile.id);
  expect(() => store.getCheckpointForProfile('unrelated', 'match-a')).toThrow('not-found');
});

test('checkpoint and result commit atomically; retries cannot duplicate history or change committed scores', async () => {
  const store = makeStore(), session = await register(store);
  createMatch(store, session.profile.id);
  const state = bowling();
  const results = [{memberId: 'player-member', score: 123, rank: 1, outcome: 'complete'}];
  expect(() => save(store, state, {results: [{...results[0], memberId: 'someone-else'}]})).toThrow('invalid-results');
  expect(store.readCheckpoint('match-a')).toBeNull();
  expect(save(store, state, {results}).revision).toBe(1);
  expect(save(store, state, {results}).duplicate).toBe(true);
  expect(store.history(session.profile.id)).toHaveLength(1);
  expect(store.history(session.profile.id)[0]).toMatchObject({score: 123, authority: 'casual-host', saved: true});
  expect(() => save(store, state, {results: [{...results[0], score: 456}]})).toThrow('revision-conflict');
});

test('guest ownership proof claims only its participant, expires, and cannot be stolen by another account', async () => {
  let now = 1;
  const store = makeStore({now: () => now}), first = await register(store), second = await register(store, 'player_two');
  const created = createMatch(store);
  save(store);
  expect(store.history(first.profile.id)).toEqual([]);
  const claim = created.guestClaims['player-member'];
  expect(store.claimGuestResult(first.profile.id, claim).claimed).toBe(true);
  expect(store.claimGuestResult(first.profile.id, claim).claimed).toBe(true);
  expect(store.history(first.profile.id)).toHaveLength(1);
  expect(() => store.claimGuestResult(second.profile.id, claim)).toThrow('invalid-claim');
  expect(() => store.claimGuestResult(second.profile.id, 'match-a')).toThrow('invalid-claim');
  now += 25 * 60 * 60 * 1000;
  expect(() => store.claimGuestResult(first.profile.id, claim)).toThrow('invalid-claim');
});

test('unstable checkpoints, missing full pin poses, raw sensor data and non-finite state cannot be stored', () => {
  const store = makeStore(); createMatch(store);
  expect(() => save(store, {...bowling(), boundary: 'rolling'})).toThrow('unstable-checkpoint');
  expect(() => save(store, {...bowling(), pins: [{id: 1, standing: true}]})).toThrow('invalid-pin');
  expect(() => save(store, {...bowling(), match: {samples: []}})).toThrow('invalid-fields');
  expect(() => save(store, {...bowling(), settings: {aim: Infinity}})).toThrow('invalid-state');
  expect(store.readCheckpoint('match-a')).toBeNull();
});

test('room adapter derives a perfect bowling result from replay, preserves private claims and rotates durable host leases', async () => {
  const store = makeStore(), session = await register(store);
  const persistence = createRoomPersistence({store});
  const context = {role: 'host', memberId: 'host-member', room: {gameId: 'adapter-game', sport: 'bowling', hostMemberId: 'host-member', hostEpoch: 7,
    players: [{memberId: 'player-member', slot: 0, name: 'Player', profileId: session.profile.id}]}};
  const initial = bowling();
  expect(persistence.save(context, {payload: initial})).toMatchObject({saved: true, revision: 1});
  const nextContext = {...context, room: {...context.room, hostEpoch: 8}};
  expect(persistence.restore(nextContext).hostEpoch).toBe(2);
  expect(() => persistence.save(context, {payload: initial})).toThrow('stale-host');
  const complete = {...initial, pins: [], match: {...initial.match, deliveries: Array.from({length: 12}, () => [])}};
  expect(persistence.save(nextContext, {payload: complete})).toMatchObject({saved: true, revision: 2});
  expect(persistence.save(nextContext, {payload: complete})).toMatchObject({duplicate: true, revision: 2});
  expect(store.history(session.profile.id)[0]).toMatchObject({score: 300, outcome: 'complete'});
  expect(() => persistence.save({...nextContext, role: 'player', memberId: 'player-member'}, {payload: complete})).toThrow('not-match-host');
});



test('solo recovery lists only the owner’s active validated boundaries and never exposes another player or completed game', async () => {
  const store = makeStore(), owner = await register(store), other = await register(store, 'other_player');
  createMatch(store, owner.profile.id); save(store);
  expect(store.recoverableMatches(owner.profile.id)).toEqual([expect.objectContaining({matchId: 'match-a', sport: 'bowling', revision: 1})]);
  expect(store.recoverySource(owner.profile.id, 'match-a')).toMatchObject({participantProfileId: owner.profile.id, participantName: 'Player', state: bowling()});
  expect(store.recoverableMatches(other.profile.id)).toEqual([]);
  expect(() => store.recoverySource(other.profile.id, 'match-a')).toThrow('not-found');
  store.createMatch({matchId: 'multi', sport: 'bowling', hostMemberId: 'host-member', participants: [
    {memberId: 'one', name: 'One', profileId: owner.profile.id}, {memberId: 'two', name: 'Two', profileId: other.profile.id}]});
  store.saveCheckpoint({matchId: 'multi', hostMemberId: 'host-member', hostEpoch: 1, expectedRevision: 0, state: bowling()});
  expect(() => store.recoverySource(owner.profile.id, 'multi')).toThrow('not-found');
  expect(store.recoverableMatches(owner.profile.id)).toHaveLength(1);
  save(store, bowling(), {expectedRevision: 1, results: [{memberId: 'player-member', score: 0, rank: 1, outcome: 'complete'}]});
  expect(store.recoverableMatches(owner.profile.id)).toEqual([]);
  expect(() => store.recoverySource(owner.profile.id, 'match-a')).toThrow('recovery-unavailable');
});

test('new rounds use distinct durable match identities instead of overwriting a completed result', async () => {
  const store = makeStore(), session = await register(store), persistence = createRoomPersistence({store});
  const context = {role: 'host', memberId: 'host-member', room: {gameId: 'rematch-game', sport: 'bowling', hostMemberId: 'host-member', hostEpoch: 1,
    matchRound: 0, players: [{memberId: 'player-member', slot: 0, name: 'Player', profileId: session.profile.id}]}};
  const complete = bowling(); complete.pins = []; complete.match.deliveries = Array.from({length: 12}, () => []);
  persistence.save(context, {payload: complete});
  persistence.save({...context, room: {...context.room, matchRound: 1}}, {payload: bowling()});
  const history = store.history(session.profile.id);
  expect(history).toHaveLength(2);
  expect(history.find(game => game.matchId === 'rematch-game:round:0')).toMatchObject({score: 300, status: 'complete'});
  expect(history.find(game => game.matchId === 'rematch-game:round:1')).toMatchObject({score: null, status: 'active'});
});

test('recovery reservations serialize competing hosts, permit same-room retries, and release only before continuation', async () => {
  const store = makeStore(), owner = await register(store), outsider = await register(store, 'outsider');
  createMatch(store, owner.profile.id); save(store);
  const source = store.readCheckpoint('match-a');
  expect(() => store.reserveRecovery(outsider.profile.id, 'match-a', 'other-host')).toThrow('not-found');
  expect(store.reserveRecovery(owner.profile.id, 'match-a', 'first-host')).toMatchObject({status: 'reserved', duplicate: false});
  expect(store.reserveRecovery(owner.profile.id, 'match-a', 'first-host')).toMatchObject({status: 'reserved', duplicate: true});
  expect(() => store.reserveRecovery(owner.profile.id, 'match-a', 'second-host')).toThrow('recovery-in-use');
  expect(store.recoverableMatches(owner.profile.id)).toEqual([]);
  expect(store.recoverySource(owner.profile.id, 'match-a').state).toEqual(source.state);
  expect(() => save(store, bowling(), {expectedRevision: 1})).toThrow('match-recovery-in-progress');
  expect(store.releaseRecovery('match-a', 'second-host')).toEqual({released: false});
  expect(store.releaseRecovery('match-a', 'first-host')).toEqual({released: true});
  expect(store.recoverableMatches(owner.profile.id)).toHaveLength(1);
  store.reserveRecovery(owner.profile.id, 'match-a', 'second-host');
  expect(store.markRecoveryContinued('match-a', 'second-host')).toEqual({continued: true});
  expect(store.markRecoveryContinued('match-a', 'second-host')).toEqual({continued: true});
  expect(store.reserveRecovery(owner.profile.id, 'match-a', 'second-host')).toMatchObject({status: 'continued', duplicate: true});
  expect(store.releaseRecovery('match-a', 'second-host')).toEqual({released: false});
  expect(() => store.reserveRecovery(owner.profile.id, 'match-a', 'third-host')).toThrow('recovery-already-continued');
  expect(store.readCheckpoint('match-a')).toEqual(source);
});

test('separate database connections enforce reservations and expired abandoned setup can be reclaimed after five minutes', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'wee-recovery-lease-'));
  resources.push(() => rmSync(directory, {recursive: true, force: true}));
  const filename = join(directory, 'profiles.sqlite');
  let now = 100;
  const first = makeStore({filename, now: () => now});
  const owner = await register(first); createMatch(first, owner.profile.id); save(first);
  const second = makeStore({filename, now: () => now});
  const reserved = first.reserveRecovery(owner.profile.id, 'match-a', 'host-a');
  expect(reserved.expiresAt).toBe(now + 5 * 60 * 1000);
  expect(() => second.reserveRecovery(owner.profile.id, 'match-a', 'host-b')).toThrow('recovery-in-use');
  now += 5 * 60 * 1000 + 1;
  expect(second.recoverableMatches(owner.profile.id)).toHaveLength(1);
  expect(second.reserveRecovery(owner.profile.id, 'match-a', 'host-b')).toMatchObject({status: 'reserved', duplicate: false});
  expect(() => first.markRecoveryContinued('match-a', 'host-a')).toThrow('recovery-claim-mismatch');
  expect(first.releaseRecovery('match-a', 'host-a')).toEqual({released: false});
  second.markRecoveryContinued('match-a', 'host-b');
  now += 24 * 60 * 60 * 1000;
  expect(first.recoverableMatches(owner.profile.id)).toEqual([]);
  expect(() => first.reserveRecovery(owner.profile.id, 'match-a', 'host-c')).toThrow('recovery-already-continued');
});

test('first continued checkpoint consumes its source atomically and failed or stale writes cannot consume it', async () => {
  const store = makeStore(), owner = await register(store);
  createMatch(store, owner.profile.id); save(store);
  store.reserveRecovery(owner.profile.id, 'match-a', 'fresh-host');
  store.createMatch({matchId: 'continued-game', sport: 'bowling', hostMemberId: 'fresh-host',
    participants: [{memberId: 'fresh-player', name: 'Player', profileId: owner.profile.id}]});
  const input = {matchId: 'continued-game', hostMemberId: 'fresh-host', hostEpoch: 1, expectedRevision: 0,
    state: bowling(), recoverySource: {matchId: 'match-a', claimId: 'fresh-host'}};
  expect(() => store.saveCheckpoint({...input, results: [{memberId: 'wrong-player', score: 0, rank: 1, outcome: 'complete'}]})).toThrow('invalid-results');
  expect(store.readCheckpoint('continued-game')).toBeNull();
  expect(store.reserveRecovery(owner.profile.id, 'match-a', 'fresh-host').status).toBe('reserved');
  expect(() => store.saveCheckpoint({...input, recoverySource: {matchId: 'match-a', claimId: 'stale-host'}})).toThrow('recovery-claim-mismatch');
  expect(store.readCheckpoint('continued-game')).toBeNull();
  expect(store.saveCheckpoint(input)).toMatchObject({saved: true, revision: 1});
  expect(store.reserveRecovery(owner.profile.id, 'match-a', 'fresh-host').status).toBe('continued');
  expect(store.releaseRecovery('match-a', 'fresh-host')).toEqual({released: false});
  expect(store.saveCheckpoint(input)).toMatchObject({duplicate: true, revision: 1});
  expect(store.readCheckpoint('match-a').state).toEqual(bowling());
});

test('HTTP profile API rejects cross-origin/unauthenticated access and supports cookies plus native bearer sessions', async () => {
  const service = createProfileService({store: makeStore()});
  const server = createServer((req, res) => service.handle(req, res));
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  resources.push(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const call = (path = '', options = {}) => fetch(origin + '/api/profile' + path, options);
  expect((await call()).status).toBe(401);
  expect((await call('/register', {method: 'POST', headers: {'content-type': 'application/json', origin: 'https://evil.example'}, body: '{}'})).status).toBe(403);
  const response = await call('/register', {method: 'POST', headers: {'content-type': 'application/json', origin},
    body: JSON.stringify({username: 'http_player', password: 'a long personal password', displayName: 'Player'})});
  expect(response.status).toBe(201);
  expect(response.headers.get('set-cookie')).toContain('HttpOnly; SameSite=Strict; Path=/');
  const cookie = response.headers.get('set-cookie').split(';')[0];
  expect(await response.json()).not.toHaveProperty('token');
  expect((await call('', {headers: {cookie}})).status).toBe(200);
  expect((await call('', {method: 'PATCH', headers: {cookie, 'content-type': 'application/json', origin}, body: JSON.stringify({revision: 1, profileId: 'victim'})})).status).toBe(400);
  const native = await call('/login', {method: 'POST', headers: {'content-type': 'application/json', 'x-wee-client': 'native'},
    body: JSON.stringify({username: 'http_player', password: 'a long personal password'})});
  const session = await native.json(); expect(session.token).toHaveLength(43);
  const headers = {authorization: `Bearer ${session.token}`};
  expect((await call('/history', {headers})).status).toBe(200);
  expect((await call('/logout', {method: 'POST', headers})).status).toBe(200);
  expect((await call('/history', {headers})).status).toBe(401);
  expect((await call('/results', {method: 'POST', headers: {cookie, origin}, body: '{}'})).status).toBe(404);
});
