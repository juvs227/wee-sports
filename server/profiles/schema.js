export const PROFILE_SCHEMA_VERSION = 1;

const columns = {
  profiles: ['id', 'username', 'display_name', 'salt', 'password_hash', 'avatar', 'preferences', 'revision', 'created_at'],
  sessions: ['token_hash', 'profile_id', 'expires_at'],
  matches: ['id', 'sport', 'host_member_id', 'host_epoch', 'revision', 'config', 'status', 'created_at'],
  participants: ['match_id', 'member_id', 'profile_id', 'name', 'claim_hash', 'claim_expires'],
  checkpoints: ['match_id', 'revision', 'host_epoch', 'payload', 'committed_at'],
  recovery_claims: ['source_id', 'claim_id', 'status', 'expires_at'],
  results: ['match_id', 'member_id', 'score', 'rank', 'outcome', 'committed_at'],
};

/** Inspect before any DDL. Version zero is the existing, unversioned schema. */
export function checkProfileSchema(db, {allowEmpty = false} = {}) {
  const version = db.prepare('PRAGMA user_version').get().user_version;
  if (![0, PROFILE_SCHEMA_VERSION].includes(version)) throw new Error('unsupported-profile-schema');
  const tables = db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(row => row.name);
  if (allowEmpty && version === 0 && tables.length === 0) return version;
  if (tables.some(name => !Object.hasOwn(columns, name))) throw new Error('incompatible-profile-schema');
  for (const [name, expected] of Object.entries(columns)) {
    // Recovery reservations were an additive feature of the unversioned store.
    if (version === 0 && name === 'recovery_claims' && !tables.includes(name)) continue;
    const actual = db.prepare(`PRAGMA table_info(${name})`).all().map(row => row.name);
    if (actual.length !== expected.length || actual.some((column, i) => column !== expected[i])) {
      throw new Error('incompatible-profile-schema');
    }
  }
  return version;
}

export function checkProfileIntegrity(db) {
  const check = db.prepare('PRAGMA quick_check(1)').get();
  if (check?.quick_check !== 'ok' || db.prepare('PRAGMA foreign_key_check').get()) {
    throw new Error('damaged-profile-database');
  }
}
