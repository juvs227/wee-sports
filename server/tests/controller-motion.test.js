import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createCalibrationMemory, CALIBRATION_STORAGE_KEY } from '@wee/src/controller/calibrationMemory.js';

const relay = vi.hoisted(() => ({ sendSwing: vi.fn(() => true), options: null }));
vi.mock('@wee/src/theme.js', () => ({}));
vi.mock('@wee/src/network/swingConnection.js', () => ({ connectSwings: options => { relay.options = options; return relay; } }));
let elements;
let listeners;
let documentListeners;
let messages;
let now;
let parent;
let permission;

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  relay.sendSwing.mockClear();
  now = 0;
  elements = new Map();
  listeners = new Map();
  documentListeners = new Map();
  messages = [];
  parent = { postMessage: data => messages.push(data) };
  permission = vi.fn(async () => 'granted');
  const motionAPI = { requestPermission: permission };
  const stored = new Map();
  const sessionStorage = { getItem: key => stored.get(key) ?? null,
    setItem: (key, value) => stored.set(key, value), removeItem: key => stored.delete(key) };
  vi.stubGlobal('DeviceMotionEvent', motionAPI);
  vi.stubGlobal('window', { parent, sessionStorage, isSecureContext: true, DeviceMotionEvent: motionAPI,
    addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); },
    removeEventListener(type, fn) { listeners.get(type)?.delete(fn); },
  });
  vi.stubGlobal('document', { hidden: false,
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, { textContent: '', value: id === 'hand' ? 'Right' : id === 'response' ? 'fast' : id === 'stroke-mode' ? 'auto' : id === 'power' ? '0.7' : '0', checked: true, dataset: {} });
      return elements.get(id);
    },
    addEventListener(type, fn) { documentListeners.set(type, fn); },
  });
  vi.stubGlobal('performance', { now: () => now });
  vi.stubGlobal('location', { origin: 'https://example.test', search: '?room=lobby-ABCD&lobby=ABCD&player=1' });
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });
const emit = (type, data) => { for (const listener of listeners.get(type) ?? []) listener(data); };
const state = data => emit('message', { source: parent, origin: location.origin, data: { type: 'wee:lobby-state', connected: true, paused: true, playing: false, ...data } });
const tick = (ms = 20, rate = { alpha: 0.1, beta: -.1, gamma: .2 }, sensors = {}) => {
  now += ms;
  if (rate) emit('devicemotion', { rotationRate: rate, ...sensors });
  vi.advanceTimersByTime(ms);
};

test('phone diagnostics keep delivery and contact separate and ignore unrelated or replayed results', async () => {
  await import('@wee/src/controller/main.js');
  state({ gameId: 'match-a' }); elements.get('use-buttons').onclick();
  state({ playing: true, paused: false, gameId: 'match-a' });
  relay.options.onSent({ id: 'actual-stroke' });
  relay.options.onAck({ id: 'actual-stroke', ok: true, receivers: 1, roundTripMs: 80 });
  const result = data => emit('message', { source: parent, origin: location.origin,
    data: { type: 'wee:stroke-result', id: 'actual-stroke', gameId: 'match-a', player: 1,
      result: 'hit', reason: 'Good contact', receivedToContactMs: 70, ...data } });
  result({ player: 2 }); result({ gameId: 'old-match' }); result({ id: 'unknown-stroke' });
  expect(elements.get('timing-contact').textContent).toContain('waiting');
  result({}); result({});
  expect(elements.get('timing-delivery').textContent).toContain('median 80 ms');
  expect(elements.get('timing-contact').textContent).toContain('median 70 ms');
  expect(elements.get('timing-contact').textContent).toContain('1 sample');
  expect(elements.get('timing-details').hidden).toBe(true);
  elements.get('toggle-settings').onclick();
  expect(elements.get('timing-details').hidden).toBe(false);
  state({ playing: true, paused: false, gameId: 'match-b' });
  result({});
  expect(elements.get('timing-contact').textContent).toContain('waiting');
  relay.options.onAck({ id: 'actual-stroke', ok: false, error: 'timeout' });
  expect(elements.get('play-notice').textContent).not.toContain('not accepted');
});

