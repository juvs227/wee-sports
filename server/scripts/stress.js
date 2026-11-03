import { fork, execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { setTimeout as sleep } from 'node:timers/promises';
import { io } from 'socket.io-client';
import { EVENTS, playerCapacity, PHASES, PROTOCOL_VERSION } from '@wee/shared/protocol.js';

const TIMEOUT_MS = 5000;
const TARGET_MS = 75;
const v = PROTOCOL_VERSION;
const PHONES_PER_LOBBY = playerCapacity('tennis');
const help = `Usage: npm run stress -- [options]
  --lobbies 10,25,50,100,200  Increasing stages, up to 2000 lobbies each
  --seconds 10              Measured seconds per stage (1–600)
  --interval-ms 250         One phone update per lobby at this interval (10–10000)
  --output stress-results/latest.json

Starts an isolated local server. Each lobby has one TV and two phones;
one phone toggles ready, and latency ends when its TV receives the update.
Stops at the first failed stage. Exit codes: 0 all pass, 1 threshold/failure,
2 invalid options or harness error, 130 interrupted. No tennis simulation.`;

export function parseOptions(args) {
  const options = { lobbies: [10, 25, 50, 100, 200], seconds: 10, intervalMs: 250,
    output: 'stress-results/latest.json' };
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i], value = args[i + 1];
    if (key === '--help' && args.length === 1) return { help: true };
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${key}`);
    if (key === '--lobbies') options.lobbies = value.split(',').map(Number);
    else if (key === '--seconds') options.seconds = Number(value);
    else if (key === '--interval-ms') options.intervalMs = Number(value);
    else if (key === '--output') options.output = value;
    else throw new Error(`Unknown option: ${key}`);
  }
  const integerIn = (n, min, max) => Number.isInteger(n) && n >= min && n <= max;
  if (!options.lobbies.length || options.lobbies.length > 20 || options.lobbies.some((n, i, all) =>
    !integerIn(n, 1, 2000) || (i > 0 && n <= all[i - 1]))) {
    throw new Error('--lobbies must be increasing, distinct integers from 1 to 2000 (at most 20 stages)');
  }
  if (!integerIn(options.seconds, 1, 600)) throw new Error('--seconds must be an integer from 1 to 600');
  if (!integerIn(options.intervalMs, 10, 10000)) throw new Error('--interval-ms must be an integer from 10 to 10000');
  if (options.intervalMs > options.seconds * 1000) throw new Error('Each stage must include at least one update per lobby');
  return options;
}

export function assessStage(metrics) {
  const sorted = [...metrics.latenciesMs].sort((a, b) => a - b);
  const percentile = p => sorted.length ? Number(sorted[Math.ceil(sorted.length * p) - 1].toFixed(2)) : null;
  const withinTarget = sorted.filter(ms => ms <= TARGET_MS).length;
  // Missing sends and failed deliveries stay in the denominator.
  const withinTargetFraction = metrics.attempted ? withinTarget / metrics.attempted : 0;
  const { latenciesMs, ...counts } = metrics;
  return { ...counts, delivered: sorted.length, withinTargetFraction,
    latencyMs: { p50: percentile(0.5), p90: percentile(0.9), p95: percentile(0.95), p99: percentile(0.99) },
    passed: withinTargetFraction >= 0.9 && metrics.skipped === 0 && metrics.errors === 0 &&
      metrics.setupErrors === 0 && metrics.unexpectedDisconnects === 0 };
}

async function startServer() {
  const child = fork(new URL('./stress-server.js', import.meta.url), [], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
  const exited = new Promise(resolveExit => child.once('close', resolveExit));
  const stop = async () => {
    child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), TIMEOUT_MS);
    await exited;
    clearTimeout(timer);
  };
  try {
    const port = await new Promise((resolvePort, reject) => {
      const timer = setTimeout(() => reject(new Error('Local server startup timed out')), TIMEOUT_MS);
      child.once('message', message => { clearTimeout(timer); resolvePort(message.port); });
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', () => { clearTimeout(timer); reject(new Error('Local server exited')); });
    });
    return { url: `http://127.0.0.1:${port}`, stop };
  } catch (error) { await stop(); throw error; }
}

