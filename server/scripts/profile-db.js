import {copyProfileDatabase} from '../profiles/backup.js';

const [operation, source, destination, ...extra] = process.argv.slice(2);
if (!['backup', 'restore'].includes(operation) || !source || !destination || extra.length) {
  console.error('Usage: node server/scripts/profile-db.js <backup|restore> SOURCE NEW_DESTINATION');
  console.error('Restore only while the service is stopped; select the new path with WEE_PROFILE_DB. Existing files are never overwritten.');
  process.exitCode = 1;
} else {
  try {
    const result = await copyProfileDatabase(source, destination);
    console.log(JSON.stringify({operation, ...result}));
  } catch (error) {
    // Do not expose filesystem paths, SQLite SQL, or account data in diagnostics.
    const known = ['database-path-required', 'destination-already-exists', 'source-is-not-file', 'unsupported-profile-schema', 'incompatible-profile-schema', 'damaged-profile-database'];
    console.error(known.includes(error.message) ? error.message : 'profile-database-copy-failed');
    process.exitCode = 1;
  }
}