test('a miss notice survives its delivery acknowledgement then clears from the play screen', async () => {
  await import('@wee/src/controller/main.js');
  state({ gameId: 'match-a' }); elements.get('use-buttons').onclick();
  state({ playing: true, paused: false, gameId: 'match-a' });
  relay.options.onSent({ id: 'missed-stroke' });
  emit('message', { source: parent, origin: location.origin, data: {
    type: 'wee:stroke-result', id: 'missed-stroke', gameId: 'match-a', player: 1,
    result: 'miss', reason: 'Ball already passed',
  } });
  relay.options.onAck({ id: 'missed-stroke', ok: true, receivers: 1, roundTripMs: 80 });
  expect(elements.get('play-notice').textContent).toBe('Ball already passed');
  tick(1900, null);
  expect(elements.get('play-notice').hidden).toBe(true);
  expect(elements.get('timing-result').textContent).toContain('Ball already passed');
  expect(elements.get('timing-contact').textContent).toContain('waiting');
});

test.each(['tennis', 'bowling'])('%s contact vibrates only its active phone from the trusted game bridge', async sport => {
  const vibrate = vi.fn(() => true);
  vi.stubGlobal('navigator', { vibrate, userActivation: { hasBeenActive: true } });
  location.search += `&sport=${sport}`;
  await import('@wee/src/controller/main.js');
  state({ paused: false });
  elements.get('use-buttons').onclick();
  const hit = (data = {}, envelope = {}) => emit('message', { source: parent, origin: location.origin,
    data: { type: 'wee:game-hit', player: 1, kind: sport, ...data }, ...envelope });
  hit();
  expect(vibrate).not.toHaveBeenCalled();
  state({ playing: true, paused: false });
  hit({ player: 2 });
  hit({ kind: sport === 'bowling' ? 'tennis' : 'bowling' });
  hit({}, { source: {} });
  hit({}, { origin: 'https://another-game.test' });
  expect(vibrate).not.toHaveBeenCalled();
  now = 1000;
  hit();
  expect(vibrate).toHaveBeenCalledExactlyOnceWith(sport === 'bowling' ? [35, 35, 55] : 40);
  state({ playing: true, paused: true });
  vibrate.mockClear();
  now += 1000;
  hit();
  expect(vibrate).not.toHaveBeenCalled();
});
async function calibrate() {
  await elements.get('calibrate').onclick();
  for (let i = 0; i < 110; i++) tick();
}

test('manual pause explains resume and preserves calibration; reconnect keeps its own cue', async () => {
  await import('@wee/src/controller/main.js');
  await calibrate();
  state({playing: true, paused: false, sport: 'tennis', gameId: 'match-a'});
  state({playing: true, paused: true, manuallyPaused: true, gameId: 'match-a'});
  expect(elements.get('play-help').textContent).toContain('resume');
  expect(elements.get('setup-panel').hidden).toBe(true);
  state({playing: true, paused: false, manuallyPaused: false, gameId: 'match-a'});
  expect(elements.get('setup-panel').hidden).toBe(true);
  expect(permission).toHaveBeenCalledOnce();
  state({playing: true, paused: true, manuallyPaused: false, gameId: 'match-a'});
  expect(elements.get('play-help').textContent).toContain('reconnect');
});


test('new address setup uses one permission tap then automatically verifies fresh still readings', async () => {
  await import('@wee/src/controller/main.js');
  expect(elements.get('calibrate').textContent).toBe('Enable motion');
  await elements.get('enable').onclick();
  expect(permission).toHaveBeenCalledOnce();
  expect(messages.filter(message => message.type === 'wee:controller-setup').at(-1)?.setup).toBeNull();
  for (let i = 0; i < 110; i++) tick();
  expect(messages.filter(message => message.type === 'wee:controller-setup').at(-1)?.setup).toBe('motion');
  expect(elements.get('setup-panel').hidden).toBe(true);
  expect(elements.get('strength-panel').hidden).toBe(true);
  elements.get('toggle-settings').onclick();
  expect(elements.get('strength-panel').hidden).toBe(false);
});

