import {backup, DatabaseSync} from 'node:sqlite';
import {chmodSync, existsSync, fsyncSync, linkSync, mkdirSync, mkdtempSync, openSync, closeSync, rmSync, statSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {checkProfileIntegrity, checkProfileSchema} from './schema.js';

function sync(path) {
  const descriptor = openSync(path, 'r');
  try { fsyncSync(descriptor); }
  finally { closeSync(descriptor); }
}

/** SQLite's online backup includes committed WAL pages in a consistent copy.
 * Publish only a validated, private file; existing destinations are never replaced.
 * Restoring uses the same operation into a new path while the service is stopped.
 */
export async function copyProfileDatabase(source, destination) {
  if (!source || !destination || source === ':memory:' || destination === ':memory:') throw new Error('database-path-required');
  const from = resolve(source), to = resolve(destination);
  if (from === to || ['', '-wal', '-shm', '-journal'].some(suffix => existsSync(to + suffix))) throw new Error('destination-already-exists');
  if (!statSync(from).isFile()) throw new Error('source-is-not-file');
  const db = new DatabaseSync(from, {readOnly: true});
  let temporary;
  try {
    checkProfileSchema(db);
    checkProfileIntegrity(db);
    mkdirSync(dirname(to), {recursive: true, mode: 0o700});
    temporary = mkdtempSync(join(dirname(to), '.wee-profile-copy-'));
    const snapshot = join(temporary, 'snapshot.sqlite');
    closeSync(openSync(snapshot, 'wx', 0o600));
    await backup(db, snapshot);
    chmodSync(snapshot, 0o600);
    const check = new DatabaseSync(snapshot, {readOnly: true});
    let schemaVersion;
    try {
      schemaVersion = checkProfileSchema(check);
      checkProfileIntegrity(check);
    } finally { check.close(); }
    sync(snapshot);
    // A hard link publishes atomically without the overwrite race of rename.
    linkSync(snapshot, to);
    sync(dirname(to));
    return {schemaVersion, bytes: statSync(to).size};
  } finally {
    db.close();
    if (temporary) rmSync(temporary, {recursive: true, force: true});
  }
}