async function send(socket, event, payload) {
  const response = await socket.timeout(TIMEOUT_MS).emitWithAck(event, payload);
  if (!response?.ok) throw new Error(response?.error ?? 'Missing acknowledgement');
  return response;
}

function readyUpdate(room) {
  // Only one update is outstanding per lobby. Alternating the state lets the
  // TV identify the matching broadcast without changing the team's protocol.
  const ready = !room.ready, started = performance.now();
  return new Promise((resolveUpdate, reject) => {
    let acknowledged = false, settled = false, latency;
    const finish = error => {
      if (settled) return;
      if (!error && (!acknowledged || latency === undefined)) return;
      settled = true;
      clearTimeout(timer);
      room.host.off(EVENTS.LOBBY_UPDATE, onUpdate);
      if (error) reject(error);
      else { room.ready = ready; resolveUpdate(latency); }
    };
    const onUpdate = state => {
      if (state.code === room.code && state.phase === PHASES.READY && !state.paused &&
          state.players.length === PHONES_PER_LOBBY && state.players.find(p => p.slot === room.slot)?.ready === ready) {
        latency ??= performance.now() - started;
        finish();
      }
    };
    const timer = setTimeout(() => finish(new Error('TV update timed out')), TIMEOUT_MS);
    room.host.on(EVENTS.LOBBY_UPDATE, onUpdate);
    send(room.phone, EVENTS.PLAYER_READY, { ready }).then(() => {
      acknowledged = true; finish();
    }, finish);
  });
}

async function measure(rooms, options, interrupted) {
  const metrics = { attempted: 0, skipped: 0, errors: 0, latenciesMs: [], errorCounts: {} };
  const pending = new Set();
  const start = performance.now(), end = start + options.seconds * 1000;
  const schedule = rooms.map((room, i) => ({ room, busy: false, next: start + i / rooms.length * options.intervalMs }));
  await new Promise(resolveStage => {
    const timer = setInterval(() => {
      const now = performance.now();
      for (const item of schedule) {
        // Count missed schedule slots as failures instead of silently reducing
        // the offered load when either the server or generator falls behind.
        const due = Math.max(0, Math.ceil((Math.min(now, end) - item.next) / options.intervalMs));
        if (!due) continue;
        metrics.attempted += due;
        item.next += due * options.intervalMs;
        if (item.busy || interrupted()) { metrics.skipped += due; continue; }
        metrics.skipped += due - 1;
        item.busy = true;
        const work = readyUpdate(item.room).then(ms => metrics.latenciesMs.push(ms), error => {
          metrics.errors += 1;
          metrics.errorCounts[error.message] = (metrics.errorCounts[error.message] ?? 0) + 1;
        }).finally(() => { item.busy = false; pending.delete(work); });
        pending.add(work);
      }
      if (now >= end || interrupted()) { clearInterval(timer); resolveStage(); }
    }, Math.min(10, options.intervalMs / 4));
  });
  await Promise.all(pending);
  return metrics;
}

