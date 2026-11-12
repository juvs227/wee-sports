import {afterEach, beforeEach, expect, test, vi} from 'vitest';

const hook = vi.hoisted(() => ({store: null}));
vi.mock('react', () => ({useSyncExternalStore(subscribe, snapshot) {
  hook.store = {subscribe, snapshot};
  return snapshot();
}}));

let useIslandMotion, query, readMatches, actualReduced, pendingChange, cleanups, storage;
function mediaChanges(value) {actualReduced = value; pendingChange = true;}
function deliverMediaChange() {
  if (!pendingChange) return false;
  pendingChange = false;
  query.dispatchEvent(Object.assign(new Event('change'), {matches: actualReduced}));
  return true;
}
function subscribe(listener = vi.fn()) {
  cleanups.push(hook.store.subscribe(listener));
  return listener;
}
beforeEach(async () => {
  vi.resetModules(); cleanups = []; storage = new Map(); actualReduced = false; pendingChange = false;
  query = new EventTarget();
  // Chromium can consume a queued media transition when matches is sampled
  // during a render, before dispatching its change event. Model that observed
  // browser behavior so every subscriber must receive the same transition.
  readMatches = vi.fn(() => {pendingChange = false; return actualReduced;});
  Object.defineProperty(query, 'matches', {get: readMatches});
  vi.spyOn(query, 'addEventListener'); vi.spyOn(query, 'removeEventListener');
  const documentTarget = Object.assign(new EventTarget(), {hidden: false});
  const windowTarget = Object.assign(new EventTarget(), {
    matchMedia: vi.fn(() => query),
    localStorage: {getItem: vi.fn(key => storage.get(key) ?? null), setItem: vi.fn((key, value) => storage.set(key, value))},
  });
  vi.stubGlobal('window', windowTarget); vi.stubGlobal('document', documentTarget);
  ({useIslandMotion} = await import('@client/lib/useIslandMotion.js'));
  useIslandMotion();
});
afterEach(() => {cleanups.forEach(cleanup => cleanup()); vi.unstubAllGlobals();});

test('render snapshots cannot consume a pending media transition before all subscribers are notified', () => {
  const first = subscribe(), second = subscribe();
  mediaChanges(true);
  hook.store.snapshot(); hook.store.snapshot();
  expect(deliverMediaChange()).toBe(true);
  expect(first).toHaveBeenCalledOnce(); expect(second).toHaveBeenCalledOnce();
  expect(useIslandMotion()).toMatchObject({enabled: false, preference: true, reducedMotion: true});
  mediaChanges(false); hook.store.snapshot();
  expect(deliverMediaChange()).toBe(true);
  expect(first).toHaveBeenCalledTimes(2); expect(second).toHaveBeenCalledTimes(2);
  expect(useIslandMotion().enabled).toBe(true);
});

test('native media events publish their matches value without resampling a live query', () => {
  const listener = subscribe(); readMatches.mockClear();
  query.dispatchEvent(Object.assign(new Event('change'), {matches: true}));
  expect(listener).toHaveBeenCalledOnce();
  expect(useIslandMotion().reducedMotion).toBe(true);
  expect(readMatches).not.toHaveBeenCalled();
});

test('the first subscription reconciles settings changed while the island was unmounted', () => {
  const first = subscribe(); cleanups.pop()();
  expect(query.removeEventListener).toHaveBeenCalledWith('change', expect.any(Function));
  mediaChanges(true);
  subscribe();
  expect(useIslandMotion()).toMatchObject({enabled: false, reducedMotion: true});
  expect(first).not.toHaveBeenCalled();
  expect(query.addEventListener).toHaveBeenCalledTimes(2);
});

test('a local toggle publishes any newly observed system preference to every subscriber', () => {
  const first = subscribe(), second = subscribe();
  useIslandMotion().setEnabled(false); first.mockClear(); second.mockClear();
  mediaChanges(true);
  useIslandMotion().setEnabled(true);
  expect(storage.get('wee:island-motion')).toBe('on');
  expect(first).toHaveBeenCalledOnce(); expect(second).toHaveBeenCalledOnce();
  expect(useIslandMotion()).toMatchObject({enabled: false, preference: true, reducedMotion: true});
});

test('visibility reconciliation updates the media preference while stopping and resuming motion', () => {
  const listener = subscribe();
  document.hidden = true;
  document.dispatchEvent(new Event('visibilitychange'));
  expect(useIslandMotion().enabled).toBe(false);
  mediaChanges(true); document.hidden = false;
  document.dispatchEvent(new Event('visibilitychange'));
  expect(useIslandMotion()).toMatchObject({enabled: false, reducedMotion: true});
  mediaChanges(false); document.dispatchEvent(new Event('visibilitychange'));
  expect(useIslandMotion().enabled).toBe(true);
  expect(listener).toHaveBeenCalledTimes(3);
});

test('cross-tab storage reconciliation publishes both the local and system settings once', () => {
  const listener = subscribe();
  storage.set('wee:island-motion', 'off'); mediaChanges(true);
  window.dispatchEvent(Object.assign(new Event('storage'), {key: 'wee:island-motion'}));
  expect(useIslandMotion()).toMatchObject({enabled: false, preference: false, reducedMotion: true});
  expect(listener).toHaveBeenCalledOnce();
  window.dispatchEvent(Object.assign(new Event('storage'), {key: 'unrelated'}));
  expect(listener).toHaveBeenCalledOnce();
});

test('shared listeners survive one unmount and are removed after the last subscriber', () => {
  const first = subscribe(), second = subscribe();
  expect(query.addEventListener).toHaveBeenCalledTimes(1);
  cleanups.shift()();
  expect(query.removeEventListener).not.toHaveBeenCalled();
  mediaChanges(true); deliverMediaChange();
  expect(first).not.toHaveBeenCalled(); expect(second).toHaveBeenCalledOnce();
  cleanups.shift()();
  expect(query.removeEventListener).toHaveBeenCalledTimes(1);
});
