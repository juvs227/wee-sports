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
  const server = launch(process.execPath, ['server/main.js', '--preview'], { env: { ...process.env, PORT: String(port), PUBLIC_GAME_URL: origin } });
  server.once('error', error => { console.error(error.message); stop(1); });
  server.once('exit', code => { if (!stopping) stop(code || 1); });
  tunnel.once('exit', () => { if (!stopping) { console.error('The secure phone connection ended. Restart this session to get a fresh QR code.'); stop(1); } });
  await waitForGameServer(`http://127.0.0.1:${port}/health`, { signal: shutdown.signal });
  if (stopping) process.exit(0);
  console.log(`\nOpen the TV here: http://localhost:${port}\nThe lobby QR now uses ${origin}\nKeep this terminal open while playing. The temporary public link stops when you stop this session.\n`);
} catch (error) {
  if (!stopping) { console.error(error.message); stop(1); }
}
