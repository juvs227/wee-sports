import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createCalibrationMemory, CALIBRATION_STORAGE_KEY, CALIBRATION_MAX_AGE_MS } from '@wee/src/controller/calibrationMemory.js';
import { tennisPower } from '@wee/src/controller/tennisPower.js';

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
    removeEventListener(type, fn) {listeners.get(type)?.delete(fn);},
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
const placement = () => expect.objectContaining({aim:expect.any(Number),depth:expect.any(Number)});
function expectBoundedPlacement() {
  for (const [, , , aim] of relay.sendSwing.mock.calls) {
    expect(Object.keys(aim).sort()).toEqual(['aim','depth']);
    expect(Number.isFinite(aim.aim) && Math.abs(aim.aim)<=1).toBe(true);
    expect(Number.isFinite(aim.depth) && Math.abs(aim.depth)<=1).toBe(true);
  }
}

test('trusted profile preferences provide initial UI defaults without granting sensor setup', async () => {
  await import('@wee/src/controller/main.js');
  const profile = {type: 'wee:profile-preferences', preferences: {hand: 'Left', sensitivity: 1.5, haptics: false, touchControls: false}};
  emit('message', {source: {}, origin: location.origin, data: profile});
  expect(elements.get('hand').value).toBe('Right');
  emit('message', {source: parent, origin: location.origin, data: profile});
  expect(elements.get('hand').value).toBe('Left');
  expect(elements.get('haptics').checked).toBe(false);
  expect(elements.get('motion-sensitivity').value).toBe('1.5');
  expect(permission).not.toHaveBeenCalled();
  expect(messages.filter(message => message.type === 'wee:controller-setup').at(-1)?.setup).toBeNull();
  expect(elements.get('setup-panel').hidden).toBe(true);
});

test('late profile preferences keep the active control mapping and honor vibration opt-out', async () => {
  await import('@wee/src/controller/main.js');
  elements.get('use-buttons').onclick();
  emit('message', {source: parent, origin: location.origin, data: {type: 'wee:profile-preferences', preferences: {
    hand: 'Left', sensitivity: 2, haptics: false, touchControls: false,
  }}});
  expect(elements.get('hand').value).toBe('Right');
  expect(elements.get('haptics').checked).toBe(false);
  expect(elements.get('motion-sensitivity').value).toBe('1');
  expect(messages.filter(message => message.type === 'wee:controller-setup').at(-1)?.setup).toBe('buttons');
});

test('initial touch preference selects a playable fallback without fabricating motion calibration', async () => {
  await import('@wee/src/controller/main.js');
  emit('message', {source: parent, origin: location.origin, data: {type: 'wee:profile-preferences', preferences: {
    touchControls: true,
  }}});
  expect(permission).not.toHaveBeenCalled();
  expect(messages.filter(message => message.type === 'wee:controller-setup').at(-1)?.setup).toBe('buttons');
  expect(elements.get('setup-status').textContent).toContain('Touch');
});

test.each(['hidden', 'pagehide'])('background %s revokes readiness immediately without waiting for a timer', async reason => {
  await import('@wee/src/controller/main.js');
  emit('message', {source: parent, origin: location.origin, data: {type: 'wee:controller-intent', mode: 'motion', permission: 'granted'}});
  await Promise.resolve();
  for (let index = 0; index < 20; index++) tick();
  expect(messages.filter(message => message.type === 'wee:controller-setup').at(-1)?.setup).toBe('motion');
  if (reason === 'hidden') {document.hidden = true; documentListeners.get('visibilitychange')();}
  else emit('pagehide', {});
  // Hidden documents may have their timers suspended indefinitely.
  expect(messages.filter(message => message.type === 'wee:controller-setup').at(-1)?.setup).toBeNull();
  if (reason === 'hidden') {document.hidden = false; documentListeners.get('visibilitychange')();}
  else emit('pageshow', {});
  expect(messages.filter(message => message.type === 'wee:controller-setup').at(-1)?.setup).toBeNull();
  for (let index = 0; index < 20; index++) tick();
  expect(messages.filter(message => message.type === 'wee:controller-setup').at(-1)?.setup).toBe('motion');
});

test('a granted API without gyro samples falls back automatically, but an established sensor gap does not change modes', async () => {
  await import('@wee/src/controller/main.js');
  await elements.get('enable').onclick();
  tick(3100, null);
  expect(messages.filter(message => message.type === 'wee:controller-setup').at(-1)?.setup).toBe('buttons');
  await elements.get('enable').onclick();
  for (let index = 0; index < 20; index++) tick();
  expect(messages.filter(message => message.type === 'wee:controller-setup').at(-1)?.setup).toBe('motion');
  tick(3100, null);
  expect(messages.filter(message => message.type === 'wee:controller-setup').at(-1)?.setup).toBeNull();
  expect(elements.get('use-buttons').hidden).toBe(false);
});

test('bowling resumes fresh aim immediately after a brief foreground gap and discards the interrupted swing', async () => {
  location.search += '&sport=bowling';
  await import('@wee/src/controller/main.js');
  await elements.get('enable').onclick();
  const sensors = angle => ({acceleration: {x: 0, y: 0, z: 0}, accelerationIncludingGravity: {
    x: -Math.sin(angle * Math.PI / 180) * 9.80665, y: 0, z: Math.cos(angle * Math.PI / 180) * 9.80665,
  }});
  for (let i = 0; i < 40; i++) tick(20, undefined, sensors(0));
  state({playing: true, paused: false, sport: 'bowling', gameId: 'foreground-gap'});
  emit('message', {source: parent, origin: location.origin,
    data: {type: 'wee:bowling-state', canRoll: true, currentPlayer: 1, phase: 'ready'}});
  for (let i = 0; i < 20; i++) tick(20, undefined, sensors(0));
  messages.length = 0;
  tick(280, null);
  tick(20, undefined, sensors(20));
  expect(messages.filter(message => message.type === 'wee:player-aim').at(-1).event.aim).toBeGreaterThan(.5);
  expect(messages.filter(message => message.type === 'wee:controller-setup' && message.setup === null)).toHaveLength(0);

  for (let i = 0; i < 20; i++) tick(20, undefined, sensors(20));
  for (let i = 0; i < 8; i++) tick(20, {alpha: 500, beta: 0, gamma: 0}, sensors(20));
  expect(messages.filter(message => message.type === 'wee:player-aim').at(-1).event.locked).toBe(true);
  tick(280, null);
  for (let i = 0; i < 20; i++) tick(20, undefined, sensors(0));
  expect(messages.filter(message => message.type === 'wee:player-roll')).toHaveLength(0);
  expect(messages.filter(message => message.type === 'wee:player-aim').at(-1).event.locked).toBe(false);
  for (let i = 0; i < 12; i++) tick(20, {alpha: 500, beta: 0, gamma: 0}, sensors(0));
  for (let i = 0; i < 6; i++) tick(20, undefined, sensors(0));
  expect(messages.filter(message => message.type === 'wee:player-roll')).toHaveLength(1);
});

