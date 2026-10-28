import { test, expect, vi } from 'vitest';
import { phoneBuildEnvironment, waitForGameServer } from '../scripts/phone-session.mjs';

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