test('already permitted sensors can start initial setup without a separate calibration tap', async () => {
  await import('@wee/src/controller/main.js');
  for (let i = 0; i < 115; i++) tick();
  expect(messages.filter(message => message.type === 'wee:controller-setup').at(-1)?.setup).toBe('motion');
  expect(permission).not.toHaveBeenCalled();
  expect(elements.get('setup-panel').hidden).toBe(true);
});


test('closing a tennis lobby and joining bowling reuses origin setup while the phone is moving', async () => {
  const persistent = new Map();
  window.localStorage = { getItem: key => persistent.get(key) ?? null,
    setItem: (key, value) => persistent.set(key, value), removeItem: key => persistent.delete(key) };
  await import('@wee/src/controller/main.js');
  await calibrate();
  expect(window.localStorage.getItem(CALIBRATION_STORAGE_KEY)).not.toBeNull();
  expect(window.sessionStorage.getItem(CALIBRATION_STORAGE_KEY)).toBeNull();
  const wallClock = Date.now();
  vi.clearAllTimers(); vi.setSystemTime(wallClock); vi.resetModules();
  elements.clear(); listeners.clear(); documentListeners.clear(); messages.length = 0;
  window.sessionStorage = { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() };
  location.search = '?room=lobby-NEXT&lobby=NEXT&player=1&sport=bowling';
  await import('@wee/src/controller/main.js');
  state({ playing: false, gameId: 'new-bowling-match' });
  expect(elements.get('calibrate').textContent).toBe('Resume motion');
  expect(messages.filter(message => message.type === 'wee:controller-setup').at(-1)?.setup).toBeNull();
  for (let i = 0; i < 30; i++) tick(20, { alpha: i % 2 ? 100 : -100, beta: 70, gamma: -40 });
  expect(messages.filter(message => message.type === 'wee:controller-setup').at(-1)?.setup).toBe('motion');
  expect(elements.get('setup-panel').hidden).toBe(true);
  expect(permission).toHaveBeenCalledOnce();
});

const savedMotionSetup = (overrides = {}) => createCalibrationMemory(window.sessionStorage).save({
  hand: 'Left', bias: { alpha: .1, beta: -.1, gamma: .2 },
  strength: { hand: 'Left', Forehand: 1.2, Backhand: 1.1 }, ...overrides,
});

test('cached setup never substitutes for permission or live sensors and a Resume tap can restore it', async () => {
  savedMotionSetup();
  await import('@wee/src/controller/main.js');
  expect(elements.get('hand').value).toBe('Left');
  expect(permission).not.toHaveBeenCalled();
  tick(7000, null);
  expect(messages.filter(message => message.type === 'wee:controller-setup').at(-1)?.setup).toBeNull();
  permission.mockResolvedValueOnce('denied');
  await elements.get('calibrate').onclick();
  expect(elements.get('motion').textContent).toContain('denied');
  expect(messages.filter(message => message.type === 'wee:controller-setup').at(-1)?.setup).toBeNull();
  await elements.get('calibrate').onclick();
  for (let i = 0; i < 30; i++) tick();
  expect(messages.filter(message => message.type === 'wee:controller-setup').at(-1)?.setup).toBe('motion');
  expect(elements.get('tune-strength').textContent).toBe('Retune power');
  expect(elements.get('strength-status').textContent).toContain('restored');
});

test.each([
  ['enable', 'granted'], ['enable', 'denied'], ['calibrate', 'granted'], ['calibrate', 'denied'],
])('late %s permission result (%s) cannot replace a newer button choice', async (action, grant) => {
  savedMotionSetup();
  await import('@wee/src/controller/main.js');
  let resolvePermission;
  permission.mockImplementationOnce(() => new Promise(resolve => { resolvePermission = resolve; }));
  const pending = elements.get(action).onclick();
  elements.get('use-buttons').onclick();
  const buttonMessage = elements.get('motion').textContent;
  resolvePermission(grant);
  await pending;
  for (let i = 0; i < 30; i++) tick();
  expect(messages.filter(message => message.type === 'wee:controller-setup').at(-1)?.setup).toBe('buttons');
  expect(elements.get('motion').textContent).toBe(buttonMessage);
  expect(elements.get('calibration-progress').hidden).toBe(true);
});

