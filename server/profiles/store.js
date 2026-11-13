import {DatabaseSync} from 'node:sqlite';
import {randomBytes, randomUUID, createHash, scrypt as rawScrypt, timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
import {dirname} from 'node:path';
import {mkdirSync, chmodSync} from 'node:fs';
import {BowlingMatch} from '../../src/bowling/match.ts';

import {playerCapacity} from '../../shared/protocol.js';
import {DEFAULT_PREFERENCES, boundedJson, checkpoint, fail, identifier, keys, preferences, text} from './validation.js';
import {PROFILE_SCHEMA_VERSION, checkProfileIntegrity, checkProfileSchema} from './schema.js';

const scrypt = promisify(rawScrypt);
const digest = value => createHash('sha256').update(value).digest('hex');
const token = () => randomBytes(32).toString('base64url');
const SESSION_MS = 7 * 24 * 60 * 60 * 1000;
const CLAIM_MS = 24 * 60 * 60 * 1000;
const RECOVERY_RESERVATION_MS = 5 * 60 * 1000;
const passwordOptions = {N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024};
const safeProfile = row => row ? {id: row.id, username: row.username, displayName: row.display_name,
  avatar: row.avatar, preferences: JSON.parse(row.preferences), revision: row.revision, createdAt: row.created_at} : null;

/** Local, single-instance persistence. Live-room code is the only match writer. */
export class ProfileStore {
  constructor({filename = ':memory:', now = Date.now} = {}) {
    this.now = now;
    if (filename !== ':memory:') mkdirSync(dirname(filename), {recursive: true, mode: 0o700});
    this.db = new DatabaseSync(filename);
    try {
      checkProfileSchema(this.db, {allowEmpty: true});
      checkProfileIntegrity(this.db);
      if (filename !== ':memory:') chmodSync(filename, 0o600);
      this.db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
      this.transaction(() => {
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS profiles (
        id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, display_name TEXT NOT NULL,
        salt TEXT NOT NULL, password_hash TEXT NOT NULL, avatar TEXT NOT NULL DEFAULT 'ball',
        preferences TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY, profile_id TEXT NOT NULL REFERENCES profiles(id), expires_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS matches (
        id TEXT PRIMARY KEY, sport TEXT NOT NULL, host_member_id TEXT NOT NULL,
        host_epoch INTEGER NOT NULL DEFAULT 1, revision INTEGER NOT NULL DEFAULT 0,
        config TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS participants (
        match_id TEXT NOT NULL REFERENCES matches(id), member_id TEXT NOT NULL,
        profile_id TEXT REFERENCES profiles(id), name TEXT NOT NULL, claim_hash TEXT,
        claim_expires INTEGER, PRIMARY KEY(match_id, member_id)
      );
      CREATE TABLE IF NOT EXISTS checkpoints (
        match_id TEXT PRIMARY KEY REFERENCES matches(id), revision INTEGER NOT NULL,
        host_epoch INTEGER NOT NULL, payload TEXT NOT NULL, committed_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS recovery_claims (
        source_id TEXT PRIMARY KEY REFERENCES matches(id), claim_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('reserved','continued')), expires_at INTEGER,
        CHECK((status='reserved' AND expires_at IS NOT NULL) OR (status='continued' AND expires_at IS NULL))
      );
      CREATE TABLE IF NOT EXISTS results (
        match_id TEXT NOT NULL, member_id TEXT NOT NULL, score REAL NOT NULL,
        rank INTEGER NOT NULL, outcome TEXT NOT NULL, committed_at INTEGER NOT NULL,
        PRIMARY KEY(match_id, member_id), FOREIGN KEY(match_id,member_id) REFERENCES participants(match_id,member_id)
      );
      CREATE INDEX IF NOT EXISTS participants_profile ON participants(profile_id);`);
        checkProfileSchema(this.db);
        this.db.exec(`PRAGMA user_version=${PROFILE_SCHEMA_VERSION}`);
      });
    } catch (error) {
      this.db.close();
      throw error;
    }
  }

  close() { this.db.close(); }
  transaction(operation) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const value = operation(); this.db.exec('COMMIT'); return value; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }

  async register(input) {
    keys(input, ['username', 'password', 'displayName']);
    if (typeof input.username !== 'string' || !/^[a-zA-Z0-9_-]{3,32}$/.test(input.username)) fail('invalid-username');
    if (typeof input.password !== 'string' || input.password.length < 12 || input.password.length > 128) fail('password-length');
    const username = input.username.toLowerCase(), displayName = text(input.displayName);
    const salt = randomBytes(16).toString('hex');
    const passwordHash = (await scrypt(input.password, salt, 32, passwordOptions)).toString('hex');
    const id = randomUUID();
    try {
      return this.transaction(() => {
        this.db.prepare('INSERT INTO profiles(id,username,display_name,salt,password_hash,preferences,created_at) VALUES(?,?,?,?,?,?,?)')
          .run(id, username, displayName, salt, passwordHash, JSON.stringify(DEFAULT_PREFERENCES), this.now());
        return this.issueSession(id);
      });
    } catch (error) {
      if (error.code === 'ERR_SQLITE_ERROR' && /UNIQUE constraint/.test(error.message)) fail('username-taken', 409);
      throw error;
    }
  }

  async login(input) {
    keys(input, ['username', 'password']);
    if (typeof input.username !== 'string' || typeof input.password !== 'string' || input.password.length > 128 || input.username.length > 32) fail('invalid-login', 401);
    const row = this.db.prepare('SELECT * FROM profiles WHERE username=?').get(input.username.toLowerCase());
    // Unknown users still perform the password KDF to reduce timing disclosure.
    const candidate = await scrypt(input.password, row?.salt || '00000000000000000000000000000000', 32, passwordOptions);
    const expected = row ? Buffer.from(row.password_hash, 'hex') : Buffer.alloc(32);
    if (!timingSafeEqual(candidate, expected) || !row) fail('invalid-login', 401);
    return this.issueSession(row.id);
  }

  issueSession(profileId) {
    const value = token();
    this.db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(this.now());
    this.db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(digest(value), profileId, this.now() + SESSION_MS);
    return {token: value, profile: this.getProfile(profileId)};
  }
  authenticate(value) {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value)) return null;
    return safeProfile(this.db.prepare('SELECT p.* FROM profiles p JOIN sessions s ON p.id=s.profile_id WHERE s.token_hash=? AND s.expires_at>?')
      .get(digest(value), this.now()));
  }
  logout(value) { if (typeof value === 'string') this.db.prepare('DELETE FROM sessions WHERE token_hash=?').run(digest(value)); }
  getProfile(id) { return safeProfile(this.db.prepare('SELECT * FROM profiles WHERE id=?').get(id)); }
  updateProfile(id, input) {
    keys(input, ['displayName', 'avatar', 'preferences', 'revision']);
    const current = this.getProfile(id);
    if (!current) fail('not-signed-in', 401);
    if (input.revision !== current.revision) fail('revision-conflict', 409);
    const displayName = input.displayName === undefined ? current.displayName : text(input.displayName);
    const avatar = input.avatar === undefined ? current.avatar : input.avatar;
    if (!['ball', 'pin', 'racket', 'star'].includes(avatar)) fail('invalid-avatar');
    const prefs = input.preferences === undefined ? current.preferences : preferences(input.preferences);
    const result = this.db.prepare('UPDATE profiles SET display_name=?,avatar=?,preferences=?,revision=revision+1 WHERE id=? AND revision=?')
      .run(displayName, avatar, JSON.stringify(prefs), id, current.revision);
    if (result.changes !== 1) fail('revision-conflict', 409);
    return this.getProfile(id);
  }

  /** Trusted room service supplies profile IDs after authenticating each member. */
  createMatch({matchId, sport, hostMemberId, participants, config = {rulesVersion: 1, physicsVersion: 1, checkpointVersion: 1}}) {
    identifier(matchId); identifier(hostMemberId);
    if (!playerCapacity(sport) || !Array.isArray(participants) || participants.length < 1 || participants.length > playerCapacity(sport)) fail('invalid-match');
    const seen = new Set();
    const members = participants.map(member => {
      keys(member, ['memberId', 'profileId', 'name']); identifier(member.memberId);
      if (seen.has(member.memberId)) fail('invalid-participant'); seen.add(member.memberId);
      if (member.profileId != null && !this.getProfile(member.profileId)) fail('invalid-profile');
      return {...member, name: text(member.name)};
    });
    keys(config, ['rulesVersion', 'physicsVersion', 'checkpointVersion', 'assistance']);
    const serialized = boundedJson(config, 2048);
    return this.transaction(() => {
      if (this.db.prepare('SELECT id FROM matches WHERE id=?').get(matchId)) fail('match-exists', 409);
      this.db.prepare('INSERT INTO matches(id,sport,host_member_id,config,created_at) VALUES(?,?,?,?,?)')
        .run(matchId, sport, hostMemberId, serialized, this.now());
      const guestClaims = {};
      for (const member of members) {
        const claim = member.profileId ? null : token();
        this.db.prepare('INSERT INTO participants VALUES(?,?,?,?,?,?)').run(matchId, member.memberId, member.profileId ?? null,
          member.name, claim ? digest(claim) : null, claim ? this.now() + CLAIM_MS : null);
        if (claim) guestClaims[member.memberId] = claim;
      }
      return {matchId, hostEpoch: 1, revision: 0, guestClaims};
    });
  }

  /** Atomic CAS: the current host commits score/results and the same boundary. */
  saveCheckpoint({matchId, hostMemberId, hostEpoch, expectedRevision, state, results, recoverySource}) {
    return this.transaction(() => {
      const match = this.db.prepare('SELECT * FROM matches WHERE id=?').get(matchId);
      if (!match || match.host_member_id !== hostMemberId) fail('not-match-host', 403);
      if (match.host_epoch !== hostEpoch) fail('stale-host', 409);
      this.clearExpiredRecovery(matchId);
      if (this.db.prepare('SELECT 1 FROM recovery_claims WHERE source_id=?').get(matchId)) fail('match-recovery-in-progress', 409);
      if (recoverySource) {
        keys(recoverySource, ['matchId', 'claimId']);
        identifier(recoverySource.matchId); identifier(recoverySource.claimId);
        if (recoverySource.matchId === matchId) fail('invalid-recovery-source');
        this.assertRecoveryClaim(recoverySource.matchId, recoverySource.claimId);
      }
      const payload = checkpoint(match.sport, state);
      if (match.revision !== expectedRevision) {
        // Retrying a committed boundary is safe; it must match both state and results.
        const previous = this.db.prepare('SELECT * FROM checkpoints WHERE match_id=?').get(matchId);
        if (match.revision === expectedRevision + 1 && previous?.payload === payload && this.sameResults(matchId, results)) {
          if (recoverySource) this.continueRecovery(recoverySource.matchId, recoverySource.claimId);
          return {revision: match.revision, hostEpoch, saved: true, duplicate: true};
        }
        fail('revision-conflict', 409);
      }
      if (match.status === 'complete') fail('match-complete', 409);
      if (results !== undefined) this.validateAndSaveResults(matchId, results);
      const revision = match.revision + 1;
      this.db.prepare('INSERT INTO checkpoints VALUES(?,?,?,?,?) ON CONFLICT(match_id) DO UPDATE SET revision=excluded.revision,host_epoch=excluded.host_epoch,payload=excluded.payload,committed_at=excluded.committed_at')
        .run(matchId, revision, hostEpoch, payload, this.now());
      this.db.prepare('UPDATE matches SET revision=?,status=? WHERE id=?').run(revision, results ? 'complete' : 'active', matchId);
      if (recoverySource) this.continueRecovery(recoverySource.matchId, recoverySource.claimId);
      return {revision, hostEpoch, saved: true, duplicate: false};
    });
  }

  validateAndSaveResults(matchId, results) {
    const members = this.db.prepare('SELECT member_id FROM participants WHERE match_id=?').all(matchId);
    if (!Array.isArray(results) || results.length !== members.length || new Set(results.map(r => r.memberId)).size !== members.length) fail('invalid-results');
    for (const result of results) {
      keys(result, ['memberId', 'score', 'rank', 'outcome']);
      if (!members.some(m => m.member_id === result.memberId) || !Number.isFinite(result.score) || result.score < 0 || result.score > 10000 ||
          !Number.isInteger(result.rank) || result.rank < 1 || result.rank > Math.max(2, members.length) || !['win', 'loss', 'tie', 'complete'].includes(result.outcome)) fail('invalid-results');
      this.db.prepare('INSERT INTO results VALUES(?,?,?,?,?,?)').run(matchId, result.memberId, result.score, result.rank, result.outcome, this.now());
    }
  }
  sameResults(matchId, results) {
    const saved = this.db.prepare('SELECT member_id AS memberId,score,rank,outcome FROM results WHERE match_id=? ORDER BY member_id').all(matchId);
    if (results === undefined) return saved.length === 0;
    if (!Array.isArray(results) || results.length !== saved.length) return false;
    return saved.every(row => results.some(value => value.memberId === row.memberId && value.score === row.score && value.rank === row.rank && value.outcome === row.outcome && Object.keys(value).length === 4));
  }

  /** Called only after the room authenticates the host's private membership. */
  claimHost({matchId, hostMemberId, expectedEpoch}) {
    return this.transaction(() => {
      const match = this.db.prepare('SELECT * FROM matches WHERE id=?').get(matchId);
      if (!match || match.host_member_id !== hostMemberId) fail('not-match-host', 403);
      if (match.host_epoch !== expectedEpoch) fail('stale-host', 409);
      this.db.prepare('UPDATE matches SET host_epoch=host_epoch+1 WHERE id=?').run(matchId);
      return {hostEpoch: match.host_epoch + 1, revision: match.revision, checkpoint: this.readCheckpoint(matchId)};
    });
  }
  readCheckpoint(matchId) {
    const row = this.db.prepare('SELECT * FROM checkpoints WHERE match_id=?').get(matchId);
    return row ? {revision: row.revision, hostEpoch: row.host_epoch, state: JSON.parse(row.payload), committedAt: row.committed_at, recovery: 'last-saved-boundary'} : null;
  }
  getCheckpointForProfile(profileId, matchId) {
    if (!this.db.prepare('SELECT 1 FROM participants WHERE match_id=? AND profile_id=?').get(matchId, profileId)) fail('not-found', 404);
    return this.readCheckpoint(matchId);
  }
  recoverySource(profileId, matchId) {
    const row = this.db.prepare(`SELECT m.sport,m.status,p.name,p.profile_id,c.payload,c.revision,c.committed_at
      FROM matches m JOIN participants p ON p.match_id=m.id JOIN checkpoints c ON c.match_id=m.id
      WHERE m.id=? AND p.profile_id=? AND (SELECT COUNT(*) FROM participants WHERE match_id=m.id)=1`).get(matchId, profileId);
    if (!row) fail('not-found', 404);
    if (row.status !== 'active') fail('recovery-unavailable', 409);
    const state = JSON.parse(row.payload);
    try {
      checkpoint(row.sport, state);
      if (row.sport === 'bowling') {
        const match = BowlingMatch.fromCheckpoint(state.match).getState();
        if (match.complete || match.players.length !== 1 || match.players[0].player !== 1 ||
            match.pinsStanding.length !== state.pins.length || state.pins.some(pin => !pin.standing || !match.pinsStanding.includes(pin.id))) fail('recovery-unavailable', 409);
      } else fail('recovery-unavailable', 409);
    } catch { fail('recovery-unavailable', 409); }
    return {sport: row.sport, state, participantProfileId: row.profile_id, participantName: row.name,
      revision: row.revision, savedAt: row.committed_at};
  }
  recoverableMatches(profileId) {
    const rows = this.db.prepare(`SELECT m.id FROM matches m JOIN participants p ON p.match_id=m.id
      JOIN checkpoints c ON c.match_id=m.id WHERE p.profile_id=? AND m.status='active'
      AND (SELECT COUNT(*) FROM participants WHERE match_id=m.id)=1
      AND NOT EXISTS(SELECT 1 FROM recovery_claims r WHERE r.source_id=m.id AND (r.status='continued' OR r.expires_at>?))
      ORDER BY c.committed_at DESC LIMIT 50`).all(profileId, this.now());
    return rows.flatMap(row => {
      try {
        const source = this.recoverySource(profileId, row.id);
        return [{matchId: row.id, sport: source.sport, playerName: source.participantName,
          savedAt: source.savedAt, revision: source.revision}];
      } catch { return []; }
    });
  }
  /** A crashed pre-game reservation becomes available again after five minutes. */
  clearExpiredRecovery(matchId) {
    this.db.prepare("DELETE FROM recovery_claims WHERE source_id=? AND status='reserved' AND expires_at<=?").run(matchId, this.now());
  }
  assertRecoveryClaim(matchId, claimId) {
    this.clearExpiredRecovery(matchId);
    const claim = this.db.prepare('SELECT * FROM recovery_claims WHERE source_id=?').get(matchId);
    if (!claim || claim.claim_id !== claimId) fail('recovery-claim-mismatch', 409);
    return claim;
  }
  reserveRecovery(profileId, matchId, claimId) {
    identifier(matchId); identifier(claimId);
    return this.transaction(() => {
      this.recoverySource(profileId, matchId);
      this.clearExpiredRecovery(matchId);
      const existing = this.db.prepare('SELECT * FROM recovery_claims WHERE source_id=?').get(matchId);
      if (existing && existing.claim_id !== claimId) fail(existing.status === 'continued' ? 'recovery-already-continued' : 'recovery-in-use', 409);
      if (existing?.status === 'continued') return {matchId, claimId, status: 'continued', duplicate: true, expiresAt: null};
      const expiresAt = this.now() + RECOVERY_RESERVATION_MS;
      this.db.prepare("INSERT INTO recovery_claims VALUES(?,?,'reserved',?) ON CONFLICT(source_id) DO UPDATE SET expires_at=excluded.expires_at")
        .run(matchId, claimId, expiresAt);
      return {matchId, claimId, status: 'reserved', duplicate: Boolean(existing), expiresAt};
    });
  }
  releaseRecovery(matchId, claimId) {
    identifier(matchId); identifier(claimId);
    const result = this.db.prepare("DELETE FROM recovery_claims WHERE source_id=? AND claim_id=? AND status='reserved'").run(matchId, claimId);
    return {released: result.changes === 1};
  }
  // Transaction-internal helper: checkpoint commit and source consumption share
  // one transaction, so a crash cannot leave two durable continuations possible.
  continueRecovery(matchId, claimId) {
    this.assertRecoveryClaim(matchId, claimId);
    this.db.prepare("UPDATE recovery_claims SET status='continued',expires_at=NULL WHERE source_id=? AND claim_id=?").run(matchId, claimId);
    return {continued: true};
  }
  markRecoveryContinued(matchId, claimId) {
    identifier(matchId); identifier(claimId);
    return this.transaction(() => this.continueRecovery(matchId, claimId));
  }
  matchMetadata(matchId) {
    const row = this.db.prepare('SELECT id,sport,host_member_id,host_epoch,revision,status FROM matches WHERE id=?').get(matchId);
    return row ? {matchId: row.id, sport: row.sport, hostMemberId: row.host_member_id, hostEpoch: row.host_epoch,
      revision: row.revision, status: row.status} : null;
  }
  /** Private room membership, not a public match ID, authorizes issuance. */
  issueGuestClaim(matchId, memberId) {
    const member = this.db.prepare('SELECT profile_id FROM participants WHERE match_id=? AND member_id=?').get(matchId, memberId);
    if (!member || member.profile_id) return null;
    const claim = token();
    this.db.prepare('UPDATE participants SET claim_hash=?,claim_expires=? WHERE match_id=? AND member_id=?')
      .run(digest(claim), this.now() + CLAIM_MS, matchId, memberId);
    return claim;
  }
  claimGuestResult(profileId, value) {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value)) fail('invalid-claim', 403);
    return this.transaction(() => {
      const member = this.db.prepare('SELECT * FROM participants WHERE claim_hash=?').get(digest(value));
      if (!member || member.claim_expires <= this.now() || (member.profile_id && member.profile_id !== profileId)) fail('invalid-claim', 403);
      this.db.prepare('UPDATE participants SET profile_id=? WHERE match_id=? AND member_id=?').run(profileId, member.match_id, member.member_id);
      return {claimed: true, matchId: member.match_id};
    });
  }
  history(profileId) {
    return this.db.prepare(`SELECT m.id AS matchId,m.sport,m.status,m.config,m.created_at AS startedAt,
      p.name AS playerName,r.score,r.rank,r.outcome,r.committed_at AS savedAt,
      c.revision AS savedRevision,rc.status AS continuationStatus,rc.expires_at AS reservationExpiresAt
      FROM participants p JOIN matches m ON m.id=p.match_id
      LEFT JOIN results r ON r.match_id=p.match_id AND r.member_id=p.member_id
      LEFT JOIN checkpoints c ON c.match_id=m.id LEFT JOIN recovery_claims rc ON rc.source_id=m.id
      WHERE p.profile_id=? ORDER BY m.created_at DESC LIMIT 50`)
      .all(profileId).map(({continuationStatus, reservationExpiresAt, ...row}) => ({...row, config: JSON.parse(row.config),
        recoveryStatus: continuationStatus === 'reserved' && reservationExpiresAt <= this.now() ? null : continuationStatus,
        authority: 'casual-host', saved: row.savedRevision !== null,
        recovery: row.savedRevision !== null ? 'last-saved-boundary' : 'unavailable'}));
  }
}