test('a denied manual motion attempt returns directly to playable touch controls', async () => {
  await import('@wee/src/controller/main.js');
  permission.mockResolvedValue('denied');
  await elements.get('enable').onclick();
  expect(messages.filter(message => message.type === 'wee:controller-setup').at(-1)?.setup).toBe('buttons');
  expect(elements.get('play-help').textContent).not.toContain('calibrat');
});

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

test('live sport switching keeps motion setup and permission while discarding the old sport input', async () => {
  await import('@wee/src/controller/main.js');
  await calibrate();
  state({ playing: true, paused: false, sport: 'tennis', gameId: 'tennis-one' });
  tick(20, { alpha: 300, beta: 600, gamma: 0 }); // Partial tennis stroke.
  messages.length = 0;
  state({ playing: false, paused: true, sport: 'bowling', gameId: 'bowling-one' });
  expect(elements.get('controller-title').textContent).toBe('Your bowling ball');
  expect(elements.get('motion-visual').dataset.sport).toBe('bowling');
  expect(elements.get('setup-panel').hidden).toBe(true);
  expect(elements.get('calibration-progress').hidden).toBe(true);
  expect(messages.filter(message => message.type === 'wee:controller-setup')).toEqual([
    expect.objectContaining({ type: 'wee:controller-setup', setup: 'motion', requestId: expect.any(Number) }),
  ]);
  expect(permission).toHaveBeenCalledOnce();
  state({ playing: true, paused: false, sport: 'bowling', gameId: 'bowling-one' });
  emit('message', { source: parent, origin: location.origin, data: {
    type: 'wee:bowling-state', phase: 'ready', currentPlayer: 1, canRoll: true,
  } });
  for (let i = 0; i < 16; i++) tick();
  tick(20, {alpha: 300, beta: 0, gamma: 0});
  state({ playing: true, paused: false, sport: 'tennis', gameId: 'tennis-two' });
  for (let i = 0; i < 40; i++) tick();
  expect(elements.get('controller-title').textContent).toBe('Your racket');
  expect(elements.get('motion-visual').dataset.sport).toBe('tennis');
  expect(elements.get('setup-panel').hidden).toBe(true);
  expect(elements.get('strength-panel').hidden).toBe(true);
  expect(permission).toHaveBeenCalledOnce();
  expect(relay.sendSwing).not.toHaveBeenCalled();
  expect(messages.filter(message => message.type === 'wee:player-roll')).toHaveLength(0);
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

test('a controller reload reuses calibration after fresh sensor readings without a new permission request', async () => {
  await import('@wee/src/controller/main.js');
  await calibrate();
  expect(window.sessionStorage.getItem(CALIBRATION_STORAGE_KEY)).not.toBeNull();
  expect(createCalibrationMemory(window.sessionStorage).read()).not.toBeNull();
  expect(permission).toHaveBeenCalledOnce();
  const wallClock = Date.now();
  vi.clearAllTimers(); vi.setSystemTime(wallClock); vi.resetModules();
  elements.clear(); listeners.clear(); documentListeners.clear(); messages.length = 0;
  expect(createCalibrationMemory(window.sessionStorage).read()).not.toBeNull();
  await import('@wee/src/controller/main.js');
  expect(createCalibrationMemory(window.sessionStorage).read()).not.toBeNull();
  state({ playing: true, paused: false, gameId: 'new-match' });
  expect(elements.get('calibrate').textContent).toBe('Resume motion');
  expect(messages.filter(message => message.type === 'wee:controller-setup').at(-1)?.setup).toBeNull();
  tick(20);
  expect(messages.filter(message => message.type === 'wee:controller-setup').at(-1)?.setup).toBeNull();
  for (let i = 0; i < 30; i++) tick();
  expect(messages.filter(message => message.type === 'wee:controller-setup').at(-1)?.setup).toBe('motion');
  expect(elements.get('setup-panel').hidden).toBe(true);
  expect(permission).toHaveBeenCalledOnce();
  state({ playing: true, paused: true, connected: false, gameId: 'new-match' });
  state({ playing: true, paused: false, gameId: 'another-match' });
  expect(elements.get('setup-panel').hidden).toBe(true);
  expect(permission).toHaveBeenCalledOnce();
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

test.each(['saved', 'default', 'expired', 'changed-hand', 'explicit-reset'])('automatic startup applies %s strength to the actual outgoing tennis stroke', async choice => {
  const strength = {hand: 'Right', Forehand: 1.5, Backhand: 1.25};
  if (choice !== 'default') savedMotionSetup({hand: 'Right', bias: {alpha: 0, beta: 0, gamma: 0}, strength});
  const saved = createCalibrationMemory(window.sessionStorage).read();
  await import('@wee/src/controller/main.js');
  expect(messages.filter(message => message.type === 'wee:controller-setup').at(-1)?.setup).toBeNull();
  if (choice === 'expired') vi.setSystemTime(Date.now() + CALIBRATION_MAX_AGE_MS + 1);
  if (choice === 'changed-hand') {elements.get('hand').value = 'Left'; elements.get('hand').onchange();}
  for (let i = 0; i < 40; i++) tick(20, {alpha: 0, beta: 0, gamma: 0});
  expect(messages.filter(message => message.type === 'wee:controller-setup').at(-1)?.setup).toBe('motion');
  if (choice === 'saved') {
    expect(createCalibrationMemory(window.sessionStorage).read().verifiedAt).toBe(saved.verifiedAt);
    expect(elements.get('tune-strength').textContent).toBe('Retune power');
  }
  if (choice === 'explicit-reset') {
    await elements.get('calibrate').onclick();
    for (let i = 0; i < 110; i++) tick(20, {alpha: 0, beta: 0, gamma: 0});
  }
  state({playing: true, paused: false, sport: 'tennis', gameId: 'saved-power'});
  for (let i = 0; i < 15; i++) tick(20, {alpha: 300, beta: choice === 'changed-hand' ? -600 : 600, gamma: 0});
  for (let i = 0; i < 25; i++) tick(20, {alpha: 0, beta: 0, gamma: 0});
  expect(relay.sendSwing).toHaveBeenCalledTimes(1);
  const [label, hand, power] = relay.sendSwing.mock.calls[0];
  expect(hand).toBe(choice === 'changed-hand' ? 'Left' : 'Right');
  const expected = tennisPower(Math.hypot(300, 600), choice === 'saved' ? strength : null, label);
  expect(power).toBeCloseTo(expected, 8);
  if (choice === 'saved') expect(power).toBeGreaterThan(tennisPower(Math.hypot(300, 600), null, label) + .2);
});

test('an explicit default-strength choice survives automatic sensor recovery', async () => {
  savedMotionSetup({hand: 'Right', bias: {alpha: 0, beta: 0, gamma: 0}, strength: {hand: 'Right', Forehand: 1.5, Backhand: 1.25}});
  await import('@wee/src/controller/main.js');
  for (let i = 0; i < 40; i++) tick(20, {alpha: 0, beta: 0, gamma: 0});
  elements.get('skip-strength').onclick();
  tick(1600, null);
  for (let i = 0; i < 40; i++) tick(20, {alpha: 0, beta: 0, gamma: 0});
  state({playing: true, paused: false, sport: 'tennis', gameId: 'default-power'});
  for (let i = 0; i < 15; i++) tick(20, {alpha: 300, beta: 600, gamma: 0});
  for (let i = 0; i < 25; i++) tick(20, {alpha: 0, beta: 0, gamma: 0});
  expect(relay.sendSwing).toHaveBeenCalledTimes(1);
  const [label, , power] = relay.sendSwing.mock.calls[0];
  expect(power).toBeCloseTo(tennisPower(Math.hypot(300, 600), null, label), 8);
  expect(createCalibrationMemory(window.sessionStorage).read().strength).toBeNull();
});

test('changing restored strength never saves a provisional automatic bias as verified', async () => {
  const verifiedBias = {alpha: 1, beta: 2, gamma: 3};
  savedMotionSetup({hand: 'Right', bias: verifiedBias, strength: {hand: 'Right', Forehand: 1.5, Backhand: 1.25}});
  const saved = createCalibrationMemory(window.sessionStorage).read();
  await import('@wee/src/controller/main.js');
  // Fresh moving readings establish automatic readiness without a new
  // stationary bias fit. Its provisional zero must never replace saved bias.
  for (let i = 0; i < 20; i++) tick(20, {alpha: i % 2 ? 100 : -100, beta: 80, gamma: -40});
  expect(messages.filter(message => message.type === 'wee:controller-setup').at(-1)?.setup).toBe('motion');
  elements.get('skip-strength').onclick();
  const updated = createCalibrationMemory(window.sessionStorage).read();
  expect(updated.strength).toBeNull();
  expect(updated.bias).toEqual(verifiedBias);
  expect(updated.verifiedAt).toBe(saved.verifiedAt);
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
  expect(messages.filter(message => message.type === 'wee:controller-setup').at(-1)?.setup).toBe(change === 'hand' ? 'motion' : null);
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

test('changing the optional hand preserves automatic startup but discards the previous hand profile', async () => {
  savedMotionSetup();
  await import('@wee/src/controller/main.js');
  elements.get('hand').value = 'Right'; elements.get('hand').onchange();
  for (let i = 0; i < 30; i++) tick();
  expect(messages.filter(message => message.type === 'wee:controller-setup').at(-1)?.setup).toBe('motion');
  expect(elements.get('tune-strength').textContent).toBe('Tune power');
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

test('optional strength rehearsal uses real completed strokes, pauses setup, and never sends a match swing', async () => {
  await import('@wee/src/controller/main.js');
  await calibrate();
  expect(elements.get('strength-panel').hidden).toBe(true);
  state({ playing: true, paused: false });
  elements.get('toggle-settings').onclick();
  elements.get('tune-strength').onclick();
  expect(messages.at(-1)).toMatchObject({ type: 'wee:controller-setup', setup: null });
  state({ playing: true, paused: true }); // Host pauses while this phone rehearses.
  const rehearsalSwing = direction => {
    for (let i = 0; i < 15; i++) tick(20, { alpha: 300 * direction, beta: 600 * direction, gamma: 0 });
    for (let i = 0; i < 25; i++) tick();
  };
  for (let i = 0; i < 3; i++) rehearsalSwing(1);
  expect(elements.get('strength-progress').value).toBe(3);
  for (let i = 0; i < 3; i++) rehearsalSwing(-1);
  expect(elements.get('strength-status').textContent).toContain('saved');
  expect(elements.get('tune-strength').textContent).toBe('Retune power');
  expect(relay.sendSwing).not.toHaveBeenCalled();
  expect(messages.at(-1)).toMatchObject({ type: 'wee:controller-setup', setup: 'motion' });
  state({ playing: true, paused: false });
  elements.get('toggle-settings').onclick();
  rehearsalSwing(1);
  expect(relay.sendSwing).toHaveBeenCalledOnce();
  expect(relay.sendSwing.mock.calls[0][2]).toBeGreaterThan(.59);
  elements.get('toggle-settings').onclick();
  elements.get('hand').value = 'Left';
  elements.get('hand').onchange();
  expect(elements.get('strength-status').textContent).toContain('Playing hand changed');
  expect(elements.get('tune-strength').textContent).toBe('Tune power');
});

test('rehearsal is optional, cancels cleanly on hidden page, and recalibration clears its profile', async () => {
  await import('@wee/src/controller/main.js');
  await calibrate();
  elements.get('skip-strength').onclick();
  expect(elements.get('strength-panel').hidden).toBe(true);
  expect(messages.at(-1)).toMatchObject({ type: 'wee:controller-setup', setup: 'motion' });
  elements.get('toggle-settings').onclick();
  elements.get('tune-strength').onclick();
  for (let i = 0; i < 15; i++) tick(20, { alpha: 300, beta: 600, gamma: 0 });
  document.hidden = true;
  documentListeners.get('visibilitychange')();
  expect(elements.get('strength-status').textContent).toContain('page was hidden');
  expect(elements.get('strength-progress').hidden).toBe(true);
  expect(relay.sendSwing).not.toHaveBeenCalled();
  document.hidden = false;
  documentListeners.get('visibilitychange')();
  await calibrate();
  expect(elements.get('strength-status').textContent).toContain('Default power');
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

test('Calibrate itself requests permission; only real still readings unlock setup and play starts automatically', async () => {
  await import('@wee/src/controller/main.js');
  expect(elements.get('calibrate').disabled).toBe(false);
  expect(elements.get('setup-panel').hidden).toBe(true);
  expect(elements.get('play-panel').hidden).toBe(false);
  state({});
  await calibrate();
  expect(permission).toHaveBeenCalledTimes(1);
  expect(messages).toContainEqual(expect.objectContaining({ type: 'wee:controller-setup', setup: 'motion' }));
  expect(elements.get('setup-panel').hidden).toBe(true);
  expect(elements.get('play-panel').hidden).toBe(false);
  expect(elements.get('play-title').textContent).toBe('You’re in');
  expect(elements.get('stop').disabled).toBe(true); // Lobby cannot send strokes.
  state({ playing: true, paused: false });
  expect(elements.get('play-title').textContent).toBe('Swing to play');
  expect(elements.get('stop').disabled).toBe(false);
  for (let i = 0; i < 15; i++) tick(20, { alpha: 300, beta: 600, gamma: 0 });
  for (let i = 0; i < 10; i++) tick();
  expect(relay.sendSwing).toHaveBeenCalledWith('Forehand', 'Right', expect.any(Number), placement());
  expectBoundedPlacement();
});

test('opening settings preserves calibration but drops a partial swing and prevents strokes until returning', async () => {
  await import('@wee/src/controller/main.js');
  await calibrate();
  state({ playing: true, paused: false });
  const savedSetupCount = messages.filter(message => message.type === 'wee:controller-setup').length;
  tick(20, { alpha: 300, beta: 600, gamma: 0 });
  elements.get('toggle-settings').onclick();
  expect(elements.get('setup-panel').hidden).toBe(false);
  expect(elements.get('play-panel').hidden).toBe(true);
  expect(elements.get('toggle-settings').ariaExpanded).toBe('true');
  for (let i = 0; i < 20; i++) tick(20, { alpha: 300, beta: 600, gamma: 0 });
  expect(relay.sendSwing).not.toHaveBeenCalled();
  elements.get('toggle-settings').onclick();
  for (let i = 0; i < 10; i++) tick();
  expect(elements.get('play-title').textContent).toBe('Swing to play');
  expect(elements.get('setup-panel').hidden).toBe(true);
  expect(elements.get('toggle-settings').ariaExpanded).toBe('false');
  expect(relay.sendSwing).not.toHaveBeenCalled();
  for (let i = 0; i < 15; i++) tick(20, { alpha: 300, beta: 600, gamma: 0 });
  for (let i = 0; i < 10; i++) tick();
  expect(relay.sendSwing.mock.calls).toEqual([['Forehand', 'Right', expect.any(Number), placement()]]);
  expectBoundedPlacement();
  expect(permission).toHaveBeenCalledTimes(1);
  expect(messages.filter(message => message.type === 'wee:controller-setup')).toHaveLength(savedSetupCount);
});

test('pause, reconnect and stale sensors show the next action while preserving calibration and dropping partial motion', async () => {
  await import('@wee/src/controller/main.js');
  await calibrate();
  state({ playing: true, paused: false });
  tick(20, { alpha: 300, beta: 600, gamma: 0 });
  state({ playing: true, paused: true });
  expect(elements.get('play-status').textContent).toBe('Match paused');
  expect(elements.get('record').hidden).toBe(true);
  tick(2000, null);
  state({ playing: true, paused: true, connected: false });
  expect(elements.get('play-title').textContent).toBe('Reconnecting…');
  state({ playing: true, paused: false });
  expect(elements.get('play-title').textContent).toBe('Waiting for sensors');
  expect(elements.get('record').disabled).toBe(true);
  tick(40);
  expect(elements.get('play-title').textContent).toBe('Swing to play');
  expect(elements.get('setup-panel').hidden).toBe(true);
  expect(permission).toHaveBeenCalledTimes(1);
  expect(relay.sendSwing).not.toHaveBeenCalled();
});

test('a rejected setup save is visible and automatically retries on the calibrated waiting screen', async () => {
  await import('@wee/src/controller/main.js');
  state({});
  await calibrate();
  emit('message', { source: parent, origin: location.origin,
    data: { type: 'wee:setup-ack', requestId: messages.filter(message => message.type === 'wee:controller-setup').at(-1).requestId, result: { ok: false, error: 'disconnected' } } });
  expect(elements.get('play-panel').hidden).toBe(false);
  expect(elements.get('play-notice').hidden).toBe(false);
  expect(elements.get('play-notice').textContent).toMatch(/setup|reconnect/i);
  tick(1100);
  emit('message', { source: parent, origin: location.origin,
    data: { type: 'wee:setup-ack', requestId: messages.filter(message => message.type === 'wee:controller-setup').at(-1).requestId, result: { ok: true } } });
  expect(elements.get('play-notice').hidden).toBe(true);
  expect(elements.get('play-title').textContent).toBe('You’re in');
});

test('bowling presents the other player, natural swing, delivery and completion states', async () => {
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
  expect(elements.get('play-title').textContent).toBe('Hold still for a moment');
  expect(elements.get('shot-adjustments').hidden).toBe(true);
  expect(elements.has('arm-roll')).toBe(false);
  for (let i = 0; i < 16; i++) tick();
  expect(elements.get('play-title').textContent).toBe('Swing forward to bowl');
  expect(elements.get('play-help').textContent).toBe('Screen up. Tilt to aim, then swing gently forward.');
  tick(20, {alpha: 400, beta: 0, gamma: 0});
  elements.get('toggle-settings').onclick();
  elements.get('toggle-settings').onclick();
  for (let i = 0; i < 40; i++) tick(20, {alpha: i < 20 ? 400 : 0, beta: 0, gamma: 0});
  expect(messages.filter(message => message.type === 'wee:player-roll')).toHaveLength(0);
  for (let i = 0; i < 40; i++) tick(20, {alpha: i < 20 ? 400 : 0, beta: 0, gamma: 0});
  expect(messages.filter(message => message.type === 'wee:player-roll')).toHaveLength(1);
  expect(elements.get('play-title').textContent).toBe('Watch the lane');
  expect(elements.get('bowling-controls').hidden).toBe(true);
  bowlingState({ currentPlayer: 1, canRoll: false, phase: 'complete' });
  tick(2000, null);
  expect(elements.get('play-title').textContent).toBe('Nice bowling!');
  expect(elements.get('bowling-controls').hidden).toBe(true);
});

test('granted permission without gyro readings does not claim calibration success', async () => {
  await import('@wee/src/controller/main.js');
  state({});
  await elements.get('calibrate').onclick();
  for (let i = 0; i < 51; i++) tick(200, { alpha: null, beta: null, gamma: null });
  expect(messages).not.toContainEqual(expect.objectContaining({ type: 'wee:controller-setup', setup: 'motion' }));
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
  expect(messages).not.toContainEqual(expect.objectContaining({ type: 'wee:controller-setup', setup: 'motion' }));
  elements.get('use-buttons').onclick();
  expect(messages).toContainEqual(expect.objectContaining({ type: 'wee:controller-setup', setup: 'buttons' }));
  state({ playing: true, paused: false });
  expect(elements.get('play-title').textContent).toBe('Tap to swing');
  expect(elements.get('manual-controls').hidden).toBe(false);
  expect(elements.get('record').hidden).toBe(true);
  elements.get('forehand').onclick();
  expect(relay.sendSwing).toHaveBeenCalledWith('Forehand', 'Right', expect.any(Number), undefined);
  state({ playing: true, paused: true });
  expect(elements.get('manual-controls').hidden).toBe(true);
});

test('explicit Stop stays stopped across lobby updates; hiding or pausing cannot emit a partial stroke', async () => {
  await import('@wee/src/controller/main.js');
  await calibrate();
  state({ playing: true, paused: false });
  tick(20, { alpha: 300, beta: 600, gamma: 0 });
  elements.get('stop').onclick();
  state({ playing: true, paused: false });
  for (let i = 0; i < 15; i++) tick(20, { alpha: 300, beta: 600, gamma: 0 });
  expect(relay.sendSwing).not.toHaveBeenCalled();
  expect(elements.get('stop').disabled).toBe(true);
  elements.get('record').onclick();
  document.hidden = true;
  documentListeners.get('visibilitychange')();
  for (let i = 0; i < 15; i++) tick(20, { alpha: 300, beta: 600, gamma: 0 });
  expect(relay.sendSwing).not.toHaveBeenCalled();
  document.hidden = false;
  documentListeners.get('visibilitychange')();
  state({ playing: true, paused: true });
  for (let i = 0; i < 15; i++) tick(20, { alpha: 300, beta: 600, gamma: 0 });
  expect(relay.sendSwing).not.toHaveBeenCalled();
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
  expect(elements.has('arm-roll')).toBe(false);
  elements.get('aim').value = '-0.3';
  elements.get('spin').value = '0.2';
  elements.get('roll').onclick();
  elements.get('roll').onclick();
  const rolls = messages.filter(message => message.type === 'wee:player-roll');
  expect(rolls).toHaveLength(1);
  expect(rolls[0].event).toEqual({ type: 'roll', id: expect.any(String), aim: -.3, spin: .2, power: .7 });
  expect(relay.sendSwing).not.toHaveBeenCalled();
});

test('bowling waits for quiet on the current turn and then bowls without an Arm button', async () => {
  location.search += '&sport=bowling';
  await import('@wee/src/controller/main.js');
  await calibrate();
  state({ playing: true, paused: false });
  emit('message', { source: parent, origin: location.origin,
    data: { type: 'wee:bowling-state', canRoll: true, currentPlayer: 1, phase: 'ready' } });
  const bowl = () => { for (let i = 0; i < 40; i++) tick(20, { alpha: i < 20 ? 400 * Math.sin(Math.PI * i / 20) : 0, beta: 0, gamma: 0 }); };
  bowl();
  expect(messages.filter(message => message.type === 'wee:player-roll')).toHaveLength(0);
  bowl();
  expect(messages.filter(message => message.type === 'wee:player-roll')).toHaveLength(1);
  expect(relay.sendSwing).not.toHaveBeenCalled();
});

test('bowling tilt aims before the forward swing, locks during delivery and sends measured power and twist', async () => {
  location.search += '&sport=bowling';
  await import('@wee/src/controller/main.js');
  await calibrate();
  state({ playing: true, paused: false });
  emit('message', { source: parent, origin: location.origin,
    data: { type: 'wee:bowling-state', canRoll: true, currentPlayer: 1, phase: 'ready' } });
  for (let i = 0; i < 35; i++) tick(20, undefined, { accelerationIncludingGravity: { x: -3, y: 0, z: 9.3 } });
  const aim = Number(elements.get('aim').value);
  expect(aim).toBeGreaterThan(.3);
  expect(elements.get('shot-adjustments').hidden).toBe(true);
  expect(elements.get('curve-buttons').hidden).toBe(true);
  elements.get('spin').value = '-1'; // A stale button preference must not override the wrist.
  for (let i = 0; i < 40; i++) tick(20, { alpha: (i < 20 ? 400 * Math.sin(Math.PI * i / 20) : 0) + .1, beta: 69.9, gamma: .2 }, {
    accelerationIncludingGravity: { x: 3, y: 0, z: 9.3 }, acceleration: { x: 0, y: 12, z: 0 },
  });
  const rolls = messages.filter(message => message.type === 'wee:player-roll');
  expect(rolls).toHaveLength(1);
  // The opening sample is still a positioning tilt. Lock the latest line at
  // the actual forward swing, then ignore gravity changes through release.
  const locked = messages.filter(message => message.type === 'wee:player-aim' && message.event.locked);
  expect(locked.length).toBeGreaterThan(0);
  expect(locked.every(message => message.event.aim === locked[0].event.aim)).toBe(true);
  expect(rolls[0].event.aim).toBe(locked[0].event.aim);
  expect(rolls[0].event.spin).toBeGreaterThan(0);
  expect(rolls[0].event.power).toBeGreaterThan(.5);
  expect(Number(elements.get('motion-power').value)).toBe(rolls[0].event.power);
  expect(elements.get('motion-curve').textContent).toMatch(/^Right/);
  expect(elements.get('bowling-readout').hidden).toBe(false);
});

test('bowling live aim streams only on the active turn, announces aim lock, and preserves release aim', async () => {
  location.search += '&sport=bowling';
  await import('@wee/src/controller/main.js');
  await calibrate();
  state({playing: true, paused: false, sport: 'bowling', gameId: 'bowl-one'});
  const turn = currentPlayer => emit('message', {source: parent, origin: location.origin,
    data: {type: 'wee:bowling-state', canRoll: true, currentPlayer, phase: 'ready'}});
  turn(2); tick();
  expect(messages.filter(message => message.type === 'wee:player-aim')).toHaveLength(0);
  turn(1);
  elements.get('aim').value = '.35'; elements.get('aim').oninput();
  expect(messages.filter(message => message.type === 'wee:player-aim').at(-1).event).toMatchObject({aim: .35, locked: false});
  for (let i = 0; i < 16; i++) tick();
  tick(20, {alpha: 400, beta: 0, gamma: 0});
  expect(messages.filter(message => message.type === 'wee:player-aim').at(-1).event.locked).toBe(false);
  tick(20, {alpha: 400, beta: 0, gamma: 0}); tick(20, {alpha: 400, beta: 0, gamma: 0});
  expect(messages.filter(message => message.type === 'wee:player-aim').at(-1).event).toMatchObject({aim: .35, locked: true});
  elements.get('aim').value = '-.8'; // Even a stray UI mutation cannot steer an armed delivery.
  for (let index = 0; index <= 60; index++) {
    const pitch = index < 20 ? 500 : 0;
    tick(20, {alpha: pitch + .1, beta: -.1, gamma: .2});
  }
  expect(messages.filter(message => message.type === 'wee:player-roll')).toHaveLength(1);
  expect(messages.filter(message => message.type === 'wee:player-roll')[0].event.aim).toBe(.35);
  const sent = messages.filter(message => message.type === 'wee:player-aim').length;
  state({playing: true, paused: true, gameId: 'bowl-one'}); tick(300, null);
  expect(messages.filter(message => message.type === 'wee:player-aim')).toHaveLength(sent);
});

test('losing usable gravity preserves the last line and keeps touch controls available', async () => {
  location.search += '&sport=bowling';
  await import('@wee/src/controller/main.js');
  await calibrate();
  state({ playing: true, paused: false });
  emit('message', { source: parent, origin: location.origin,
    data: { type: 'wee:bowling-state', canRoll: true, currentPlayer: 1, phase: 'ready' } });
  for (let i = 0; i < 30; i++) tick(20, undefined, { accelerationIncludingGravity: { x: -3, y: 0, z: 9.3 } });
  expect(elements.get('shot-adjustments').hidden).toBe(true);
  const line = elements.get('aim').value;
  for (let i = 0; i < 40; i++) tick();
  expect(elements.get('aim').value).toBe(line);
  expect(elements.get('use-buttons').hidden).toBe(false);
  expect(elements.get('play-title').textContent).toBe('Swing forward to bowl');
});

test('web bowling follows fast side tilts on every jittered sensor frame while the hand also translates', async () => {
  location.search += '&sport=bowling';
  await import('@wee/src/controller/main.js');
  await calibrate();
  state({playing: true, paused: false});
  emit('message', {source: parent, origin: location.origin,
    data: {type: 'wee:bowling-state', canRoll: true, currentPlayer: 1, phase: 'ready'}});
  for (let index = 0; index < 20; index++) tick(16, undefined, {
    acceleration: {x: 0, y: 0, z: 0}, accelerationIncludingGravity: {x: 0, y: 0, z: 9.80665},
  });
  messages.length = 0;
  let previous = 0, previousAngle = 0;
  for (const [index, angle] of [2, 7, 12, 17, 22, 27].entries()) {
    const milliseconds = [15, 17, 16, 18][index % 4];
    const radians = angle * Math.PI / 180;
    tick(milliseconds, {alpha: .1, beta: (angle - previousAngle) * 1000 / milliseconds - .1, gamma: .2}, {
      acceleration: {x: 8, y: 0, z: 0},
      accelerationIncludingGravity: {x: 8 - Math.sin(radians) * 9.80665, y: 0, z: Math.cos(radians) * 9.80665},
    });
    const latest = messages.filter(message => message.type === 'wee:player-aim').at(-1)?.event;
    expect(latest?.locked).toBe(false);
    expect(latest.aim).toBeGreaterThan(previous);
    expect((angle - 1) / 34 - latest.aim).toBeLessThan(.09);
    previous = latest.aim; previousAngle = angle;
  }
  expect(messages.filter(message => message.type === 'wee:player-aim')).toHaveLength(6);
  expect(messages.filter(message => message.type === 'wee:player-roll')).toHaveLength(0);
});

test('browser mixed-axis positioning keeps aiming live until a coherent forward delivery', async () => {
  location.search += '&sport=bowling';
  await import('@wee/src/controller/main.js');
  await calibrate();
  state({playing: true, paused: false, sport: 'bowling', gameId: 'intent-bowl'});
  emit('message', {source: parent, origin: location.origin,
    data: {type: 'wee:bowling-state', canRoll: true, currentPlayer: 1, phase: 'ready'}});
  const gravity = angle => ({acceleration: {x: 0, y: 0, z: 0}, accelerationIncludingGravity: {
    x: -Math.sin(angle * Math.PI / 180) * 9.80665, y: 0, z: Math.cos(angle * Math.PI / 180) * 9.80665,
  }});
  for (let i = 0; i < 20; i++) tick(20, undefined, gravity(0));
  messages.length = 0;
  for (let i = 0; i < 20; i++) tick(20, {alpha: 160.1, beta: 179.9, gamma: .2}, gravity(i / 2));
  tick(20, {alpha: 700.1, beta: -.1, gamma: .2}, gravity(10));
  for (let i = 0; i < 10; i++) tick(20, undefined, gravity(12));
  const aims = messages.filter(message => message.type === 'wee:player-aim');
  expect(aims.length).toBeGreaterThan(10);
  expect(aims.every(message => !message.event.locked)).toBe(true);
  expect(aims.at(-1).event.aim).toBeGreaterThan(.25);
  expect(messages.filter(message => message.type === 'wee:player-roll')).toHaveLength(0);
  const intendedAim = Number(elements.get('aim').value);
  for (let i = 0; i < 35; i++) tick(20, {alpha: (i < 15 ? 400 : 0) + .1, beta: i < 15 ? 69.9 : -.1, gamma: .2}, gravity(-20));
  const rolls = messages.filter(message => message.type === 'wee:player-roll');
  expect(rolls).toHaveLength(1);
  expect(rolls[0].event.aim).toBe(intendedAim);
  expect(rolls[0].event.spin).toBeGreaterThan(0);
});

test('browser range steps cannot quantize motion preview or its locked delivery', async () => {
  location.search += '&sport=bowling';
  await import('@wee/src/controller/main.js');
  await calibrate();
  const slider = elements.get('aim');
  // Real range inputs sanitize programmatic values as well as pointer input.
  // Read the actual touch step instead of giving this DOM stub free precision.
  const markup = readFileSync(new URL('../../controller.html', import.meta.url), 'utf8');
  const step = Number(markup.match(/<input id="aim"[^>]*step="([^"]+)"/)[1]);
  let sliderValue = slider.value;
  Object.defineProperty(slider, 'value', {
    get: () => sliderValue,
    set: value => { sliderValue = String(Number((Math.round(Number(value) / step) * step).toFixed(8))); },
  });
  state({playing: true, paused: false, sport: 'bowling', gameId: 'precise-bowl'});
  emit('message', {source: parent, origin: location.origin,
    data: {type: 'wee:bowling-state', canRoll: true, currentPlayer: 1, phase: 'ready'}});
  const tilt = degrees => ({acceleration: {x: 0, y: 0, z: 0}, accelerationIncludingGravity: {
    x: -Math.sin(degrees * Math.PI / 180) * 9.80665, y: 0, z: Math.cos(degrees * Math.PI / 180) * 9.80665,
  }});
  for (let i = 0; i < 20; i++) tick(20, undefined, tilt(0));
  messages.length = 0;
  for (const angle of [2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5]) tick(20, undefined, tilt(angle));
  const aims = messages.filter(message => message.type === 'wee:player-aim').map(message => message.event.aim);
  expect(aims).toHaveLength(8);
  for (let i = 1; i < aims.length; i++) {
    expect(aims[i]).toBeGreaterThan(aims[i - 1]);
    expect(aims[i] - aims[i - 1]).toBeLessThan(step);
  }
  const preciseAim = aims.at(-1);
  expect(Math.abs(preciseAim - Number(slider.value))).toBeGreaterThan(.001);
  tick(20, {alpha: 500.1, beta: -.1, gamma: .2});
  expect(messages.filter(message => message.type === 'wee:player-aim').at(-1).event.locked).toBe(false);
  tick(20, {alpha: 500.1, beta: -.1, gamma: .2}); tick(20, {alpha: 500.1, beta: -.1, gamma: .2});
  expect(messages.filter(message => message.type === 'wee:player-aim').at(-1).event)
    .toMatchObject({aim: preciseAim, locked: true});
  slider.value = '-.8'; // Display changes after locking cannot steer the ball.
  for (let i = 0; i < 40; i++) tick(20, {alpha: (i < 15 ? 500 : 0) + .1, beta: -.1, gamma: .2});
  const rolls = messages.filter(message => message.type === 'wee:player-roll');
  expect(rolls).toHaveLength(1);
  expect(rolls[0].event.aim).toBe(preciseAim);
});

test('switching between precise motion and touch keeps the active control authoritative', async () => {
  location.search += '&sport=bowling';
  await import('@wee/src/controller/main.js');
  await calibrate();
  state({playing: true, paused: false, sport: 'bowling', gameId: 'touch-bowl'});
  emit('message', {source: parent, origin: location.origin,
    data: {type: 'wee:bowling-state', canRoll: true, currentPlayer: 1, phase: 'ready'}});
  for (let i = 0; i < 20; i++) tick(20, undefined, {accelerationIncludingGravity: {x: -3, y: 0, z: 9.3}});
  expect(messages.filter(message => message.type === 'wee:player-aim').at(-1).event.aim).toBeGreaterThan(.3);
  elements.get('use-buttons').onclick();
  elements.get('aim').value = '-.3'; elements.get('aim').oninput();
  tick(30, null);
  expect(messages.filter(message => message.type === 'wee:player-aim').at(-1).event)
    .toMatchObject({aim: -.3, locked: false});
  await elements.get('enable').onclick();
  for (let i = 0; i < 30; i++) tick(20, undefined, {accelerationIncludingGravity: {x: 0, y: 0, z: 9.80665}});
  expect(messages.filter(message => message.type === 'wee:controller-setup').at(-1).setup).toBe('motion');
  expect(Math.abs(messages.filter(message => message.type === 'wee:player-aim').at(-1).event.aim)).toBeLessThan(.01);
  elements.get('use-buttons').onclick();
  elements.get('aim').value = '-.35'; elements.get('aim').oninput();
  elements.get('roll').onclick();
  expect(messages.filter(message => message.type === 'wee:player-roll').at(-1).event.aim).toBe(-.35);
});

const teamRecordings = [
  ['two-forehands-one-backhand', 'Right', ['Forehand', 'Forehand', 'Backhand']],
  ['four-backhands', 'Right', Array(4).fill('Backhand')],
  ['left-four-backhands-new', 'Left', Array(4).fill('Backhand')],
  ['left-four-forehands', 'Left', Array(4).fill('Forehand')],
  ['left-mixed', 'Left', ['Forehand', 'Backhand', 'Forehand', 'Backhand']],
];

test('phone stays awake from calibrated lobby into play and haptics only accept this player’s live parent hit', async () => {
  const locks = [];
  const request = vi.fn(async () => {
    const lock = { release: vi.fn(async () => {}), addEventListener: vi.fn() };
    locks.push(lock);
    return lock;
  });
  const vibrate = vi.fn(() => true);
  vi.stubGlobal('navigator', { wakeLock: { request }, vibrate, userActivation: { hasBeenActive: true } });
  await import('@wee/src/controller/main.js');
  state({});
  expect(request).not.toHaveBeenCalled();
  await calibrate();
  expect(elements.get('play-title').textContent).toBe('You’re in');
  expect(request).toHaveBeenCalledExactlyOnceWith('screen');
  expect(locks[0].release).not.toHaveBeenCalled();
  const hit = { type: 'wee:game-hit', kind: 'tennis', player: 1 };
  emit('message', { source: parent, origin: location.origin, data: hit });
  expect(vibrate).not.toHaveBeenCalled();
  state({ playing: true, paused: false });
  await Promise.resolve();
  expect(request).toHaveBeenCalledExactlyOnceWith('screen');
  emit('message', { source: {}, origin: location.origin, data: hit });
  emit('message', { source: parent, origin: 'https://other.test', data: hit });
  emit('message', { source: parent, origin: location.origin, data: { ...hit, player: 2 } });
  expect(vibrate).not.toHaveBeenCalled();
  emit('message', { source: parent, origin: location.origin, data: hit });
  expect(vibrate).toHaveBeenCalledWith(40);
  state({ playing: true, paused: true });
  expect(locks[0].release).toHaveBeenCalledTimes(1);
  tick(100);
  emit('message', { source: parent, origin: location.origin, data: hit });
  expect(vibrate.mock.calls.filter(([duration]) => duration > 0)).toEqual([[40]]);
  state({ playing: true, paused: false });
  await Promise.resolve();
  expect(request).toHaveBeenCalledTimes(2);
  elements.get('toggle-settings').onclick();
  expect(locks[1].release).toHaveBeenCalledTimes(1);
  elements.get('toggle-settings').onclick();
  await Promise.resolve();
  expect(request).toHaveBeenCalledTimes(3);
  document.hidden = true;
  documentListeners.get('visibilitychange')();
  expect(locks[2].release).toHaveBeenCalledTimes(1);
  document.hidden = false;
  documentListeners.get('visibilitychange')();
  await Promise.resolve();
  expect(request).toHaveBeenCalledTimes(4);
  emit('pagehide');
  expect(locks[3].release).toHaveBeenCalledTimes(1);
  for (let i = 0; i < 20; i++) tick();
  expect(request).toHaveBeenCalledTimes(4);
});

for (const [name, hand, expected] of teamRecordings) for (const gain of [1, .5, .65, .8]) {
  test(`team's recorded sensor swings reach gameplay after calibration: ${name}, strength ${gain}`, async () => {
    const recording = JSON.parse(readFileSync(new URL(`../fixtures/team-motion/${name}.json`, import.meta.url), 'utf8'));
    await import('@wee/src/controller/main.js');
    elements.get('hand').value = hand;
    await calibrate();
    state({ playing: true, paused: false });
    let previous = 0;
    for (const sample of recording.samples ?? recording) {
      // Fixtures are bias-corrected. Add the measured zero offset back before
      // delivering DeviceMotion events, to exercise actual controller correction.
      tick(sample.timeMs - previous, { alpha: sample.rotationAlpha * gain + .1,
        beta: sample.rotationBeta * gain - .1, gamma: sample.rotationGamma * gain + .2 });
      previous = sample.timeMs;
    }
    expect(relay.sendSwing.mock.calls).toEqual(expected.map(label => [label, hand, expect.any(Number), placement()]));
    expectBoundedPlacement();
    for (const [, , power] of relay.sendSwing.mock.calls) {
      expect(power).toBeGreaterThanOrEqual(0.2);
      expect(power).toBeLessThanOrEqual(1);
    }
    expect(messages).toContainEqual(expect.objectContaining({ type: 'wee:controller-setup', setup: 'motion' }));
  });
}


test('granted parent intent is idempotent and only fresh real readings report motion ready', async () => {
  location.search += '&sport=bowling';
  await import('@wee/src/controller/main.js');
  const intent = () => emit('message', {source: parent, origin: location.origin,
    data: {type: 'wee:controller-intent', mode: 'motion', permission: 'granted'}});
  intent(); await Promise.resolve();
  tick(500, null);
  expect(messages.filter(message => message.type === 'wee:controller-setup').at(-1)?.setup).toBeNull();
  for (let i = 0; i < 10; i++) {intent(); tick(20, {alpha: 100, beta: 70, gamma: -40});}
  expect(permission).not.toHaveBeenCalled();
  expect(messages.filter(message => message.type === 'wee:controller-setup').at(-1)?.setup).toBe('motion');
  expect(window.sessionStorage.getItem(CALIBRATION_STORAGE_KEY)).toBeNull();
  tick(300, null);
  expect(messages.filter(message => message.type === 'wee:controller-setup').at(-1)?.setup).toBe('motion');
  tick(1250, null);
  expect(messages.filter(message => message.type === 'wee:controller-setup').at(-1)?.setup).toBeNull();
  for (let i = 0; i < 10; i++) tick();
  expect(messages.filter(message => message.type === 'wee:controller-setup').at(-1)?.setup).toBe('motion');
});

test('natural motion sends one roll, never retries after ACK or timeout, and waits for the next real turn', async () => {
  location.search += '&sport=bowling';
  await import('@wee/src/controller/main.js');
  for (let i = 0; i < 10; i++) tick();
  state({playing: true, paused: false, sport: 'bowling', gameId: 'auto-bowl', generation: 1});
  const bowlingState = (phase, currentPlayer = 1, canRoll = phase === 'ready') => emit('message', {source: parent, origin: location.origin,
    data: {type: 'wee:bowling-state', phase, currentPlayer, canRoll}});
  const rest = () => {for (let i = 0; i < 16; i++) tick();};
  const bowl = () => {for (let i = 0; i < 35; i++) tick(20, {alpha: i < 15 ? 400 : 0, beta: i < 20 ? 100 : 0, gamma: 0});};
  const rolls = () => messages.filter(message => message.type === 'wee:player-roll');
  bowlingState('ready', 2); rest(); bowl(); expect(rolls()).toHaveLength(0);
  bowlingState('ready'); rest(); bowl(); expect(rolls()).toHaveLength(1);
  emit('message', {source: parent, origin: location.origin, data: {type: 'wee:roll-ack', result: {id: rolls()[0].event.id, ok: true, receivers: 1}}});
  rest(); bowl(); expect(rolls()).toHaveLength(1);
  state({playing: true, paused: true, connected: false, gameId: 'auto-bowl', generation: 2});
  bowlingState('ready', 1, false);
  state({playing: true, paused: false, gameId: 'auto-bowl', generation: 3});
  bowlingState('ready');
  rest(); bowl(); expect(rolls()).toHaveLength(1);
  bowlingState('rolling'); bowlingState('ready'); rest(); bowl(); expect(rolls()).toHaveLength(2);
  tick(4500, null); rest(); bowl(); expect(rolls()).toHaveLength(2);
  expect(permission).not.toHaveBeenCalled();
});

test.each(['buttons', 'motion'])('the next authoritative bowling turn unlocks %s without the old ACK and ignores its late reply', async mode => {
  location.search += '&sport=bowling';
  await import('@wee/src/controller/main.js');
  if (mode === 'buttons') elements.get('use-buttons').onclick();
  else await calibrate();
  state({playing: true, paused: false, sport: 'bowling', gameId: 'lost-ack', generation: 1});
  const lane = (phase, canRoll = phase === 'ready') => emit('message', {source: parent, origin: location.origin,
    data: {type: 'wee:bowling-state', phase, currentPlayer: 1, canRoll}});
  const bowl = () => {
    if (mode === 'buttons') elements.get('roll').onclick();
    else {
      for (let i = 0; i < 16; i++) tick();
      for (let i = 0; i < 35; i++) tick(20, {alpha: i < 15 ? 400 : 0, beta: 0, gamma: 0});
    }
  };
  const rolls = () => messages.filter(message => message.type === 'wee:player-roll');
  lane('ready'); bowl(); expect(rolls()).toHaveLength(1);
  const firstId = rolls()[0].event.id;
  // The old release is unresolved; pause/reconnect or another ready snapshot
  // must not permit a duplicate throw in this same turn.
  state({playing: true, paused: true, connected: false, gameId: 'lost-ack', generation: 2});
  lane('ready', false);
  state({playing: true, paused: false, gameId: 'lost-ack', generation: 3});
  lane('ready'); bowl(); expect(rolls()).toHaveLength(1);
  // No release ACK arrives, but the TV finishes that ball and starts the next.
  lane('rolling'); lane('ready'); bowl(); expect(rolls()).toHaveLength(2);
  emit('message', {source: parent, origin: location.origin,
    data: {type: 'wee:roll-ack', result: {id: firstId, ok: false, error: 'network-busy'}}});
  bowl(); expect(rolls()).toHaveLength(2);
  lane('rolling'); lane('ready'); bowl(); expect(rolls()).toHaveLength(3);
});

test('bowling asks for a steady hand until motion is armed and updates the prompt on the ready sample', async () => {
  location.search += '&sport=bowling';
  await import('@wee/src/controller/main.js');
  await calibrate();
  state({playing: true, paused: false, sport: 'bowling', gameId: 'ready-cue', generation: 1});
  emit('message', {source: parent, origin: location.origin,
    data: {type: 'wee:bowling-state', phase: 'ready', currentPlayer: 1, canRoll: true}});
  expect(elements.get('play-title').textContent).toBe('Hold still for a moment');
  // Do not advance UI timers: recognition itself must reveal the ready cue.
  for (let i = 0; i < 16; i++) {
    now += 20;
    emit('devicemotion', {rotationRate: {alpha: .1, beta: -.1, gamma: .2}});
  }
  expect(elements.get('play-title').textContent).toBe('Swing forward to bowl');
  expect(messages.filter(message => message.type === 'wee:player-roll')).toHaveLength(0);
  for (let i = 0; i < 35; i++) tick(20, {alpha: i < 15 ? 400 : 0, beta: 0, gamma: 0});
  expect(messages.filter(message => message.type === 'wee:player-roll')).toHaveLength(1);
});

test.each(['network-busy', 'paused', 'disconnected'])('a bowling %s rejection permits a fresh delivery without waiting for a nonexistent turn', async error => {
  location.search += '&sport=bowling';
  await import('@wee/src/controller/main.js');
  for (let i = 0; i < 10; i++) tick();
  state({playing: true, paused: false, sport: 'bowling', gameId: 'auto-bowl', generation: 1});
  emit('message', {source: parent, origin: location.origin,
    data: {type: 'wee:bowling-state', phase: 'ready', currentPlayer: 1, canRoll: true}});
  const rest = () => {for (let i = 0; i < 16; i++) tick();};
  const bowl = () => {for (let i = 0; i < 35; i++) tick(20, {alpha: i < 15 ? 400 : 0, beta: 0, gamma: 0});};
  const rolls = () => messages.filter(message => message.type === 'wee:player-roll');
  rest(); bowl(); expect(rolls()).toHaveLength(1);
  // A stale reply cannot clear the active release or consume its acknowledgement.
  emit('message', {source: parent, origin: location.origin,
    data: {type: 'wee:roll-ack', result: {id: 'old-roll', ok: false, error}}});
  rest(); bowl(); expect(rolls()).toHaveLength(1);
  emit('message', {source: parent, origin: location.origin,
    data: {type: 'wee:roll-ack', result: {id: rolls()[0].event.id, ok: false, error}}});
  rest(); bowl(); expect(rolls()).toHaveLength(2);
  expect(rolls()[1].event.id).not.toBe(rolls()[0].event.id);
});


test('returning a pending bowling roll to the lobby clears waiting and settings for the next match', async () => {
  location.search += '&sport=bowling';
  await import('@wee/src/controller/main.js');
  elements.get('use-buttons').onclick();
  state({playing: true, paused: false, sport: 'bowling', gameId: 'old', generation: 1});
  const lane = () => emit('message', {source: parent, origin: location.origin, data: {
    type: 'wee:bowling-state', phase: 'ready', currentPlayer: 1, canRoll: true,
  }});
  lane();
  elements.get('roll').onclick();
  expect(messages.filter(message => message.type === 'wee:player-roll')).toHaveLength(1);
  elements.get('toggle-settings').onclick();
  state({playing: false, paused: true, sport: 'bowling', gameId: null, generation: 2});
  expect(elements.get('play-title').textContent).toBe('You’re in');
  expect(elements.get('controller-options').hidden).toBe(true);
  expect(messages.filter(message => message.type === 'wee:controller-setup').at(-1).setup).toBe('buttons');
  state({playing: true, paused: false, sport: 'bowling', gameId: 'next', generation: 3});
  lane();
  expect(elements.get('roll').disabled).toBe(false);
  expect(elements.get('play-title').textContent).toBe('Choose your line');
});

test('the prominent Back to play control leaves settings and restores the live controller', async () => {
  await import('@wee/src/controller/main.js');
  elements.get('use-buttons').onclick();
  state({playing: true, paused: false, sport: 'tennis', gameId: 'game'});
  elements.get('toggle-settings').onclick();
  expect(elements.get('back-to-play').hidden).toBe(false);
  expect(elements.get('toggle-settings').hidden).toBe(true);
  expect(elements.get('play-panel').hidden).toBe(true);
  elements.get('back-to-play').onclick();
  expect(elements.get('back-to-play').hidden).toBe(true);
  expect(elements.get('controller-options').hidden).toBe(true);
  expect(elements.get('manual-controls').hidden).toBe(false);
});