test.each(['hand', 'hidden', 'pagehide'])('pending permission cannot begin calibration after a newer %s intent', async change => {
  savedMotionSetup();
  await import('@wee/src/controller/main.js');
  let resolvePermission;
  permission.mockImplementationOnce(() => new Promise(resolve => { resolvePermission = resolve; }));
  const pending = elements.get('calibrate').onclick();
  if (change === 'hand') { elements.get('hand').value = 'Right'; elements.get('hand').onchange(); }
  if (change === 'hidden') { document.hidden = true; documentListeners.get('visibilitychange')(); }
  if (change === 'pagehide') emit('pagehide', {});
  resolvePermission('granted');
  await pending;
  for (let i = 0; i < 30; i++) tick();
  expect(messages.filter(message => message.type === 'wee:controller-setup').at(-1)?.setup).toBeNull();
  expect(elements.get('calibrate').textContent).not.toMatch(/Checking|Calibrating/);
});

test('an older permission promise cannot clear the pending state or start setup for a newer request', async () => {
  savedMotionSetup();
  await import('@wee/src/controller/main.js');
  let resolveFirst, resolveSecond;
  permission.mockImplementationOnce(() => new Promise(resolve => { resolveFirst = resolve; }))
    .mockImplementationOnce(() => new Promise(resolve => { resolveSecond = resolve; }));
  const first = elements.get('enable').onclick();
  const second = elements.get('calibrate').onclick();
  resolveFirst('granted'); await first;
  expect(elements.get('calibrate').disabled).toBe(true);
  expect(elements.get('calibrate').textContent).toBe('Resume motion');
  resolveSecond('granted'); await second;
  expect(elements.get('calibrate').textContent).toBe('Checking motion…');
  for (let i = 0; i < 30; i++) tick();
  expect(messages.filter(message => message.type === 'wee:controller-setup').at(-1)?.setup).toBe('motion');
});

test('resuming while moving retains the saved stationary zero and its original expiry', async () => {
  savedMotionSetup({ hand: 'Right', strength: { hand: 'Right', Forehand: 1.2, Backhand: 1.1 } });
  const saved = createCalibrationMemory(window.sessionStorage).read();
  await import('@wee/src/controller/main.js');
  for (let i = 0; i < 35; i++) tick(20, { alpha: i % 2 ? 100 : -100, beta: 80, gamma: -40 });
  expect(messages.filter(message => message.type === 'wee:controller-setup').at(-1)?.setup).toBe('motion');
  const resumed = createCalibrationMemory(window.sessionStorage).read();
  expect(resumed.bias).toEqual(saved.bias);
  expect(resumed.strength).toEqual(saved.strength);
  expect(resumed.verifiedAt).toBe(saved.verifiedAt);
  await elements.get('calibrate').onclick(); // Explicit reset still requires a new still sample.
  for (let i = 0; i < 110; i++) tick(20, { alpha: 4, beta: 0, gamma: 0 });
  expect(createCalibrationMemory(window.sessionStorage).read().bias.alpha).toBe(4);
  expect(createCalibrationMemory(window.sessionStorage).read().strength).toBeNull();
});

test('changing the selected hand before verification prevents restoring the previous hand profile', async () => {
  savedMotionSetup();
  await import('@wee/src/controller/main.js');
  elements.get('hand').value = 'Right'; elements.get('hand').onchange();
  for (let i = 0; i < 30; i++) tick();
  expect(messages.filter(message => message.type === 'wee:controller-setup').at(-1)?.setup).toBeNull();
  expect(elements.get('calibrate').textContent).toBe('Enable motion');
  expect(window.sessionStorage.getItem(CALIBRATION_STORAGE_KEY)).toBeNull();
});

