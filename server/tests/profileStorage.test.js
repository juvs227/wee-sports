import {afterEach, expect, test} from 'vitest';
import {chmodSync, copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {ProfileStore} from '@server/profiles/store.js';
import {copyProfileDatabase} from '@server/profiles/backup.js';

const resources = [];
afterEach(() => { for (const cleanup of resources.splice(0).reverse()) cleanup(); });
const directory = () => { const path = mkdtempSync(join(tmpdir(), 'wee-storage-')); resources.push(() => rmSync(path, {recursive: true, force: true})); return path; };
const open = filename => { const store = new ProfileStore({filename}); resources.push(() => { if (store.db.isOpen) store.close(); }); return store; };
const register = store => store.register({username: 'storage_owner', displayName: 'Owner', password: 'a disposable password'});
const boundary = () => ({version: 1, boundary: 'settled', match: {version: 1, players: [{player: 1, name: 'Owner'}], deliveries: []},
  pins: Array.from({length: 10}, (_, i) => ({id: i + 1, position: [i * .1, .4, -9], quaternion: [0, 0, 0, 1], standing: true})), settings: {aim: 0}});

test('failed session insertion rolls registration back and the same username can retry', async () => {
  const store = open(':memory:');
  store.db.exec("CREATE TRIGGER fail_session BEFORE INSERT ON sessions BEGIN SELECT RAISE(ABORT, 'simulated-write-failure'); END;");
  await expect(register(store)).rejects.toThrow('simulated-write-failure');
  expect(store.db.prepare('SELECT count(*) AS count FROM profiles').get().count).toBe(0);
  expect(store.db.prepare('SELECT count(*) AS count FROM sessions').get().count).toBe(0);
  store.db.exec('DROP TRIGGER fail_session');
  const session = await register(store);
  expect(store.authenticate(session.token)?.id).toBe(session.profile.id);
});

test('a competing connection cannot make a stale profile update report success', async () => {
  const filename = join(directory(), 'profiles.sqlite');
  const first = open(filename), second = open(filename), account = await register(first);
  const read = first.getProfile.bind(first);
  let raced = false;
  first.getProfile = id => {
    const snapshot = read(id);
    // A second process commits after this request reads its revision.
    if (!raced) { raced = true; second.updateProfile(id, {revision: 1, displayName: 'Other writer'}); }
    return snapshot;
  };
  expect(() => first.updateProfile(account.profile.id, {revision: 1, displayName: 'Stale writer'})).toThrow('revision-conflict');
  expect(second.getProfile(account.profile.id)).toMatchObject({revision: 2, displayName: 'Other writer'});
});

test('existing unversioned databases gain an additive version marker without losing accounts', async () => {
  const filename = join(directory(), 'profiles.sqlite');
  const original = open(filename), account = await register(original);
  original.db.exec('DROP TABLE recovery_claims; PRAGMA user_version=0;');
  original.close();
  const upgraded = open(filename);
  expect(upgraded.db.prepare('PRAGMA user_version').get().user_version).toBe(1);
  expect(upgraded.authenticate(account.token)?.id).toBe(account.profile.id);
  expect(upgraded.recoverableMatches(account.profile.id)).toEqual([]);
});

test.each(['future', 'partial', 'corrupt', 'foreign-key'])('opening a %s database fails without resetting its contents', kind => {
  const filename = join(directory(), 'profiles.sqlite');
  if (kind === 'corrupt') writeFileSync(filename, 'damaged SQLite header', {mode: 0o600});
  else if (kind === 'partial') {
    const db = new DatabaseSync(filename); db.exec('CREATE TABLE profiles(id TEXT)'); db.close();
  } else {
    const store = open(filename);
    if (kind === 'future') store.db.exec('PRAGMA user_version=2;');
    else store.db.exec("PRAGMA foreign_keys=OFF; INSERT INTO sessions VALUES('invalid','missing-profile',123);");
    store.close();
  }
  const original = readFileSync(filename);
  expect(() => new ProfileStore({filename})).toThrow();
  expect(readFileSync(filename)).toEqual(original);
});

test.skipIf(process.getuid?.() === 0)('unwritable directories fail safely and DB/WAL files remain private', () => {
  const parent = directory(), filename = join(parent, 'profiles.sqlite'), store = open(filename);
  expect(statSync(filename).mode & 0o777).toBe(0o600);
  for (const suffix of ['-wal', '-shm']) expect(statSync(filename + suffix).mode & 0o777).toBe(0o600);
  store.close();
  const original = readFileSync(filename);
  chmodSync(parent, 0o500);
  try { expect(() => new ProfileStore({filename})).toThrow(); }
  finally { chmodSync(parent, 0o700); }
  expect(readFileSync(filename)).toEqual(original);
});

test('online backup captures committed WAL and CLI restore preserves sessions, history and stable recovery across reopen', async () => {
  const parent = directory(), filename = join(parent, 'live.sqlite'), snapshot = join(parent, 'backup.sqlite'), restored = join(parent, 'restored.sqlite');
  const live = open(filename), account = await register(live), state = boundary();
  live.db.exec('PRAGMA wal_autocheckpoint=0;');
  for (const matchId of ['active-game', 'completed-game']) {
    live.createMatch({matchId, sport: 'bowling', hostMemberId: 'host', participants: [{memberId: 'player', name: 'Owner', profileId: account.profile.id}]});
    live.saveCheckpoint({matchId, hostMemberId: 'host', hostEpoch: 1, expectedRevision: 0,
      state: matchId === 'completed-game' ? {...state, pins: [], match: {...state.match, deliveries: Array.from({length: 12}, () => [])}} : state,
      ...(matchId === 'completed-game' ? {results: [{memberId: 'player', score: 300, rank: 1, outcome: 'complete'}]} : {})});
  }
  expect(statSync(filename + '-wal').size).toBeGreaterThan(0);
  // Prove this fixture has committed data beyond the main database file.
  const unsafe = join(parent, 'main-file-only.sqlite'); copyFileSync(filename, unsafe);
  const raw = new DatabaseSync(unsafe, {readOnly: true});
  try { expect(() => raw.prepare('SELECT id FROM profiles').all()).toThrow(); }
  finally { raw.close(); }
  expect(await copyProfileDatabase(filename, snapshot)).toMatchObject({schemaVersion: 1});
  expect(statSync(snapshot).mode & 0o777).toBe(0o600);
  live.updateProfile(account.profile.id, {revision: 1, displayName: 'After snapshot'});
  live.close();
  const output = execFileSync(process.execPath, [resolve('server/scripts/profile-db.js'), 'restore', snapshot, restored], {encoding: 'utf8'});
  expect(JSON.parse(output)).toMatchObject({operation: 'restore', schemaVersion: 1});
  let recovered = open(restored);
  expect(recovered.authenticate(account.token)).toMatchObject({id: account.profile.id, displayName: 'Owner'});
  expect(recovered.history(account.profile.id)).toHaveLength(2);
  expect(recovered.history(account.profile.id).find(match => match.matchId === 'completed-game')).toMatchObject({score: 300, saved: true});
  expect(recovered.recoverableMatches(account.profile.id).map(match => match.matchId)).toEqual(['active-game']);
  expect(recovered.recoverySource(account.profile.id, 'active-game').state).toEqual(state);
  recovered.updateProfile(account.profile.id, {revision: 1, displayName: 'After restore'});
  recovered.close(); recovered = open(restored);
  expect(recovered.authenticate(account.token)?.displayName).toBe('After restore');
});

test('backup and restore refuse existing targets, stale WAL files, missing sources and damaged input', async () => {
  const parent = directory(), filename = join(parent, 'source.sqlite'), target = join(parent, 'target.sqlite');
  open(filename);
  writeFileSync(target, 'retain this');
  await expect(copyProfileDatabase(filename, target)).rejects.toThrow('destination-already-exists');
  expect(readFileSync(target, 'utf8')).toBe('retain this');
  rmSync(target); writeFileSync(target + '-wal', 'old WAL');
  await expect(copyProfileDatabase(filename, target)).rejects.toThrow('destination-already-exists');
  rmSync(target + '-wal');
  await expect(copyProfileDatabase(join(parent, 'missing.sqlite'), target)).rejects.toThrow();
  const corrupt = join(parent, 'corrupt.sqlite'); writeFileSync(corrupt, 'not SQLite');
  await expect(copyProfileDatabase(corrupt, target)).rejects.toThrow();
  expect(existsSync(target)).toBe(false);
  expect(readFileSync(corrupt, 'utf8')).toBe('not SQLite');
});
