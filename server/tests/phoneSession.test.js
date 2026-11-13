import { EventEmitter } from 'node:events';
import { afterEach, test, expect, vi } from 'vitest';
import { phoneBuildEnvironment, waitForGameServer, waitForTunnelOrigin } from '../../scripts/phone-session.mjs';

afterEach(() => vi.useRealTimers());

function fakeTunnel() {
  return Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter() });
}

function expectTunnelWaitCleaned(tunnel) {
  expect(tunnel.stdout.listenerCount('data')).toBe(0);
  expect(tunnel.stderr.listenerCount('data')).toBe(0);
  expect(tunnel.listenerCount('error')).toBe(0);
  expect(tunnel.listenerCount('exit')).toBe(0);
}

test('a tunnel URL split across output chunks resolves and removes startup listeners', async () => {
  const tunnel = fakeTunnel();
  const origin = waitForTunnelOrigin(tunnel);
  tunnel.stderr.emit('data', 'Starting tunnel https://');
  tunnel.stderr.emit('data', 'phone-session.trycloudflare.com\n');
  await expect(origin).resolves.toBe('https://phone-session.trycloudflare.com');
  expectTunnelWaitCleaned(tunnel);
});

test('cancelling tunnel startup removes its deadline and output listeners immediately', async () => {
  vi.useFakeTimers();
  const tunnel = fakeTunnel();
  const controller = new AbortController();
  const waiting = expect(waitForTunnelOrigin(tunnel, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
  controller.abort();
  await waiting;
  expectTunnelWaitCleaned(tunnel);
  expect(vi.getTimerCount()).toBe(0);
  await expect(waitForTunnelOrigin(tunnel, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
  expect(vi.getTimerCount()).toBe(0);
});

test('an unresponsive tunnel fails within its startup deadline and cleans up', async () => {
  vi.useFakeTimers();
  const tunnel = fakeTunnel();
  const waiting = expect(waitForTunnelOrigin(tunnel, { timeoutMs: 50 })).rejects.toThrow('timed out');
  await vi.advanceTimersByTimeAsync(50);
  await waiting;
  expectTunnelWaitCleaned(tunnel);
  expect(vi.getTimerCount()).toBe(0);
});

test('tunnel exit and spawn failure reject startup without waiting for the deadline', async () => {
  vi.useFakeTimers();
  for (const event of ['exit', 'error']) {
    const tunnel = fakeTunnel();
    const waiting = expect(waitForTunnelOrigin(tunnel)).rejects.toThrow(event === 'exit' ? 'stopped' : 'spawn failed');
    tunnel.emit(event, event === 'exit' ? 1 : new Error('spawn failed'));
    await waiting;
    expectTunnelWaitCleaned(tunnel);
    expect(vi.getTimerCount()).toBe(0);
  }
});

test('a phone build overrides stale origins without mutating the caller environment', () => {
  const original = { PATH: '/bin', VITE_SERVER_URL: 'http://localhost:3001', VITE_PUBLIC_URL: 'https://old.example', NGROK_HOST: 'old.example' };
  const env = phoneBuildEnvironment(original);
  expect(env).toEqual({ PATH: '/bin', VITE_SERVER_URL: '', VITE_PUBLIC_URL: '', NGROK_HOST: '', WEE_BUILD_DIR: '.phone-build' });
  expect(original.VITE_SERVER_URL).toBe('http://localhost:3001');
});

test('startup waits through an unavailable server and non-health responses', async () => {
  const fetcher = vi.fn().mockRejectedValueOnce(new Error('Connection refused'))
    .mockResolvedValueOnce({ ok: false })
    .mockResolvedValueOnce({ ok: true, text: async () => '<html>Not the game</html>' })
    .mockResolvedValueOnce({ ok: true, text: async () => 'ok' });
  await waitForGameServer('http://127.0.0.1:5173/health', { fetcher, intervalMs: 0 });
  expect(fetcher).toHaveBeenCalledTimes(4);
});

test('startup fails on timeout and cancellation does not leave a health polling loop', async () => {
  const fetcher = vi.fn().mockRejectedValue(new Error('Connection refused'));
  await expect(waitForGameServer('http://localhost/health', { fetcher, timeoutMs: 8, intervalMs: 2 })).rejects.toThrow('did not become ready');
  const controller = new AbortController();
  const stopped = vi.fn(() => { controller.abort(); throw new Error('Stopped'); });
  await expect(waitForGameServer('http://localhost/health', { fetcher: stopped, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
  expect(stopped).toHaveBeenCalledOnce();
});