test('saved setup resume rejects missing readings and cancels when the phone is hidden', async () => {
  savedMotionSetup();
  await import('@wee/src/controller/main.js');
  for (let i = 0; i < 30; i++) tick(20, { alpha: null, beta: null, gamma: null });
  expect(messages.filter(message => message.type === 'wee:controller-setup').at(-1)?.setup).toBeNull();
  document.hidden = true; documentListeners.get('visibilitychange')();
  for (let i = 0; i < 30; i++) tick();
  expect(messages.filter(message => message.type === 'wee:controller-setup').at(-1)?.setup).toBeNull();
  document.hidden = false; documentListeners.get('visibilitychange')();
  tick(20);
  expect(messages.filter(message => message.type === 'wee:controller-setup').at(-1)?.setup).toBeNull();
  for (let i = 0; i < 30; i++) tick();
  expect(messages.filter(message => message.type === 'wee:controller-setup').at(-1)?.setup).toBe('motion');
});



test('tennis phone shows whose serve it is and stops input after a match', async () => {
  await import('@wee/src/controller/main.js');
  state({ playing: true, paused: false, gameId: 'match-one' });
  elements.get('use-buttons').onclick();
  const tennis = (data, source = parent) => emit('message', { source, origin: location.origin,
    data: { type: 'wee:tennis-state', phase: 'serve', server: 1, winner: null, ...data } });
  tennis({ phase: 'prepare' });
  expect(elements.get('play-title').textContent).toBe('You serve next');
  tennis({});
  expect(elements.get('play-title').textContent).toBe('Your serve');
  tennis({ server: 2 });
  expect(elements.get('play-title').textContent).toBe('P2 is serving');
  tennis({ phase: 'complete', winner: 1 }, {});
  expect(elements.get('play-title').textContent).toBe('P2 is serving');
  tennis({ phase: 'complete', winner: 1 });
  expect(elements.get('play-title').textContent).toBe('You won!');
  elements.get('forehand').onclick();
  expect(relay.sendSwing).not.toHaveBeenCalled();
  tennis({});
  expect(elements.get('play-title').textContent).toBe('Your serve');
  elements.get('forehand').onclick();
  expect(relay.sendSwing).toHaveBeenCalledTimes(1);
});




test('a rejected setup save remains visible on the calibrated waiting screen', async () => {
  await import('@wee/src/controller/main.js');
  state({});
  await calibrate();
  emit('message', { source: parent, origin: location.origin,
    data: { type: 'wee:setup-ack', result: { ok: false, error: 'disconnected' } } });
  expect(elements.get('play-panel').hidden).toBe(false);
  expect(elements.get('play-notice').hidden).toBe(false);
  expect(elements.get('play-notice').textContent).toMatch(/setup|reconnect/i);
  emit('message', { source: parent, origin: location.origin,
    data: { type: 'wee:setup-ack', result: { ok: true } } });
  expect(elements.get('play-notice').hidden).toBe(true);
  expect(elements.get('play-title').textContent).toBe('You’re ready');
});

