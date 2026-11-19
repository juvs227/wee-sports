import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const hooks = vi.hoisted(() => ({ states: [], index: 0, effects: [] }));
vi.mock('react', () => ({
  useState(initial) {
    const index = hooks.index++;
    if (!(index in hooks.states)) hooks.states[index] = typeof initial === 'function' ? initial() : initial;
    return [hooks.states[index], value => { hooks.states[index] = typeof value === 'function' ? value(hooks.states[index]) : value; }];
  },
  useEffect(effect) { hooks.effects.push(effect); },
}));
vi.mock('@client/lib/joinUrl.js', () => ({
  joinOrigin: () => window.location.origin,
  joinUrl: (code, origin) => `${origin}/join?code=${code}`,
}));
import { usePhoneLink } from '@client/lib/usePhoneLink.js';

let cleanup;
const response = data => ({ ok: true, json: async () => data });
const read = () => { hooks.index = 0; return usePhoneLink('SOLO'); };
async function mount() {
  read();
  cleanup = hooks.effects[0]();
  await vi.advanceTimersByTimeAsync(0);
  return read();
}
beforeEach(() => {
  vi.useFakeTimers();
  hooks.states = []; hooks.index = 0; hooks.effects = []; cleanup = null;
  vi.stubGlobal('window', { location: { origin: 'http://localhost:5173' } });
  vi.stubGlobal('fetch', vi.fn());
});
afterEach(() => { cleanup?.(); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

for (const failure of ['network error', '404', 'non-JSON response']) {
  test(`initial discovery ${failure} finishes without an endless opening screen`, async () => {
    if (failure === 'network error') fetch.mockRejectedValue(new Error('Offline'));
    else if (failure === '404') fetch.mockResolvedValue({ ok: false });
    else fetch.mockResolvedValue({ ok: true, json: async () => { throw new Error('HTML response'); } });
    expect(await mount()).toEqual({ url: null, loading: false, status: 'unavailable' });
  });
}

test('an unmanaged HTTPS deployment keeps its own secure join link', async () => {
  window.location.origin = 'https://team.example';
  fetch.mockResolvedValue(response({ origin: null, status: 'local' }));
  expect(await mount()).toEqual({ url: 'https://team.example/join?code=SOLO', loading: false, status: 'ready' });
});

test('a temporary discovery failure retains the known secure link', async () => {
  fetch.mockResolvedValueOnce(response({ origin: 'https://session.trycloudflare.com', status: 'ready' }))
    .mockRejectedValue(new Error('Temporary disconnect'));
  const first = await mount();
  await vi.advanceTimersByTimeAsync(10000);
  expect(read()).toEqual(first);
});

test('managed reconnect status hides the QR even when its page is HTTPS', async () => {
  window.location.origin = 'https://session.trycloudflare.com';
  fetch.mockResolvedValueOnce(response({ origin: window.location.origin, status: 'ready' }))
    .mockResolvedValue(response({ origin: window.location.origin, status: 'reconnecting' }));
  expect((await mount()).status).toBe('ready');
  await vi.advanceTimersByTimeAsync(10000);
  expect(read()).toEqual({ url: null, loading: false, status: 'reconnecting' });
});

test.each(['connecting', 'unavailable'])('a %s phone link exposes the ready QR at the next one-second check', async status => {
  fetch.mockResolvedValueOnce(response({origin: null, status}))
    .mockResolvedValue(response({origin: 'https://session.trycloudflare.com', status: 'ready'}));
  expect(await mount()).toEqual({url: null, loading: false, status});
  await vi.advanceTimersByTimeAsync(999);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(read().url).toBeNull();
  await vi.advanceTimersByTimeAsync(1);
  expect(read()).toEqual({url: 'https://session.trycloudflare.com/join?code=SOLO', loading: false, status: 'ready'});
  expect(fetch).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(9999);
  expect(fetch).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(1);
  expect(fetch).toHaveBeenCalledTimes(3);
});

test.each([
  {origin: 'https://session.trycloudflare.com', status: 'ready'},
  {origin: null, status: 'local'},
])('healthy $status discovery keeps the ten-second poll interval', async data => {
  fetch.mockResolvedValue(response(data));
  await mount();
  await vi.advanceTimersByTimeAsync(9999);
  expect(fetch).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(fetch).toHaveBeenCalledTimes(2);
});

test('managed reconnect hides the QR and checks every second until its URL is usable again', async () => {
  window.location.origin = 'https://session.trycloudflare.com';
  fetch.mockResolvedValueOnce(response({origin: window.location.origin, status: 'ready'}))
    .mockResolvedValueOnce(response({origin: window.location.origin, status: 'reconnecting'}))
    .mockResolvedValueOnce(response({origin: window.location.origin, status: 'reconnecting'}))
    .mockResolvedValue(response({origin: window.location.origin, status: 'ready'}));
  await mount();
  await vi.advanceTimersByTimeAsync(10000);
  expect(read()).toEqual({url: null, loading: false, status: 'reconnecting'});
  await vi.advanceTimersByTimeAsync(1000);
  expect(fetch).toHaveBeenCalledTimes(3);
  expect(read().url).toBeNull();
  await vi.advanceTimersByTimeAsync(1000);
  expect(fetch).toHaveBeenCalledTimes(4);
  expect(read().url).toBe('https://session.trycloudflare.com/join?code=SOLO');
  await vi.advanceTimersByTimeAsync(9999);
  expect(fetch).toHaveBeenCalledTimes(4);
});

test('a retained secure URL after a failed poll stays on the healthy interval', async () => {
  fetch.mockResolvedValueOnce(response({origin: 'https://session.trycloudflare.com', status: 'ready'}))
    .mockRejectedValue(new Error('Temporary disconnect'));
  const ready = await mount();
  await vi.advanceTimersByTimeAsync(10000);
  expect(read()).toEqual(ready);
  await vi.advanceTimersByTimeAsync(9999);
  expect(fetch).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(1);
  expect(fetch).toHaveBeenCalledTimes(3);
});

test('a slow readiness request cannot overlap a faster retry and unmount clears its timeout', async () => {
  let finish;
  fetch.mockResolvedValueOnce(response({origin: null, status: 'connecting'}))
    .mockImplementationOnce(() => new Promise(resolve => {finish = resolve;}));
  await mount();
  await vi.advanceTimersByTimeAsync(1000);
  const signal = fetch.mock.calls[1][1].signal;
  await vi.advanceTimersByTimeAsync(3000);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(signal.aborted).toBe(false);
  const stateBeforeUnmount = [...hooks.states];
  cleanup(); cleanup = null;
  expect(signal.aborted).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
  finish(response({origin: 'https://session.trycloudflare.com', status: 'ready'}));
  await vi.advanceTimersByTimeAsync(20000);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(hooks.states).toEqual(stateBeforeUnmount);
});

test('unmount cancels a scheduled fast readiness check', async () => {
  fetch.mockResolvedValue(response({origin: null, status: 'connecting'}));
  await mount();
  cleanup(); cleanup = null;
  await vi.advanceTimersByTimeAsync(10000);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});
