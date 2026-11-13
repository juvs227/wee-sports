import { setTimeout as delay } from 'node:timers/promises';
import { securePhoneOrigin } from '../server/phoneLink.js';

/** The phone bundle must talk to the combined server on its own public origin. */
export function phoneBuildEnvironment(env) {
  return { ...env, VITE_SERVER_URL: '', VITE_PUBLIC_URL: '', NGROK_HOST: '', WEE_BUILD_DIR: '.phone-build' };
}

/** Provisioning can run during the build; the URL alone does not mean ready. */
export function waitForTunnelOrigin(tunnel, { signal, timeoutMs = 45000 } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason); return; }
    let output = '';
    const finish = (error, origin) => {
      clearTimeout(timer);
      tunnel.stdout.off('data', read);
      tunnel.stderr.off('data', read);
      tunnel.off('error', failed);
      tunnel.off('exit', exited);
      signal?.removeEventListener('abort', aborted);
      if (error) reject(error); else resolve(origin);
    };
    const read = chunk => {
      output = (output + chunk.toString()).slice(-12000);
      const match = output.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com\b/);
      if (match) finish(null, securePhoneOrigin(match[0]));
    };
    const failed = error => finish(error);
    const exited = () => finish(new Error('The secure connection stopped before it was ready.'));
    const aborted = () => finish(signal.reason);
    const timer = setTimeout(() => finish(new Error('The secure phone link timed out. Check your internet connection and try again.')), timeoutMs);
    tunnel.stdout.on('data', read);
    tunnel.stderr.on('data', read);
    tunnel.once('error', failed);
    tunnel.once('exit', exited);
    signal?.addEventListener('abort', aborted, { once: true });
  });
}

/** Print a ready URL only after the actual combined server answers health checks. */
export async function waitForGameServer(url, { signal, fetcher = fetch, timeoutMs = 15000, intervalMs = 250, requestTimeoutMs = 1000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    signal?.throwIfAborted();
    const remaining = deadline - Date.now();
    const timeout = AbortSignal.timeout(Math.max(1, Math.min(requestTimeoutMs, remaining)));
    try {
      const response = await fetcher(url, { signal: signal ? AbortSignal.any([signal, timeout]) : timeout, cache: 'no-store' });
      if (response.ok && (await response.text()) === 'ok') return;
    } catch { signal?.throwIfAborted(); }
    const pause = Math.min(intervalMs, deadline - Date.now());
    if (pause > 0) await delay(pause, undefined, { signal });
  }
  throw new Error('The game server did not become ready. Restart the phone session and check the startup messages.');
}
