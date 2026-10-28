import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const relay = vi.hoisted(() => ({ sendSwing: vi.fn(() => true) }));
vi.mock('../src/network/swingConnection.js', () => ({ connectSwings: () => relay }));
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
  vi.stubGlobal('DeviceMotionEvent', motionAPI);
  vi.stubGlobal('window', { parent, isSecureContext: true, DeviceMotionEvent: motionAPI,
    addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); },
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
const tick = (ms = 20, rate = { alpha: 0.1, beta: -.1, gamma: .2 }) => {
  now += ms;
  if (rate) emit('devicemotion', { rotationRate: rate });
  vi.advanceTimersByTime(ms);
};
async function calibrate() {
  await elements.get('calibrate').onclick();
  for (let i = 0; i < 110; i++) tick();
}

test('Calibrate itself requests permission; only real still readings unlock setup and play starts automatically', async () => {
  await import('../src/controller/main.js');
  expect(elements.get('calibrate').disabled).toBe(false);
  expect(elements.get('setup-panel').hidden).toBe(false);
  expect(elements.get('play-panel').hidden).toBe(true);
  state({});
  await calibrate();
  expect(permission).toHaveBeenCalledTimes(1);
  expect(messages).toContainEqual({ type: 'wee:controller-setup', setup: 'motion' });
  expect(elements.get('setup-panel').hidden).toBe(true);
  expect(elements.get('play-panel').hidden).toBe(false);
  expect(elements.get('play-title').textContent).toBe('You’re ready');
  expect(elements.get('stop').disabled).toBe(true); // Lobby cannot send strokes.
  state({ playing: true, paused: false });
  expect(elements.get('play-title').textContent).toBe('Swing to play');
  expect(elements.get('stop').disabled).toBe(false);
  for (let i = 0; i < 15; i++) tick(20, { alpha: 300, beta: 600, gamma: 0 });
  for (let i = 0; i < 10; i++) tick();
  expect(relay.sendSwing).toHaveBeenCalledWith('Forehand', 'Right');
});

test('opening settings preserves calibration but drops a partial swing and prevents strokes until returning', async () => {
  await import('../src/controller/main.js');
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
  expect(relay.sendSwing.mock.calls).toEqual([['Forehand', 'Right']]);
  expect(permission).toHaveBeenCalledTimes(1);
  expect(messages.filter(message => message.type === 'wee:controller-setup')).toHaveLength(savedSetupCount);
});

test('pause, reconnect and stale sensors show the next action while preserving calibration and dropping partial motion', async () => {
  await import('../src/controller/main.js');
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

test('a rejected setup save remains visible on the calibrated waiting screen', async () => {
  await import('../src/controller/main.js');
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
  await import('../src/controller/main.js');
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
  for (let i = 0; i < 40; i++) tick(20, { alpha: 0, beta: i < 20 ? 400 * Math.sin(Math.PI * i / 20) : 0, gamma: 0 });
  expect(messages.filter(message => message.type === 'wee:player-roll')).toHaveLength(0);
  expect(elements.get('shot-adjustments').hidden).toBe(false);
  expect(elements.get('play-title').textContent).toBe('Your turn');
  elements.get('arm-roll').onclick();
  elements.get('toggle-settings').onclick();
  elements.get('toggle-settings').onclick();
  expect(elements.get('play-title').textContent).toBe('Your turn');
  expect(messages.filter(message => message.type === 'wee:player-roll')).toHaveLength(0);
  elements.get('arm-roll').onclick();
  for (let i = 0; i < 40; i++) tick(20, { alpha: 0, beta: i < 20 ? 400 * Math.sin(Math.PI * i / 20) : 0, gamma: 0 });
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
  await import('../src/controller/main.js');
  state({});
  await elements.get('calibrate').onclick();
  for (let i = 0; i < 51; i++) tick(200, { alpha: null, beta: null, gamma: null });
  expect(messages).not.toContainEqual({ type: 'wee:controller-setup', setup: 'motion' });
  expect(elements.get('motion').textContent).toContain('live gyroscope readings');
  expect(elements.get('sensor-status').textContent).toContain('without gyroscope data');
});

test('insecure phone links and denied permission provide a usable explanation', async () => {
  window.isSecureContext = false;
  await import('../src/controller/main.js');
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
  expect(relay.sendSwing).toHaveBeenCalledWith('Forehand', 'Right');
  state({ playing: true, paused: true });
  expect(elements.get('manual-controls').hidden).toBe(true);
});

test('explicit Stop stays stopped across lobby updates; hiding or pausing cannot emit a partial stroke', async () => {
  await import('../src/controller/main.js');
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
  await import('../src/controller/main.js');
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
  await import('../src/controller/main.js');
  await calibrate();
  state({ playing: true, paused: false });
  emit('message', { source: parent, origin: location.origin,
    data: { type: 'wee:bowling-state', canRoll: true, currentPlayer: 1, phase: 'ready' } });
  const bowl = () => { for (let i = 0; i < 40; i++) tick(20, { alpha: 0, beta: i < 20 ? 400 * Math.sin(Math.PI * i / 20) : 0, gamma: 0 }); };
  bowl();
  expect(messages.filter(message => message.type === 'wee:player-roll')).toHaveLength(0);
  elements.get('arm-roll').onclick();
  bowl();
  expect(messages.filter(message => message.type === 'wee:player-roll')).toHaveLength(1);
  expect(relay.sendSwing).not.toHaveBeenCalled();
});

const teamRecordings = [
  ['two-forehands-one-backhand', 'Right', ['Forehand', 'Forehand', 'Backhand']],
  ['four-backhands', 'Right', Array(4).fill('Backhand')],
  ['left-four-backhands-new', 'Left', Array(4).fill('Backhand')],
  ['left-four-forehands', 'Left', Array(4).fill('Forehand')],
  ['left-mixed', 'Left', ['Forehand', 'Backhand', 'Forehand', 'Backhand']],
];
for (const [name, hand, expected] of teamRecordings) {
  test(`team's recorded sensor swings reach gameplay after calibration: ${name}`, async () => {
    const recording = JSON.parse(readFileSync(new URL(`./fixtures/team-motion/${name}.json`, import.meta.url), 'utf8'));
    await import('../src/controller/main.js');
    elements.get('hand').value = hand;
    await calibrate();
    state({ playing: true, paused: false });
    let previous = 0;
    for (const sample of recording.samples ?? recording) {
      // Fixtures are bias-corrected. Add the measured zero offset back before
      // delivering DeviceMotion events, to exercise actual controller correction.
      tick(sample.timeMs - previous, { alpha: sample.rotationAlpha + .1,
        beta: sample.rotationBeta - .1, gamma: sample.rotationGamma + .2 });
      previous = sample.timeMs;
    }
    expect(relay.sendSwing.mock.calls).toEqual(expected.map(label => [label, hand]));
    expect(messages).toContainEqual({ type: 'wee:controller-setup', setup: 'motion' });
  });
}