test('bowling presents the other player, own turn, armed roll, delivery and persistent completion states', async () => {
  location.search += '&sport=bowling';
  await import('@wee/src/controller/main.js');
  await calibrate();
  state({ playing: true, paused: false });
  const bowlingState = data => emit('message', { source: parent, origin: location.origin,
    data: { type: 'wee:bowling-state', canRoll: true, phase: 'ready', ...data } });
  bowlingState({ currentPlayer: 2 });
  expect(elements.get('play-title').textContent).toBe('P2 is bowling');
  expect(elements.get('bowling-controls').hidden).toBe(true);
  bowlingState({ currentPlayer: 1 });
  expect(elements.get('play-title').textContent).toBe('Your turn');
  expect(elements.get('bowling-controls').hidden).toBe(false);
  expect(elements.get('bowling-buttons').hidden).toBe(true);
  elements.get('arm-roll').onclick();
  expect(elements.get('play-title').textContent).toBe('Swing forward');
  expect(elements.get('shot-adjustments').hidden).toBe(true);
  expect(elements.get('cancel-roll').hidden).toBe(false);
  elements.get('cancel-roll').onclick();
  for (let i = 0; i < 40; i++) tick(20, { alpha: i < 20 ? 400 * Math.sin(Math.PI * i / 20) : 0, beta: 0, gamma: 0 });
  expect(messages.filter(message => message.type === 'wee:player-roll')).toHaveLength(0);
  expect(elements.get('shot-adjustments').hidden).toBe(false);
  expect(elements.get('play-title').textContent).toBe('Your turn');
  elements.get('arm-roll').onclick();
  elements.get('toggle-settings').onclick();
  elements.get('toggle-settings').onclick();
  expect(elements.get('play-title').textContent).toBe('Your turn');
  expect(messages.filter(message => message.type === 'wee:player-roll')).toHaveLength(0);
  elements.get('arm-roll').onclick();
  for (let i = 0; i < 40; i++) tick(20, { alpha: i < 20 ? 400 * Math.sin(Math.PI * i / 20) : 0, beta: 0, gamma: 0 });
  expect(messages.filter(message => message.type === 'wee:player-roll')).toHaveLength(1);
  expect(elements.get('play-title').textContent).toBe('Watch the lane');
  expect(elements.get('bowling-controls').hidden).toBe(true);
  bowlingState({ currentPlayer: 1, canRoll: false, phase: 'complete' });
  expect(elements.get('play-title').textContent).toBe('Nice bowling!');
  tick(2000, null);
  expect(elements.get('play-title').textContent).toBe('Nice bowling!');
  expect(elements.get('bowling-controls').hidden).toBe(true);
});

test('granted permission without gyro readings does not claim calibration success', async () => {
  await import('@wee/src/controller/main.js');
  state({});
  await elements.get('calibrate').onclick();
  for (let i = 0; i < 51; i++) tick(200, { alpha: null, beta: null, gamma: null });
  expect(messages).not.toContainEqual({ type: 'wee:controller-setup', setup: 'motion' });
  expect(elements.get('motion').textContent).toContain('live gyroscope readings');
  expect(elements.get('sensor-status').textContent).toContain('without gyroscope data');
});

test('insecure phone links and denied permission provide a usable explanation', async () => {
  window.isSecureContext = false;
  await import('@wee/src/controller/main.js');
  await elements.get('calibrate').onclick();
  expect(elements.get('motion').textContent).toContain('HTTPS');
  expect(permission).not.toHaveBeenCalled();
  window.isSecureContext = true;
  permission.mockResolvedValue('denied');
  await elements.get('calibrate').onclick();
  expect(elements.get('motion').textContent).toContain('denied');
  expect(messages).not.toContainEqual({ type: 'wee:controller-setup', setup: 'motion' });
  elements.get('use-buttons').onclick();
  expect(messages).toContainEqual({ type: 'wee:controller-setup', setup: 'buttons' });
  state({ playing: true, paused: false });
  expect(elements.get('play-title').textContent).toBe('Tap to swing');
  expect(elements.get('manual-controls').hidden).toBe(false);
  expect(elements.get('record').hidden).toBe(true);
  elements.get('forehand').onclick();
  state({ playing: true, paused: true });
  expect(elements.get('manual-controls').hidden).toBe(true);
});


test('bowling sends bounded aim, spin and power for its own turn and blocks repeated taps', async () => {
  location.search += '&sport=bowling';
  await import('@wee/src/controller/main.js');
  elements.get('use-buttons').onclick();
  state({ playing: true, paused: false });
  const bowlingState = currentPlayer => emit('message', { source: parent, origin: location.origin,
    data: { type: 'wee:bowling-state', canRoll: true, currentPlayer, phase: 'ready' } });
  bowlingState(2);
  expect(elements.get('bowling-controls').hidden).toBe(true);
  elements.get('roll').onclick();
  expect(messages.filter(message => message.type === 'wee:player-roll')).toHaveLength(0);
  bowlingState(1);
  expect(elements.get('bowling-controls').hidden).toBe(false);
  expect(elements.get('bowling-buttons').hidden).toBe(false);
  expect(elements.get('bowling-buttons').open).toBe(true);
  expect(elements.get('arm-roll').hidden).toBe(true);
  elements.get('aim').value = '-0.3';
  elements.get('spin').value = '0.2';
  elements.get('roll').onclick();
  elements.get('roll').onclick();
  const rolls = messages.filter(message => message.type === 'wee:player-roll');
  expect(rolls).toHaveLength(1);
  expect(rolls[0].event).toEqual({ type: 'roll', id: expect.any(String), aim: -.3, spin: .2, power: .7 });
  expect(relay.sendSwing).not.toHaveBeenCalled();
});

