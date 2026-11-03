import { afterEach, expect, test, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { createInputId } from '../src/network/inputId.js';
import { connectSwings } from '../src/network/swingConnection.js';

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
const lanCrypto = () => vi.stubGlobal('crypto', { getRandomValues: webcrypto.getRandomValues.bind(webcrypto) });

test('input IDs stay unique on insecure origins where randomUUID is absent', () => {
  lanCrypto();
  const ids = Array.from({ length: 2000 }, createInputId);
  expect(new Set(ids).size).toBe(ids.length);
  expect(ids.every(id => /^[0-9a-f]{32}$/.test(id))).toBe(true);
  expect(ids.every(id => /^[a-zA-Z0-9-]{6,40}$/.test(id.slice(0, 8)))).toBe(true);
});

test('secure contexts use randomUUID and older WebViews have a bounded unique fallback', () => {
  const randomUUID = vi.fn(() => 'test-uuid');
  vi.stubGlobal('crypto', { randomUUID });
  expect(createInputId()).toBe('test-uuid');
  expect(randomUUID).toHaveBeenCalledTimes(1);
  vi.stubGlobal('crypto', undefined);
  const ids = Array.from({ length: 1000 }, createInputId);
  expect(new Set(ids).size).toBe(ids.length);
  expect(ids.every(id => /^[a-zA-Z0-9-]{6,100}$/.test(id))).toBe(true);
});

test('HTTP phone tennis buttons deliver through the lobby without randomUUID', () => {
  lanCrypto();
  const messages = [], listeners = new Set();
  const parent = { postMessage: data => messages.push(data) };
  vi.stubGlobal('location', { origin: 'http://192.168.1.10:5173', search: '?lobby=CCCC' });
  vi.stubGlobal('window', { parent, isSecureContext: false,
    addEventListener: (_type, fn) => listeners.add(fn), removeEventListener: (_type, fn) => listeners.delete(fn) });
  const connection = connectSwings({ room: 'lobby-CCCC', role: 'phone' });
  for (const listener of listeners) listener({ source: parent, origin: location.origin,
    data: { type: 'wee:lobby-state', connected: true, paused: false } });
  expect(connection.sendSwing('Forehand', 'Right')).toBe(true);
  expect(connection.sendSwing('Backhand', 'Left')).toBe(true);
  const strokes = messages.filter(message => message.type === 'wee:player-swing');
  expect(strokes).toHaveLength(2);
  expect(strokes[0].event.id).not.toBe(strokes[1].event.id);
  connection.close();
});

test('HTTP standalone tennis relay also sends strokes without randomUUID', () => {
  lanCrypto();
  let socket;
  class MockSocket {
    static OPEN = 1;
    readyState = 1;
    send = vi.fn();
    close = vi.fn();
    constructor() { socket = this; }
  }
  const standalone = {};
  standalone.parent = standalone;
  vi.stubGlobal('window', standalone);
  vi.stubGlobal('location', { href: 'http://192.168.1.10:5173/controller.html?room=local123', protocol: 'http:', search: '?room=local123' });
  vi.stubGlobal('WebSocket', MockSocket);
  const connection = connectSwings({ room: 'local123', role: 'phone' });
  expect(connection.sendSwing('Forehand', 'Right')).toBe(true);
  expect(JSON.parse(socket.send.mock.calls[0][0])).toMatchObject({ type: 'swing', id: expect.any(String), label: 'Forehand' });
  connection.close();
});

test('HTTP bowling button controller sends a release without enabling motion or randomUUID', async () => {
  vi.resetModules(); vi.useFakeTimers(); lanCrypto();
  const elements = new Map(), listeners = new Set(), messages = [];
  const parent = { postMessage: data => messages.push(data) };
  vi.stubGlobal('location', { origin: 'http://192.168.1.10:5173', search: '?room=lobby-CCCC&lobby=CCCC&sport=bowling&player=1' });
  vi.stubGlobal('window', { parent, isSecureContext: false,
    addEventListener: (_type, fn) => listeners.add(fn), removeEventListener: (_type, fn) => listeners.delete(fn) });
  vi.stubGlobal('document', { hidden: false,
    getElementById(id) { if (!elements.has(id)) elements.set(id, { dataset: {}, value: id === 'power' ? '.7' : '0' }); return elements.get(id); },
    addEventListener() {},
  });
  await import('../src/controller/main.js');
  const message = data => { for (const listener of listeners) listener({ source: parent, origin: location.origin, data }); };
  elements.get('use-buttons').onclick();
  message({ type: 'wee:lobby-state', connected: true, paused: false, playing: true });
  message({ type: 'wee:bowling-state', currentPlayer: 1, canRoll: true, phase: 'ready' });
  elements.get('roll').onclick();
  expect(messages.find(message => message.type === 'wee:player-roll')).toMatchObject({
    event: { type: 'roll', id: expect.any(String), power: .7, aim: 0, spin: 0 },
  });
  vi.clearAllTimers();
});
