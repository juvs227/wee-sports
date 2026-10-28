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
      if (!elements.has(id)) elements.set(id, { textContent: '', value: id === 'hand' ? 'Right' : id === 'response' ? 'early' : id === 'stroke-mode' ? 'auto' : id === 'power' ? '0.7' : '0', checked: true, dataset: {} });
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
  state({});
  await calibrate();
  expect(permission).toHaveBeenCalledTimes(1);
  expect(messages).toContainEqual({ type: 'wee:controller-setup', setup: 'motion' });
  expect(elements.get('stop').disabled).toBe(true); // Lobby cannot send strokes.
  state({ playing: true, paused: false });
  expect(elements.get('stop').disabled).toBe(false);
  for (let i = 0; i < 15; i++) tick(20, { alpha: 300, beta: 600, gamma: 0 });
  expect(relay.sendSwing).toHaveBeenCalledWith('Forehand', 'Right');
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
  elements.get('roll').onclick();
  expect(messages.filter(message => message.type === 'wee:player-roll')).toHaveLength(0);
  bowlingState(1);
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