test('calibrated bowling motion only rolls when explicitly armed on the current turn', async () => {
  location.search += '&sport=bowling';
  await import('@wee/src/controller/main.js');
  await calibrate();
  state({ playing: true, paused: false });
  emit('message', { source: parent, origin: location.origin,
    data: { type: 'wee:bowling-state', canRoll: true, currentPlayer: 1, phase: 'ready' } });
  const bowl = () => { for (let i = 0; i < 40; i++) tick(20, { alpha: i < 20 ? 400 * Math.sin(Math.PI * i / 20) : 0, beta: 0, gamma: 0 }); };
  bowl();
  expect(messages.filter(message => message.type === 'wee:player-roll')).toHaveLength(0);
  elements.get('arm-roll').onclick();
  bowl();
  expect(messages.filter(message => message.type === 'wee:player-roll')).toHaveLength(1);
  expect(relay.sendSwing).not.toHaveBeenCalled();
});

test('bowling tilt aims before arming, locks during delivery and sends measured power and twist', async () => {
  location.search += '&sport=bowling';
  await import('@wee/src/controller/main.js');
  await calibrate();
  state({ playing: true, paused: false });
  emit('message', { source: parent, origin: location.origin,
    data: { type: 'wee:bowling-state', canRoll: true, currentPlayer: 1, phase: 'ready' } });
  for (let i = 0; i < 35; i++) tick(20, undefined, { accelerationIncludingGravity: { x: -3, y: 0, z: 9.3 } });
  const aim = Number(elements.get('aim').value);
  expect(aim).toBeGreaterThan(.3);
  expect(elements.get('aim').hidden).toBe(true);
  expect(elements.get('curve-buttons').hidden).toBe(true);
  elements.get('spin').value = '-1'; // A stale button preference must not override the wrist.
  elements.get('arm-roll').onclick();
  for (let i = 0; i < 40; i++) tick(20, { alpha: (i < 20 ? 400 * Math.sin(Math.PI * i / 20) : 0) + .1, beta: 69.9, gamma: .2 }, {
    accelerationIncludingGravity: { x: 3, y: 0, z: 9.3 }, acceleration: { x: 0, y: 12, z: 0 },
  });
  const rolls = messages.filter(message => message.type === 'wee:player-roll');
  expect(rolls).toHaveLength(1);
  expect(rolls[0].event.aim).toBe(aim);
  expect(rolls[0].event.spin).toBeGreaterThan(0);
  expect(rolls[0].event.power).toBeGreaterThan(.5);
  expect(Number(elements.get('motion-power').value)).toBe(rolls[0].event.power);
  expect(elements.get('motion-curve').textContent).toMatch(/^Right/);
  expect(elements.get('bowling-readout').hidden).toBe(false);
});

test('losing usable gravity restores manual aim while gyro motion remains live', async () => {
  location.search += '&sport=bowling';
  await import('@wee/src/controller/main.js');
  await calibrate();
  state({ playing: true, paused: false });
  emit('message', { source: parent, origin: location.origin,
    data: { type: 'wee:bowling-state', canRoll: true, currentPlayer: 1, phase: 'ready' } });
  for (let i = 0; i < 30; i++) tick(20, undefined, { accelerationIncludingGravity: { x: -3, y: 0, z: 9.3 } });
  expect(elements.get('aim').hidden).toBe(true);
  for (let i = 0; i < 40; i++) tick();
  expect(elements.get('aim').hidden).toBe(false);
  expect(elements.get('play-title').textContent).toBe('Your turn');
});

