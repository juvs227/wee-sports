import { describe, expect, it, vi } from 'vitest';
import { enterFullscreen, exitFullscreen, fullscreenElement } from '../client/src/lib/fullscreen.js';

describe('host fullscreen request', () => {
  it('requests synchronously in the user gesture, before waiting for a server start', async () => {
    const doc = { fullscreenElement: null, documentElement: {} };
    doc.documentElement.requestFullscreen = vi.fn(function () { doc.fullscreenElement = this; return Promise.resolve(); });
    const pending = enterFullscreen(doc);
    expect(doc.documentElement.requestFullscreen).toHaveBeenCalledOnce();
    expect(await pending).toBe(true);
    doc.exitFullscreen = vi.fn(() => { doc.fullscreenElement = null; });
    await exitFullscreen(doc);
    expect(doc.exitFullscreen).toHaveBeenCalledOnce();
    expect(fullscreenElement(doc)).toBe(null);
  });

  it('allows the game to start when the browser denies or does not support fullscreen', async () => {
    const denied = { documentElement: { requestFullscreen: () => Promise.reject(new Error('Denied')) } };
    expect(await enterFullscreen(denied)).toBe(false);
    expect(await enterFullscreen({ documentElement: {} })).toBe(false);
    expect(await exitFullscreen(denied)).toBeUndefined();
  });

  it('supports Safari’s prefixed API and safely exits an already ended session', async () => {
    const doc = { webkitFullscreenElement: null, documentElement: {} };
    doc.documentElement.webkitRequestFullscreen = function () { doc.webkitFullscreenElement = this; };
    expect(await enterFullscreen(doc)).toBe(true);
    doc.webkitExitFullscreen = vi.fn(() => { doc.webkitFullscreenElement = null; });
    await exitFullscreen(doc);
    await exitFullscreen(doc);
    expect(doc.webkitExitFullscreen).toHaveBeenCalledOnce();
  });
});
