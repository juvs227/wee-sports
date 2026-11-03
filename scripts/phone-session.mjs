import { setTimeout as delay } from 'node:timers/promises';

/** The phone bundle must talk to the combined server on its own public origin. */
export function phoneBuildEnvironment(env) {
  return { ...env, VITE_SERVER_URL: '', VITE_PUBLIC_URL: '', NGROK_HOST: '', WEE_BUILD_DIR: '.phone-build' };
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
