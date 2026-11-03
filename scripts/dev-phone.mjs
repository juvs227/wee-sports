import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { securePhoneOrigin } from '../server/phoneLink.js';
import { phoneBuildEnvironment, waitForGameServer } from './phone-session.mjs';

// One command builds the app, creates an HTTPS tunnel and serves the game.
// Serve the production build so the public URL does not expose Vite's file API.
const port = Number(process.env.PORT || 5173);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be between 1 and 65535.');
const children = new Set();
const shutdown = new AbortController();
let stopping = false;
let forceStop;
let healthTimer;
function launch(command, args, options = {}) {
  const child = spawn(command, args, { stdio: 'inherit', ...options });
  children.add(child);
  child.once('close', () => { children.delete(child); if (!children.size) clearTimeout(forceStop); });
  return child;
}
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  shutdown.abort();
  clearTimeout(healthTimer);
  for (const child of children) child.kill('SIGTERM');
  forceStop = setTimeout(() => { for (const child of children) child.kill('SIGKILL'); }, 3000);
  forceStop.unref();
  process.exitCode = code;
}
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => stop());
try {
  const existing = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(500) }).catch(() => null);
  if (existing?.ok) throw new Error(`Port ${port} already has a game running. Stop that session first, then run npm run dev.`);
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const check = launch('cloudflared', ['--version'], { stdio: 'ignore' });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { check.kill('SIGTERM'); reject(new Error('cloudflared did not respond. Check your installation.')); }, 5000);
    check.once('error', () => { clearTimeout(timer); reject(new Error('Install the official cloudflared client once (macOS: brew install cloudflared), then run npm run dev again. See README for other systems.')); });
    check.once('exit', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error('cloudflared could not start. Check your installation.')); });
  });
  if (stopping) process.exit(0);
  console.log('Preparing Wee Sports for phone play…');
  const build = launch(npm, ['run', 'build'], { env: phoneBuildEnvironment(process.env), shell: process.platform === 'win32' });
  const [buildCode] = await once(build, 'exit');
  if (stopping) process.exit(0);
  if (buildCode !== 0) throw new Error('The game build failed. Fix the build before opening a phone session.');
  const tunnel = launch('cloudflared', ['tunnel', '--no-autoupdate', '--protocol', 'http2', '--url', `http://127.0.0.1:${port}`], { stdio: ['ignore', 'pipe', 'pipe'] });
  const origin = await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error('The secure phone link timed out. Check your internet connection and try again.')), 45000);
    const read = chunk => {
      output = (output + chunk.toString()).slice(-12000);
      const match = output.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com\b/);
      if (match) { clearTimeout(timer); resolve(securePhoneOrigin(match[0])); }
    };
    tunnel.stdout.on('data', read);
    tunnel.stderr.on('data', read);
    tunnel.once('error', error => { clearTimeout(timer); reject(error); });
    tunnel.once('exit', () => { clearTimeout(timer); reject(new Error('The secure connection stopped before it was ready.')); });
  });
  if (stopping) process.exit(0);
  const server = launch(process.execPath, ['server/main.js', '--preview'], {
    stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
    env: { ...phoneBuildEnvironment(process.env), PORT: String(port), PUBLIC_GAME_URL: origin, PHONE_LINK_MANAGED: '1' },
  });
  server.once('error', error => { console.error(error.message); stop(1); });
  server.once('exit', code => { if (!stopping) stop(code || 1); });
  let tunnelRunning = true;
  let linkStatus = 'connecting';
  function setLinkStatus(status) {
    if (stopping || status === linkStatus) return;
    linkStatus = status;
    if (server.connected) server.send({ type: 'phone-link-status', status }, () => {});
    if (status === 'ready') console.log(`Phone link ready: ${origin}\nScan the current lobby QR. This temporary link is not tied to a Cloudflare account.\nKeep this session open while playing. Restarting creates a new phone link.\n`);
    else if (status === 'reconnecting') console.log('The phone link is reconnecting. The TV game stays open; its QR will return when the link is reachable.');
  }
  tunnel.once('exit', () => {
    tunnelRunning = false;
    clearTimeout(healthTimer);
    if (!stopping) {
      setLinkStatus('unavailable');
      console.error('The phone link stopped. Restart this session for a fresh QR code. The local game is still running.');
    }
  });
  await waitForGameServer(`http://127.0.0.1:${port}/health`, { signal: shutdown.signal });
  if (stopping) process.exit(0);
  console.log(`\nOpen the TV here: http://localhost:${port}\nChecking that the phone link works from the internet…\n`);
  async function checkPhoneLink(first = false) {
    try {
      await waitForGameServer(`${origin}/health`, { signal: shutdown.signal, timeoutMs: first ? 45000 : 10000, requestTimeoutMs: 5000, intervalMs: 1000 });
      if (tunnelRunning) setLinkStatus('ready');
    } catch {
      if (tunnelRunning) setLinkStatus('reconnecting');
    }
    if (!stopping && tunnelRunning) healthTimer = setTimeout(() => { void checkPhoneLink(); }, 15000);
  }
  await checkPhoneLink(true);
} catch (error) {
  if (!stopping) { console.error(error.message); stop(1); }
}
