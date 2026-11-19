import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {afterEach, beforeEach, expect, test, vi} from 'vitest';

const h = vi.hoisted(() => ({spawn: vi.fn(), health: vi.fn()}));
vi.mock('node:child_process', () => ({spawn: h.spawn}));
vi.mock('../../scripts/phone-session.mjs', async importOriginal => {
  const actual = await importOriginal();
  return {...actual, waitForGameServer: (...args) => h.health(...args) ?? actual.waitForGameServer(...args)};
});

let children, signals, startup, originalExitCode, publicHealth, healthRequested;
const origin = 'https://startup-test.trycloudflare.com';
const deferred = () => {
  let resolve;
  const promise = new Promise(done => {resolve = done;});
  return {promise, resolve};
};

class Child extends EventEmitter {
  constructor(kind) {
    super();
    this.kind = kind;
    this.stdout = new PassThrough();
    this.stderr = new PassThrough();
    this.exitCode = null;
    this.signalCode = null;
    this.connected = kind === 'server';
    this.send = vi.fn((_message, callback) => callback?.());
    this.kill = vi.fn(signal => {
      if (this.exitCode !== null || this.signalCode !== null) return false;
      this.finish(null, signal);
      return true;
    });
  }
  finish(code = 0, signal = null) {
    this.exitCode = code;
    this.signalCode = signal;
    this.connected = false;
    this.emit('exit', code, signal);
    this.emit('close', code, signal);
  }
}

const child = kind => children.find(value => value.kind === kind);
const announceOrigin = () => child('tunnel').stderr.write(`Your quick Tunnel: ${origin}\n`);

beforeEach(() => {
  vi.resetModules();
  children = []; signals = new Map(); startup = null;
  originalExitCode = process.exitCode;
  publicHealth = deferred(); healthRequested = false;
  vi.stubEnv('PORT', '5299');
  const once = process.once.bind(process);
  vi.spyOn(process, 'once').mockImplementation((event, callback) => {
    if (event === 'SIGINT' || event === 'SIGTERM') {signals.set(event, callback); return process;}
    return once(event, callback);
  });
  vi.spyOn(process, 'exit').mockImplementation(() => {throw new Error('Intercepted launcher exit');});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  h.health.mockReset();
  h.spawn.mockReset();
  h.spawn.mockImplementation((_command, args) => {
    const kind = args[0] === '--version' ? 'version' : args[0] === 'tunnel' ? 'tunnel'
      : args[0] === 'run' ? 'build' : 'server';
    const value = new Child(kind); children.push(value);
    if (kind === 'version') queueMicrotask(() => value.finish());
    return value;
  });
  vi.stubGlobal('fetch', vi.fn(async url => {
    if (String(url).startsWith(origin)) {healthRequested = true; return publicHealth.promise;}
    // The first local request is the port-availability check. A health check
    // can succeed only after the launcher has spawned the built preview.
    return {ok: Boolean(child('server')), text: async () => 'ok'};
  }));
});

afterEach(async () => {
  publicHealth.resolve({ok: true, text: async () => 'ok'});
  signals.get('SIGTERM')?.();
  await startup;
  for (const value of children) {value.stdout.destroy(); value.stderr.destroy();}
  process.exitCode = originalExitCode;
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers();
});

async function begin() {
  startup = import('../../scripts/dev-phone.mjs');
  await vi.waitFor(() => expect(child('build')).toBeDefined());
  await vi.waitFor(() => expect(child('tunnel')).toBeDefined());
}