async function main(options) {
  const server = await startServer();
  const sockets = [], rooms = [], stages = [];
  let closing = false, disconnects = 0, interrupted = false;
  const interrupt = () => { interrupted = true; };
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  async function connect() {
    const socket = io(server.url, { transports: ['websocket'], reconnection: false, forceNew: true,
      timeout: TIMEOUT_MS, autoConnect: false });
    sockets.push(socket);
    socket.on('disconnect', () => { if (!closing) disconnects += 1; });
    await new Promise((resolveConnect, reject) => {
      socket.once('connect', resolveConnect);
      socket.once('connect_error', reject);
      socket.connect();
    });
    return socket;
  }
  async function createRoom() {
    const host = await connect();
    const { code } = await send(host, EVENTS.HOST_CREATE, { v, sport: 'tennis' });
    let phone, slot;
    for (let i = 0; i < PHONES_PER_LOBBY; i += 1) {
      const player = await connect();
      const joined = await send(player, EVENTS.PLAYER_JOIN, { v, code, name: `Player ${i + 1}` });
      if (joined.ok && joined.slot < 2) await send(player, EVENTS.PLAYER_SETUP, { setup: 'buttons' });
      if (i === 0) { phone = player; slot = joined.slot; }
    }
    rooms.push({ code, host, phone, slot, ready: false });
  }
  try {
    console.log('Local lobby load test: two phones + one TV per lobby, one ready toggle per interval.');
    for (const target of options.lobbies) {
      if (interrupted) break;
      const before = disconnects;
      let setupErrors = 0;
      const setupErrorCounts = {};
      const setupStarted = performance.now();
      while (rooms.length < target && !setupErrors && !interrupted) {
        const batch = await Promise.allSettled(Array.from({ length: Math.min(10, target - rooms.length) }, createRoom));
        for (const result of batch) if (result.status === 'rejected') {
          setupErrors += 1;
          const message = result.reason.message;
          setupErrorCounts[message] = (setupErrorCounts[message] ?? 0) + 1;
        }
      }
      const setupMs = Math.round(performance.now() - setupStarted);
      // Let the last join broadcasts drain before correlating ready updates.
      await sleep(100);
      const measured = !setupErrors && !interrupted ? await measure(rooms, options, () => interrupted)
        : { attempted: 0, skipped: 0, errors: 0, latenciesMs: [], errorCounts: {} };
      const stage = assessStage({ lobbies: target, establishedLobbies: rooms.length,
        players: rooms.length * PHONES_PER_LOBBY, connections: sockets.filter(socket => socket.connected).length,
        seconds: options.seconds, setupMs, setupErrors, setupErrorCounts,
        unexpectedDisconnects: disconnects - before, ...measured });
      if (interrupted) stage.passed = false;
      stages.push(stage);
      console.log(`${target} lobbies / ${stage.players} players: ${stage.passed ? 'PASS' : 'FAIL'}; ` +
        `TV p90 ${stage.latencyMs.p90 ?? 'n/a'} ms; ${(stage.withinTargetFraction * 100).toFixed(1)}% within 75 ms; ` +
        `${stage.errors} errors, ${stage.skipped} missed sends, ${stage.unexpectedDisconnects} disconnects`);
      if (!stage.passed) break;
    }
    const passed = stages.filter(stage => stage.passed);
    const highest = passed.at(-1)?.lobbies ?? 0;
    let revision = 'unknown';
    try { revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { /* A source archive may have no Git metadata. */ }
    const report = {
      generatedAt: new Date().toISOString(), serverRevision: revision,
      environment: { node: process.version, platform: os.platform(), arch: os.arch(),
        cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, memoryGiB: Math.round(os.totalmem() / 2 ** 30) },
      workload: { transport: 'websocket', phonesPerLobby: PHONES_PER_LOBBY, activePhonesPerLobby: 1,
        intervalMs: options.intervalMs, secondsPerStage: options.seconds, requestedStages: options.lobbies,
        metric: 'Phone emit to matching TV lobby update; both simulated clients share a clock',
        scope: 'Local lobby/ready traffic only. No motion sensing, rendering, Wi-Fi, tennis, or match recovery. Server and load generator are separate processes on the same machine.' },
      passRule: { targetMs: TARGET_MS, minimumFraction: 0.9, allowedErrors: 0, allowedSkippedSends: 0, allowedDisconnects: 0 },
      highestPassingLobbies: highest, highestPassingPlayers: highest * PHONES_PER_LOBBY,
      firstFailingLobbies: stages.find(stage => !stage.passed)?.lobbies ?? null,
      stoppedBecause: interrupted ? 'interrupted' : stages.some(stage => !stage.passed) ? 'failed-stage' : 'configured-cap',
      stages,
    };
    await mkdir(dirname(resolve(options.output)), { recursive: true });
    await writeFile(options.output, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`Highest passing tested load: ${highest} lobbies / ${highest * PHONES_PER_LOBBY} players. Report: ${options.output}`);
    if (report.stoppedBecause === 'configured-cap') console.log('The configured cap passed; the maximum has not been found.');
    process.exitCode = interrupted ? 130 : report.stoppedBecause === 'failed-stage' ? 1 : 0;
  } finally {
    closing = true;
    for (const socket of sockets) socket.disconnect();
    await server.stop();
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseOptions(process.argv.slice(2));
    if (options.help) console.log(help);
    else await main(options);
  } catch (error) { console.error(`Stress test: ${error.message}`); process.exitCode = 2; }
}
