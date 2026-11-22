import {afterEach, expect, test, vi} from 'vitest';
import {createControllerSetupRelay} from '@client/lib/controllerSetupRelay.js';
import {createWebMotionAdapter} from '@wee/src/controller/webMotionAdapter.js';

afterEach(() => vi.useRealTimers());
function relayFixture() {
  vi.useFakeTimers();
  const request = vi.fn(async () => ({ok: true}));
  let visible = true;
  const relay = createControllerSetupRelay({request, visible: () => visible});
  return {relay, request, hide: () => {visible = false; relay.flush();}};
}

test('brief visible sensor gaps never revoke the acknowledged room setup', async () => {
  const f = relayFixture();
  await f.relay.submit('motion');
  const gap = f.relay.submit(null);
  await vi.advanceTimersByTimeAsync(400);
  expect(f.request.mock.calls).toEqual([['motion']]);
  await f.relay.submit('motion');
  expect(await gap).toEqual({ok: false, error: 'setup-superseded'});
  await vi.advanceTimersByTimeAsync(2000);
  expect(f.request.mock.calls).toEqual([['motion'], ['motion']]);
});

test('sustained silence revokes setup; initial setup and true background never wait', async () => {
  const f = relayFixture();
  await f.relay.submit(null);
  expect(f.request).toHaveBeenLastCalledWith(null);
  await f.relay.submit('motion');
  const silence = f.relay.submit(null);
  await vi.advanceTimersByTimeAsync(1500);
  expect(await silence).toEqual({ok: true});
  expect(f.request).toHaveBeenLastCalledWith(null);
  await f.relay.submit('motion');
  const background = f.relay.submit(null);
  f.hide();
  expect(await background).toEqual({ok: true});
  expect(f.request).toHaveBeenLastCalledWith(null);
});

test('iframe background/reset signals bypass grace and a departed bridge cannot revoke the next seat', async () => {
  const f = relayFixture();
  await f.relay.submit('motion');
  await f.relay.submit(null, {immediate: true});
  expect(f.request).toHaveBeenLastCalledWith(null);
  await f.relay.submit('motion');
  const stale = f.relay.submit(null);
  f.relay.reset();
  expect((await stale).error).toBe('setup-superseded');
  await vi.advanceTimersByTimeAsync(2000);
  expect(f.request.mock.calls).toEqual([['motion'], [null], ['motion']]);
});

test('scroll, blur, resize and redundant pageshow/visibility events do not reset a live sensor stream', async () => {
  const target = new EventTarget(), document = new EventTarget();
  Object.assign(target, {isSecureContext: true, DeviceMotionEvent: {}, screen: {orientation: {angle: 0}}});
  document.hidden = false;
  const onSample = vi.fn(), onReset = vi.fn();
  const adapter = createWebMotionAdapter({target, document, onSample, onReset});
  await adapter.start();
  for (const kind of ['scroll', 'blur', 'resize', 'pageshow']) target.dispatchEvent(new Event(kind));
  document.dispatchEvent(new Event('visibilitychange'));
  target.dispatchEvent(Object.assign(new Event('devicemotion'), {rotationRate: {alpha: 3, beta: 0, gamma: 0}}));
  expect(onSample).toHaveBeenCalledTimes(1);
  expect(onReset).not.toHaveBeenCalled();
  target.dispatchEvent(new Event('pagehide'));
  expect(onReset).toHaveBeenLastCalledWith('pagehide');
  target.dispatchEvent(new Event('pageshow'));
  expect(onReset).toHaveBeenLastCalledWith('pageshow');
  adapter.dispose();
});
