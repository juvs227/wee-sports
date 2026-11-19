import { describe, expect, it, vi } from 'vitest';
import { canEnterFullscreen, enterFullscreen, exitFullscreen, fullscreenElement, isFullscreenStartGesture,
  listenForFullscreenStart, observeAutomaticFullscreen } from '@client/lib/fullscreen.js';

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

  it('retries a remote-start denial synchronously on the first local gesture', async () => {
    let hasLocalGesture = false;
    const doc = { fullscreenElement: null, fullscreenEnabled: true, documentElement: {} };
    doc.documentElement.requestFullscreen = vi.fn(function () {
      if (!hasLocalGesture) return Promise.reject(new Error('User activation required'));
      doc.fullscreenElement = this;
      return Promise.resolve();
    });
    expect(await enterFullscreen(doc)).toBe(false);
    expect(canEnterFullscreen(doc)).toBe(true);
    hasLocalGesture = true;
    const retry = enterFullscreen(doc);
    expect(doc.documentElement.requestFullscreen).toHaveBeenCalledTimes(2);
    expect(await retry).toBe(true);
  });

  it('does not offer unsupported or policy-disabled fullscreen as an available action', async () => {
    const requestFullscreen = vi.fn();
    const policyDisabled = { fullscreenEnabled: false, documentElement: { requestFullscreen } };
    expect(canEnterFullscreen(policyDisabled)).toBe(false);
    expect(await enterFullscreen(policyDisabled)).toBe(false);
    expect(requestFullscreen).not.toHaveBeenCalled();
    expect(canEnterFullscreen({ documentElement: {} })).toBe(false);
    expect(canEnterFullscreen({ webkitFullscreenEnabled: false, documentElement: { webkitRequestFullscreen: vi.fn() } })).toBe(false);
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

  it('waits for asynchronous WebKit entry instead of treating a void return as failure', async () => {
    const doc = new EventTarget();
    doc.documentElement = {};
    doc.webkitFullscreenElement = null;
    doc.documentElement.webkitRequestFullscreen = vi.fn();
    const removed = vi.spyOn(doc, 'removeEventListener');
    const settled = vi.fn();
    const pending = enterFullscreen(doc);
    pending.then(settled);
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();
    expect(enterFullscreen(doc)).toBe(pending);
    expect(doc.documentElement.webkitRequestFullscreen).toHaveBeenCalledOnce();
    doc.webkitFullscreenElement = doc.documentElement;
    doc.dispatchEvent(new Event('webkitfullscreenchange'));
    expect(await pending).toBe(true);
    expect(removed.mock.calls.map(([name]) => name)).toEqual([
      'fullscreenchange', 'webkitfullscreenchange', 'fullscreenerror', 'webkitfullscreenerror',
    ]);
  });

  it('handles WebKit denial and allows the next real gesture to retry', async () => {
    const doc = new EventTarget();
    doc.documentElement = { webkitRequestFullscreen: vi.fn() };
    const first = enterFullscreen(doc);
    doc.dispatchEvent(new Event('webkitfullscreenerror'));
    expect(await first).toBe(false);
    const next = enterFullscreen(doc);
    expect(doc.documentElement.webkitRequestFullscreen).toHaveBeenCalledTimes(2);
    doc.webkitFullscreenElement = doc.documentElement;
    doc.dispatchEvent(new Event('webkitfullscreenchange'));
    expect(await next).toBe(true);
  });

  it('bounds a silent legacy WebKit request and cleans up its event listeners', async () => {
    vi.useFakeTimers();
    try {
      const doc = new EventTarget();
      doc.documentElement = { webkitRequestFullscreen: vi.fn() };
      const removed = vi.spyOn(doc, 'removeEventListener');
      const pending = enterFullscreen(doc);
      await vi.advanceTimersByTimeAsync(1500);
      expect(await pending).toBe(false);
      expect(removed).toHaveBeenCalledTimes(4);
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });

  it('supports older WebKit spelling and keeps policy-disabled entry unavailable', async () => {
    const doc = { webkitCurrentFullScreenElement: null, documentElement: {} };
    doc.documentElement.webkitRequestFullScreen = vi.fn(function () { doc.webkitCurrentFullScreenElement = this; });
    expect(canEnterFullscreen(doc)).toBe(true);
    expect(await enterFullscreen(doc)).toBe(true);
    doc.webkitCancelFullScreen = vi.fn(() => { doc.webkitCurrentFullScreenElement = null; });
    await exitFullscreen(doc);
    expect(doc.webkitCancelFullScreen).toHaveBeenCalledOnce();
    expect(fullscreenElement(doc)).toBe(null);
    doc.fullscreenEnabled = false;
    expect(await enterFullscreen(doc)).toBe(false);
    expect(doc.documentElement.webkitRequestFullScreen).toHaveBeenCalledOnce();
  });

  it('coalesces an in-flight entry and allows a fresh gesture after rejection', async () => {
    let reject;
    const doc = {fullscreenElement:null,documentElement:{requestFullscreen:vi.fn(() => new Promise((_,fail) => {reject = fail;}))}};
    const first = enterFullscreen(doc), second = enterFullscreen(doc);
    expect(second).toBe(first);
    expect(doc.documentElement.requestFullscreen).toHaveBeenCalledOnce();
    reject(new Error('User activation required'));
    expect(await first).toBe(false);
    doc.documentElement.requestFullscreen.mockImplementation(function () {doc.fullscreenElement=this;});
    expect(await enterFullscreen(doc)).toBe(true);
    expect(doc.documentElement.requestFullscreen).toHaveBeenCalledTimes(2);
  });

  it('retries only a real stage tap or remote Enter, leaving menus and Escape alone', () => {
    const event = {type:'keydown',key:'Enter',isTrusted:true,target:{closest:() => null}};
    expect(isFullscreenStartGesture(event)).toBe(true);
    expect(isFullscreenStartGesture({...event,type:'click',key:undefined})).toBe(true);
    for (const change of [{isTrusted:false},{key:'Escape'},{key:'P'},{repeat:true},{defaultPrevented:true},
      {altKey:true},{ctrlKey:true},{metaKey:true},{target:{closest:() => ({})}}]) {
      expect(isFullscreenStartGesture({...event,...change})).toBe(false);
    }
  });

  it('listens inside the game iframe, replaces old documents and removes all listeners', () => {
    const target = () => ({listeners:new Map(),addEventListener(name,fn){this.listeners.set(name,fn);},removeEventListener(name){this.listeners.delete(name);}});
    const doc=target(),first=target(),second=target(),frame={contentDocument:first},start=vi.fn();
    doc.querySelector=()=>frame;
    const stop=listenForFullscreenStart(doc,start);
    const enter={type:'keydown',key:'Enter',isTrusted:true,target:{closest:()=>null}};
    first.listeners.get('keydown')(enter);
    expect(start).toHaveBeenCalledOnce();
    first.listeners.get('keydown')({...enter,isTrusted:false});
    expect(start).toHaveBeenCalledOnce();
    frame.contentDocument=second;doc.listeners.get('load')({target:frame});
    expect(first.listeners.size).toBe(0);
    second.listeners.get('click')({...enter,type:'click'});
    expect(start).toHaveBeenCalledTimes(2);
    stop();expect(doc.listeners.size).toBe(0);expect(second.listeners.size).toBe(0);
  });

  it('does not read or listen inside a cross-origin frame', () => {
    const doc=new EventTarget();
    doc.querySelector=()=>({get contentDocument(){throw new Error('Cross-origin');}});
    const stop=listenForFullscreenStart(doc,vi.fn());
    expect(stop).toBeTypeOf('function');stop();
  });

  it('uses an existing automatic fullscreen permission and observes grants without requesting one', async () => {
    const status=new EventTarget();status.state='denied';
    const granted=vi.fn(),query=vi.fn(async()=>status);
    const stop=observeAutomaticFullscreen({defaultView:{navigator:{permissions:{query}}}},granted);
    await Promise.resolve();
    expect(query).toHaveBeenCalledExactlyOnceWith({name:'fullscreen',allowWithoutGesture:true});
    expect(granted).not.toHaveBeenCalled();
    status.state='granted';status.dispatchEvent(new Event('change'));
    expect(granted).toHaveBeenCalledOnce();
    stop();status.dispatchEvent(new Event('change'));
    expect(granted).toHaveBeenCalledOnce();
  });

  it('ignores a late automatic permission reply after the game has left', async () => {
    let reply;
    const granted=vi.fn(),status={state:'granted',addEventListener:vi.fn()};
    const stop=observeAutomaticFullscreen({defaultView:{navigator:{permissions:{query:()=>new Promise(resolve=>{reply=resolve;})}}}},granted);
    stop();reply(status);await Promise.resolve();
    expect(granted).not.toHaveBeenCalled();expect(status.addEventListener).not.toHaveBeenCalled();
  });

  it('keeps the gesture fallback when automatic permission lookup is unsupported', async () => {
    const granted=vi.fn();
    expect(observeAutomaticFullscreen({},granted)).toBeTypeOf('function');
    observeAutomaticFullscreen({defaultView:{navigator:{permissions:{query:()=>{throw new TypeError('Unsupported');}}}}},granted)();
    observeAutomaticFullscreen({defaultView:{navigator:{permissions:{query:()=>Promise.reject(new TypeError('Unsupported'))}}}},granted)();
    await Promise.resolve();await Promise.resolve();expect(granted).not.toHaveBeenCalled();
  });
});
