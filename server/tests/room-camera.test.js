import {afterEach, expect, test, vi} from 'vitest';
import {startRoomCamera} from '@client/lib/roomScan.js';
afterEach(() => vi.unstubAllGlobals());
function environment(getUserMedia) {
  vi.stubGlobal('navigator', {mediaDevices: {getUserMedia}});
  vi.stubGlobal('isSecureContext', true);
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.stubGlobal('requestAnimationFrame', vi.fn());
  return {srcObject: null, play: vi.fn(async () => {})};
}

test('an insecure camera request uses a friendly fallback without asking for device access', async () => {
  const getUserMedia = vi.fn(), video = environment(getUserMedia), onError = vi.fn();
  vi.stubGlobal('isSecureContext', false);
  startRoomCamera(video, {onError});
  await Promise.resolve();
  expect(getUserMedia).not.toHaveBeenCalled();
  expect(onError).toHaveBeenCalledWith(expect.stringContaining('secure connection'));
});

test('closing during the browser camera permission prompt stops a late-granted stream', async () => {
  let grant;
  const video = environment(vi.fn(() => new Promise(resolve => {grant = resolve;})));
  const track = {stop: vi.fn()}, onReady = vi.fn(), onError = vi.fn();
  const stop = startRoomCamera(video, {onReady, onError});
  stop(); grant({getTracks: () => [track]});
  await Promise.resolve(); await Promise.resolve();
  expect(track.stop).toHaveBeenCalledOnce();
  expect(video.play).not.toHaveBeenCalled(); expect(onReady).not.toHaveBeenCalled(); expect(onError).not.toHaveBeenCalled();
});
