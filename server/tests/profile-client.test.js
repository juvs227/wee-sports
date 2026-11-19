import {afterEach, beforeEach, expect, test, vi} from 'vitest';
import {claimGuestHistory, profileRequest} from '@client/lib/profile.js';

beforeEach(() => {vi.useFakeTimers(); vi.stubGlobal('fetch', vi.fn());});
afterEach(() => {vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals();});

const waitForAbort = signal => new Promise((resolve, reject) => {
  const rejectAbort = () => reject(new DOMException('Aborted', 'AbortError'));
  if (signal?.aborted) rejectAbort();
  else signal?.addEventListener('abort', rejectAbort, {once: true});
});

test.each(['headers', 'body'])('a stalled profile %s request ends with a retryable error', async stage => {
  let requestSignal;
  fetch.mockImplementation((url, {signal}) => {
    requestSignal = signal;
    return stage === 'headers' ? waitForAbort(signal) : Promise.resolve({ok: true, json: () => waitForAbort(signal)});
  });
  let outcome;
  const request = profileRequest().then(value => {outcome = value;}, error => {outcome = error;});
  await vi.advanceTimersByTimeAsync(10000);
  expect(outcome?.message).toBe('profile-timeout');
  expect(requestSignal.aborted).toBe(true);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
  await request;
});

test('leaving the profile page aborts its request and releases the deadline', async () => {
  fetch.mockImplementation((url, {signal}) => waitForAbort(signal));
  const controller = new AbortController();
  const result = profileRequest('', {signal: controller.signal}).catch(error => error);
  controller.abort();
  expect((await result).name).toBe('AbortError');
  expect(vi.getTimerCount()).toBe(0);
});

test('successful requests and acknowledged errors retain their status without retrying', async () => {
  const profile = {username: 'player'};
  fetch.mockResolvedValueOnce({ok: true, json: async () => ({profile})})
    .mockResolvedValueOnce({ok: false, status: 401, json: async () => ({error: 'invalid-login'})});
  expect(await profileRequest('/login', {method: 'POST', body: {username: 'player', password: 'example-only'}})).toEqual({profile});
  await expect(profileRequest()).rejects.toMatchObject({message: 'invalid-login', status: 401});
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(vi.getTimerCount()).toBe(0);
});

test('guest-claim sync stops after a connection failure and retains unsubmitted ownership proofs', async () => {
  const claims = ['a'.repeat(43), 'b'.repeat(43), 'c'.repeat(43)];
  let stored = JSON.stringify(claims);
  vi.stubGlobal('sessionStorage', {getItem: () => stored, setItem: (key, value) => {stored = value;}});
  fetch.mockResolvedValueOnce({ok: false, status: 403, json: async () => ({error: 'expired-claim'})})
    .mockRejectedValue(new TypeError('Network unavailable'));
  await claimGuestHistory();
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(JSON.parse(stored)).toEqual(claims.slice(1));
});
