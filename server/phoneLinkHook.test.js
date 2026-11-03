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
vi.mock('../client/src/lib/joinUrl.js', () => ({
  joinOrigin: () => window.location.origin,
  joinUrl: (code, origin) => `${origin}/join?code=${code}`,
}));
import { usePhoneLink } from '../client/src/lib/usePhoneLink.js';

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
