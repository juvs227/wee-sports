import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir, writeFile} from 'node:fs/promises';
import {dirname, extname, resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {io} from 'socket.io-client';
import {EVENTS, PROTOCOL_VERSION} from '../shared/protocol.js';

// Local-only smoke: inspect an existing image, pin its ID, never build or pull.
// Every resource is uniquely named and only those names are removed on exit.
const options = {image: 'wee-sports-readiness:local', report: '/tmp/wee-container-report.json'};
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i]?.replace(/^--/, '');
  if (!Object.hasOwn(options, key) || !process.argv[i + 1]) throw new Error('Usage: node scripts/verify-production-container.mjs [--image LOCAL_IMAGE] [--report NEW_REPORT.json]');
  options[key] = process.argv[i + 1];
}
const exec = promisify(execFile);
const environment = {...process.env};
for (const name of ['DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_TLS', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH']) delete environment[name];
const cancellation = new AbortController();
let cleaningUp = false;
const interrupt = () => { cancellation.abort(); };
process.on('SIGINT', interrupt);
process.on('SIGTERM', interrupt);
function checkRunning() {
  if (cancellation.signal.aborted && !cleaningUp) throw new Error('Container verification interrupted');
}
async function docker(args, {input, timeout = 30000} = {}) {
  checkRunning();
  let output;
  if (input === undefined) {
    try { output = (await exec('docker', ['--host=unix:///var/run/docker.sock', ...args], {env: environment, timeout, maxBuffer: 1024 * 1024})).stdout.trim(); }
    catch { throw new Error(`Local Docker ${args[0]} failed; check daemon, image and resource availability`); }
  } else {
    // Source sent over stdin is never printed, and no credentials enter argv/env.
    output = await new Promise((accept, reject) => {
      const child = execFile('docker', ['--host=unix:///var/run/docker.sock', ...args], {env: environment, timeout, maxBuffer: 1024 * 1024}, (error, stdout) => {
        if (error) reject(new Error(`Local Docker ${args[0]} fixture failed`));
        else accept(stdout.trim());
      });
      child.stdin.end(input);
    });
  }
  // Let a bounded Docker operation finish so cleanup can identify any resource
  // it created. Killing the client mid-create can leave an unobserved resource.
  checkRunning();
  return output;
}
function check(condition, message) { if (!condition) throw new Error(message); }
const [image] = JSON.parse(await docker(['image', 'inspect', options.image]));
check(image.Id?.startsWith('sha256:'), 'A local image ID is required');
const prefix = `wee-smoke-${randomUUID().slice(0, 12)}`;
const volume = `${prefix}-data`, containers = [], sockets = [];
let volumeCreated = false;
const report = {startedAt: new Date().toISOString(), image: image.Id, runtimeUser: image.Config.User, checks: [], limitations: [
  'Local Docker only; no Railway deployment, live settings or physical-device evidence.',
  'Saved history/checkpoints use a synthetic ProfileStore fixture; complete gameplay is tested separately.',
]};
async function step(name, action) {
  const start = performance.now();
  let evidence;
  try { evidence = await action(); }
  catch (error) {
    report.checks.push({name, status: 'failed', milliseconds: Math.round(performance.now() - start), error: error.message});
    throw error;
  }
  report.checks.push({name, status: 'passed', milliseconds: Math.round(performance.now() - start), ...(evidence ? {evidence} : {})});
  console.log(`PASS ${name}`);
}
const publicHeaders = {host: 'sports.example.test', 'x-forwarded-host': 'sports.example.test', 'x-forwarded-proto': 'https'};
async function request(origin, path, options = {}) {
  checkRunning();
  return fetch(origin + path, {...options, headers: {...publicHeaders, ...options.headers}, redirect: 'manual', signal: AbortSignal.any([cancellation.signal, AbortSignal.timeout(10000)])});
}
async function json(origin, path, options = {}) {
  const response = await request(origin, path, options);
  check(response.ok, `HTTP request failed: ${path} (${response.status})`);
  return response.json();
}
async function runUtility(args, {input, root = false, mounted = true} = {}) {
  const name = `${prefix}-utility-${containers.length}`;
  containers.push(name);
  return docker(['run', '--name', name, '--pull=never', '--network=none', ...(input === undefined ? [] : ['--interactive']), ...(root ? ['--user', '0:0'] : []),
    ...(mounted ? ['--mount', `type=volume,source=${volume},target=/data`] : []),
    '--entrypoint', 'node', image.Id, ...args], {input});
}
async function start(label, filename = '/data/profiles.sqlite', mounted = true) {
  const name = `${prefix}-${label}`;
  containers.push(name);
  await docker(['run', '--detach', '--pull=never', '--name', name, '--publish', '127.0.0.1::5173',
    '--env', 'PORT=5173', '--env', 'PUBLIC_GAME_URL=https://sports.example.test', '--env', `WEE_PROFILE_DB=${filename}`,
    ...(mounted ? ['--mount', `type=volume,source=${volume},target=/data`] : []), image.Id]);
  const port = await docker(['port', name, '5173/tcp']);
  check(/^127\.0\.0\.1:\d+$/.test(port), 'Container port must publish only on loopback');
  const origin = `http://${port}`;
  for (let attempt = 0; attempt < 60; attempt++) {
    checkRunning();
    try { if ((await request(origin, '/health')).status === 200) return {name, origin}; } catch { /* Startup may still be binding. */ }
    await delay(100);
  }
  throw new Error('Container did not become healthy');
}
async function stop(instance) {
  const began = performance.now();
  await docker(['stop', '--time', '15', instance.name], {timeout: 20000});
  const exitCode = Number(await docker(['inspect', '--format', '{{.State.ExitCode}}', instance.name]));
  check(exitCode === 0, 'SIGTERM must exit cleanly');
  const milliseconds = Math.round(performance.now() - began);
  check(milliseconds < 15000, 'SIGTERM exceeded the configured grace interval');
  return {exitCode, milliseconds};
}
async function socket(origin, {transport = 'websocket', originHeader, rejectOrigin = false} = {}) {
  checkRunning();
  const client = io(origin, {transports: [transport], reconnection: false, timeout: 3000,
    ...(originHeader ? {extraHeaders: {Origin: originHeader}} : {})});
  sockets.push(client);
  await new Promise((accept, reject) => {
    client.once('connect', () => rejectOrigin ? reject(new Error('An untrusted browser origin was accepted')) : accept());
    client.once('connect_error', () => rejectOrigin ? accept() : reject(new Error('Real-time connection failed')));
  });
  if (rejectOrigin) client.disconnect();
  return client;
}
const send = (client, event, payload) => client.timeout(3000).emitWithAck(event, payload);
async function guestRoom(origin) {
  const host = await socket(origin);
  const room = await send(host, EVENTS.HOST_CREATE, {v: PROTOCOL_VERSION, sport: 'bowling'});
  check(room.ok, 'Guest host could not create a room');
  const phone = await socket(origin, {transport: 'polling'});
  const seat = await send(phone, EVENTS.PLAYER_JOIN, {v: PROTOCOL_VERSION, code: room.code, name: 'Guest'});
  check(seat.ok && seat.slot === 0, 'Guest phone could not join via polling');
  return {host, phone, room, seat};
}

let live, account, priorRoom;
const auth = () => ({'x-wee-client': 'native', authorization: `Bearer ${account.token}`});
async function verifySaved(origin, revision, hand) {
  const result = await json(origin, '/api/profile', {headers: auth()});
  check(result.profile.id === account.profile.id && result.profile.revision === revision && result.profile.preferences.hand === hand, 'Profile identity/preferences did not survive storage recovery');
  const {history} = await json(origin, '/api/profile/history', {headers: auth()});
  check(history.length === 2 && history.some(match => match.matchId === 'container-completed' && match.score === 300 && match.saved), 'Committed history did not survive storage recovery');
  const {checkpoint} = await json(origin, '/api/profile/matches/container-active/checkpoint', {headers: auth()});
  check(checkpoint.revision === 1 && checkpoint.state.boundary === 'settled' && checkpoint.state.pins.length === 10, 'Stable checkpoint did not survive storage recovery');
  const {matches} = await json(origin, '/api/profile/recovery', {headers: auth()});
  check(matches.length === 1 && matches[0].matchId === 'container-active', 'Supported solo continuation is unavailable');
  return {profileRevision: revision, historyEntries: history.length, checkpointRevision: checkpoint.revision, recoverableMatches: matches.length};
}

try {
  await step('non-root default directory and SQLite permissions', async () => {
    const evidence = JSON.parse(await runUtility(['--input-type=module', '-'], {mounted: false, input: `
      import {statSync,accessSync,constants} from 'node:fs';
      import {ProfileStore} from './server/profiles/store.js';
      const store = new ProfileStore({filename: '.wee-data/default-probe.sqlite'});
      let codeWritable=true;
      try {accessSync('server/main.js',constants.W_OK);} catch {codeWritable=false;}
      console.log(JSON.stringify({nodeVersion: process.version, uid: process.getuid(), gid: process.getgid(), directoryMode: statSync('.wee-data').mode & 511, databaseMode: statSync('.wee-data/default-probe.sqlite').mode & 511, codeUid:statSync('server/main.js').uid, codeWritable}));
      store.close();
    `}));
    check(evidence.uid === 1000 && evidence.gid === 1000 && evidence.directoryMode === 0o700 && evidence.databaseMode === 0o600, 'Default storage must be private and writable by UID/GID 1000');
    check(evidence.codeUid === 0 && !evidence.codeWritable, 'Application source must remain root-owned and read-only to the runtime user');
    return evidence;
  });
  volumeCreated = true;
  await docker(['volume', 'create', volume]);
  await runUtility(['-e', "const fs=require('node:fs');fs.chownSync('/data',1000,1000);fs.chmodSync('/data',0o700);"], {root: true});
  await step('persistent volume startup and canonical QR URL', async () => {
    live = await start('live');
    const response = await request(live.origin, '/health');
    check(response.headers.get('x-wee-profiles') === 'ready', 'Mounted profile storage was unavailable');
    const link = await json(live.origin, '/api/phone-link');
    check(link.origin === 'https://sports.example.test' && link.status === 'ready', 'Canonical phone link is incorrect');
    const redirected = await fetch(live.origin + '/join?code=ABCD', {redirect: 'manual'});
    check(redirected.status === 307 && redirected.headers.get('location') === 'https://sports.example.test/join?code=ABCD', 'Join redirect must use the canonical public origin');
    return {health: response.status, profiles: 'ready', publicOrigin: link.origin};
  });
  await step('production routes, every built asset, MIME and cache validation', async () => {
    for (const path of ['/', '/home', '/join', '/host/ABCD', '/profile']) {
      const response = await request(live.origin, path);
      check(response.status === 200 && response.headers.get('content-type').startsWith('text/html'), `SPA route failed: ${path} (${response.status})`);
      await response.arrayBuffer();
    }
    const files = JSON.parse(await docker(['exec', '-i', live.name, 'node', '--input-type=module', '-'], {input: `
      import {readdirSync} from 'node:fs';
      function list(root, prefix='') {return readdirSync(root,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?list(root+'/'+entry.name,prefix+entry.name+'/'):[prefix+entry.name]);}
      console.log(JSON.stringify(list('/app/dist')));
    `}));
    const types = {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
      '.glb': 'model/gltf-binary', '.webp': 'image/webp', '.wav': 'audio/wav', '.woff2': 'font/woff2', '.txt': 'text/plain', '.md': 'text/plain',
      '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.avif': 'image/avif', '.ico': 'image/x-icon', '.mp3': 'audio/mpeg'};
    let immutable = 0, revalidated = 0;
    for (const file of files) {
      const response = await request(live.origin, '/' + file);
      check(response.status === 200, `Built file failed: ${file}`);
      check(response.headers.get('content-type').split(';')[0] === (types[extname(file)] || 'application/octet-stream'), `Built file MIME failed: ${file}`);
      const bytes = await response.arrayBuffer();
      check(bytes.byteLength > 0 && Number(response.headers.get('content-length')) === bytes.byteLength, `Built file length failed: ${file}`);
      const cache = response.headers.get('cache-control');
      if (cache.includes('immutable')) immutable++;
      else { check(cache === 'no-cache', `Unversioned file must revalidate: ${file}`); revalidated++; }
      const unchanged = await request(live.origin, '/' + file, {headers: {'if-none-match': response.headers.get('etag')}});
      check(unchanged.status === 304 && (await unchanged.arrayBuffer()).byteLength === 0, `ETag failed: ${file}`);
    }
    check(files.filter(file => file.endsWith('.html')).length === 6 && immutable > 0 && revalidated > 0, 'Incomplete multi-page asset inventory');
    for (const path of ['/missing-route', '/assets/missing.js', '/.env', '/server/main.js', '/%2e%2e%2fpackage.json']) {
      const response = await request(live.origin, path);
      check(response.status === 404 && !response.headers.get('content-type').includes('html'), `Unknown path exposed misleading content: ${path}`);
      await response.arrayBuffer();
    }
    return {spaRoutes: 5, builtFiles: files.length, htmlEntries: 6, immutableAssets: immutable, revalidatingFiles: revalidated};
  });
  await step('guest realtime joining and browser Origin enforcement', async () => {
    priorRoom = await guestRoom(live.origin);
    await socket(live.origin, {originHeader: 'https://evil.example', rejectOrigin: true});
    await socket(live.origin, {transport: 'polling', originHeader: 'https://evil.example', rejectOrigin: true});
    const publicClient = await socket(live.origin, {originHeader: 'https://sports.example.test'}); publicClient.disconnect();
    return {guestWebSocket: true, guestPolling: true, foreignOriginsRejected: 2, canonicalOriginAccepted: true};
  });
  await step('native profile HTTP and optimistic preference revisions', async () => {
    account = await json(live.origin, '/api/profile/register', {method: 'POST', headers: {'content-type': 'application/json', 'x-wee-client': 'native'},
      body: JSON.stringify({username: 'container_owner', displayName: 'Container Owner', password: randomUUID() + randomUUID()})});
    check(typeof account.token === 'string', 'Native profile session was not issued');
    const updated = await json(live.origin, '/api/profile', {method: 'PATCH', headers: {...auth(), 'content-type': 'application/json'},
      body: JSON.stringify({revision: 1, preferences: {hand: 'Left'}})});
    check(updated.profile.revision === 2 && updated.profile.preferences.hand === 'Left', 'Preference update failed');
    const stale = await request(live.origin, '/api/profile', {method: 'PATCH', headers: {...auth(), 'content-type': 'application/json'}, body: JSON.stringify({revision: 1, displayName: 'Stale'})});
    check(stale.status === 409, 'A stale profile revision was accepted'); await stale.arrayBuffer();
    return {created: true, preferenceRevision: 2, staleRevisionStatus: stale.status};
  });
  await step('committed history and checkpoint remain in WAL before online backup', async () => {
    const evidence = JSON.parse(await docker(['exec', '-i', live.name, 'node', '--input-type=module', '-'], {input: `
      import {ProfileStore} from './server/profiles/store.js';
      import {DatabaseSync} from 'node:sqlite';
      import {statSync,copyFileSync,rmSync} from 'node:fs';
      const store = new ProfileStore({filename:'/data/profiles.sqlite'});
      store.db.exec('PRAGMA wal_autocheckpoint=0');
      const state={version:1,boundary:'settled',match:{version:1,players:[{player:1,name:'Owner'}],deliveries:[]},pins:Array.from({length:10},(_,i)=>({id:i+1,position:[i*.1,.4,-9],quaternion:[0,0,0,1],standing:true})),settings:{aim:0}};
      for (const matchId of ['container-active','container-completed']) {
        store.createMatch({matchId,sport:'bowling',hostMemberId:'host',participants:[{memberId:'player',name:'Owner',profileId:${JSON.stringify(account.profile.id)}}]});
        const complete=matchId==='container-completed';
        store.saveCheckpoint({matchId,hostMemberId:'host',hostEpoch:1,expectedRevision:0,state:complete?{...state,pins:[],match:{...state.match,deliveries:Array.from({length:12},()=>[])}}:state,...(complete?{results:[{memberId:'player',score:300,rank:1,outcome:'complete'}]}:{})});
      }
      const walBytes=statSync('/data/profiles.sqlite-wal').size;
      copyFileSync('/data/profiles.sqlite','/tmp/unsafe-main-only.sqlite');
      const raw=new DatabaseSync('/tmp/unsafe-main-only.sqlite',{readOnly:true});
      let mainFileMatches=0;
      try {mainFileMatches=raw.prepare('SELECT count(*) AS count FROM matches').get().count;} catch { /* Schema can also still be in WAL. */ }
      raw.close();rmSync('/tmp/unsafe-main-only.sqlite');
      const modes=['','-wal','-shm'].map(suffix=>statSync('/data/profiles.sqlite'+suffix).mode&511);
      const directory=statSync('/data');
      console.log(JSON.stringify({walBytes,mainFileMatches,liveMatches:2,modes,directoryMode:directory.mode&511,directoryUid:directory.uid}));
      store.close();
    `}));
    check(evidence.walBytes > 0 && evidence.mainFileMatches < evidence.liveMatches, 'Fixture did not prove committed WAL content beyond the main file');
    check(evidence.directoryMode === 0o700 && evidence.directoryUid === 1000 && evidence.modes.every(mode => mode === 0o600), 'Mounted database and WAL permissions are not private');
    await verifySaved(live.origin, 2, 'Left');
    return evidence;
  });
  await step('SQLite-aware online backup while the service is running', async () => {
    const result = JSON.parse(await docker(['exec', live.name, 'node', 'server/scripts/profile-db.js', 'backup', '/data/profiles.sqlite', '/data/backup.sqlite']));
    check(result.operation === 'backup' && result.schemaVersion === 1 && result.bytes > 0, 'Online backup failed');
    const updated = await json(live.origin, '/api/profile', {method: 'PATCH', headers: {...auth(), 'content-type': 'application/json'}, body: JSON.stringify({revision: 2, preferences: {hand: 'Right'}})});
    check(updated.profile.revision === 3, 'Post-backup profile write failed');
    return {schemaVersion: result.schemaVersion, bytes: result.bytes, snapshotRevision: 2, laterLiveRevision: 3};
  });
  await step('SIGTERM drains connected transports within the grace interval', () => stop(live));
  await step('restart preserves account/history/checkpoint and expires old live seats', async () => {
    live = await start('restarted');
    const saved = await verifySaved(live.origin, 3, 'Right');
    const peer = await socket(live.origin);
    const oldSeat = await send(peer, EVENTS.SESSION_RESUME, {v: PROTOCOL_VERSION, code: priorRoom.room.code, role: 'player', token: priorRoom.seat.token});
    check(!oldSeat.ok && oldSeat.error === 'no-room', 'A prior-process room survived unexpectedly');
    peer.disconnect();
    return {...saved, previousRoom: oldSeat.error};
  });
  await stop(live);
  await step('offline restore to a new database path preserves the backup boundary', async () => {
    const result = JSON.parse(await runUtility(['server/scripts/profile-db.js', 'restore', '/data/backup.sqlite', '/data/restored.sqlite']));
    check(result.operation === 'restore' && result.schemaVersion === 1, 'Offline restore failed');
    live = await start('restored', '/data/restored.sqlite');
    return {...await verifySaved(live.origin, 2, 'Left'), restoredSchemaVersion: result.schemaVersion};
  });
  await stop(live);
  await step('unwritable storage degrades profiles while guest HTTP/realtime remain usable', async () => {
    live = await start('unwritable', '/app/unwritable/profiles.sqlite', false);
    const health = await request(live.origin, '/health');
    check(health.status === 200 && health.headers.get('x-wee-profiles') === 'unavailable', 'Guest readiness must survive unavailable storage');
    const failed = await request(live.origin, '/api/profile');
    check(failed.status === 503 && (await failed.json()).error === 'profile-storage-unavailable', 'Profile storage failure was not explicit');
    await guestRoom(live.origin);
    const shutdown = await stop(live);
    return {healthStatus: health.status, profileStatus: failed.status, guestJoined: true, shutdown};
  });
  report.status = 'passed';
} catch (error) {
  report.status = 'failed';
  // Error messages are fixed labels/statuses; no response bodies or credentials.
  report.error = error.message;
  console.error(`FAIL ${error.message}`);
  process.exitCode = 1;
} finally {
  cleaningUp = true;
  for (const client of sockets) client.disconnect();
  const cleanupErrors = [];
  for (const name of containers.reverse()) {
    try {
      const existing = await docker(['container', 'ls', '--all', '--filter', `name=^/${name}$`, '--format', '{{.Names}}']);
      if (existing === name) await docker(['rm', '--force', name]);
    } catch { cleanupErrors.push('container removal failed'); }
  }
  if (volumeCreated) {
    try {
      const existing = await docker(['volume', 'ls', '--filter', `name=^${volume}$`, '--format', '{{.Name}}']);
      if (existing === volume) await docker(['volume', 'rm', volume]);
    } catch { cleanupErrors.push('volume removal failed'); }
  }
  report.cleanup = {containers: containers.length, volume: volumeCreated, errors: cleanupErrors};
  if (cleanupErrors.length) { report.status = 'failed'; process.exitCode = 1; }
  report.finishedAt = new Date().toISOString();
  await mkdir(dirname(resolve(options.report)), {recursive: true});
  await writeFile(resolve(options.report), JSON.stringify(report, null, 2) + '\n', {flag: 'wx', mode: 0o600});
  console.log(`Report: ${resolve(options.report)}`);
  process.off('SIGINT', interrupt);
  process.off('SIGTERM', interrupt);
}