test('tunnel provisioning overlaps the build but a URL cannot start the server or advertise an unchecked QR', async () => {
  await begin();
  expect(child('build').exitCode).toBeNull();
  announceOrigin();
  await Promise.resolve();
  expect(child('server')).toBeUndefined();
  child('build').finish();
  await vi.waitFor(() => expect(healthRequested).toBe(true));
  const serverCall = h.spawn.mock.calls.find(([, args]) => args[0] === 'server/main.js');
  expect(serverCall[1]).toEqual(['server/main.js', '--preview']);
  expect(serverCall[2].env).toMatchObject({PUBLIC_GAME_URL: origin, PHONE_LINK_MANAGED: '1', WEE_BUILD_DIR: '.phone-build'});
  expect(child('server').send.mock.calls.some(([message]) => message.status === 'ready')).toBe(false);
  publicHealth.resolve({ok: true, text: async () => 'ok'});
  await startup;
  expect(child('server').send).toHaveBeenCalledWith({type: 'phone-link-status', status: 'ready'}, expect.any(Function));
});

test('a completed build still waits for a tunnel origin before starting the combined server', async () => {
  await begin();
  child('build').finish();
  await Promise.resolve();
  expect(child('server')).toBeUndefined();
  announceOrigin();
  publicHealth.resolve({ok: true, text: async () => 'ok'});
  await startup;
  expect(child('server')).toBeDefined();
});

test('a failed build stops the parallel tunnel and never serves a stale build', async () => {
  await begin();
  announceOrigin();
  child('build').finish(1);
  await startup;
  expect(child('server')).toBeUndefined();
  expect(child('tunnel').kill).toHaveBeenCalled();
  expect(process.exitCode).toBe(1);
});

test.each([
  {announced: false, event: 'exit'}, {announced: true, event: 'exit'},
  {announced: false, event: 'error'}, {announced: true, event: 'error'},
])('tunnel $event with URL already announced=$announced stops a pending build without starting the server', async ({announced, event}) => {
  await begin();
  if (announced) announceOrigin();
  if (event === 'exit') child('tunnel').finish(1);
  else child('tunnel').emit('error', new Error('Tunnel startup failed'));
  await startup;
  expect(child('server')).toBeUndefined();
  expect(child('build').kill).toHaveBeenCalled();
  expect(process.exitCode).toBe(1);
});

test('shutdown while the build and tunnel are pending cleans up both without starting a server', async () => {
  await begin();
  signals.get('SIGINT')();
  await startup;
  expect(child('build').kill).toHaveBeenCalled();
  expect(child('tunnel').kill).toHaveBeenCalled();
  expect(child('server')).toBeUndefined();
  expect(process.exitCode).toBe(0);
});

test('a stopped tunnel after startup removes the phone link while keeping the local TV running', async () => {
  await begin();
  announceOrigin(); child('build').finish();
  publicHealth.resolve({ok: true, text: async () => 'ok'});
  await startup;
  child('tunnel').finish(1);
  expect(child('server').send).toHaveBeenLastCalledWith({type: 'phone-link-status', status: 'unavailable'}, expect.any(Function));
  expect(child('server').kill).not.toHaveBeenCalled();
  expect(process.exitCode).toBe(originalExitCode);
});

test('unhealthy public discovery retries after one second, then healthy monitoring returns to fifteen seconds', async () => {
  vi.useFakeTimers();
  let checks = 0;
  // The helper's timeout/abort behavior is tested independently. Here control
  // only its outcomes so the actual launcher's retry scheduling is exercised.
  h.health.mockImplementation(url => {
    if (!url.startsWith(origin)) return Promise.resolve();
    checks++;
    return checks === 1 ? Promise.reject(new Error('Public link still connecting')) : Promise.resolve();
  });
  await begin();
  announceOrigin(); child('build').finish();
  await startup;
  expect(checks).toBe(1);
  expect(child('server').send).toHaveBeenLastCalledWith({type: 'phone-link-status', status: 'reconnecting'}, expect.any(Function));
  await vi.advanceTimersByTimeAsync(999);
  expect(checks).toBe(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(checks).toBe(2);
  expect(child('server').send).toHaveBeenLastCalledWith({type: 'phone-link-status', status: 'ready'}, expect.any(Function));
  await vi.advanceTimersByTimeAsync(14999);
  expect(checks).toBe(2);
  await vi.advanceTimersByTimeAsync(1);
  expect(checks).toBe(3);
});
