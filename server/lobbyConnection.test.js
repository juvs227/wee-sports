import { test, expect, vi, afterEach } from 'vitest';
import { connectSwings } from '../src/network/swingConnection.js';

afterEach(() => vi.unstubAllGlobals());

function embedded(role) {
  const listeners = new Set();
  const parent = { postMessage: vi.fn() };
  vi.stubGlobal('window', { parent,
    addEventListener: (_name, listener) => listeners.add(listener),
    removeEventListener: (_name, listener) => listeners.delete(listener) });
  vi.stubGlobal('location', { origin: 'http://localhost:5173', search: '?lobby=CCCC' });
  const websocket = vi.fn();
  vi.stubGlobal('WebSocket', websocket);
  const onSwing = vi.fn(), onAck = vi.fn(), onStatus = vi.fn();
  const connection = connectSwings({ room: 'lobby-CCCC', role, onSwing, onAck, onStatus });
  const receive = (data, source = parent, origin = location.origin) => {
    for (const listener of listeners) listener({ data, source, origin });
  };
  return { connection, receive, parent, websocket, onSwing, onAck, onStatus, listeners };
}

test('embedded phone uses only the lobby connection and never queues a paused swing', () => {
  const f = embedded('phone');
  expect(f.websocket).not.toHaveBeenCalled();
  expect(f.connection.sendSwing('Forehand', 'Right')).toBe(false);
  f.receive({ type: 'wee:lobby-state', connected: true, paused: false });
  expect(f.connection.sendSwing('Forehand', 'Right')).toBe(true);
  expect(f.parent.postMessage.mock.lastCall[0]).toMatchObject({ type: 'wee:player-swing', event: { label: 'Forehand' } });
  f.receive({ type: 'wee:lobby-state', connected: false, paused: true });
  const count = f.parent.postMessage.mock.calls.length;
  expect(f.connection.sendSwing('Backhand', 'Left')).toBe(false);
  f.receive({ type: 'wee:lobby-state', connected: true, paused: false });
  expect(f.parent.postMessage).toHaveBeenCalledTimes(count);
  f.connection.close();
  expect(f.listeners.size).toBe(0);
});

test('embedded game validates parent/origin, ignores duplicates, and stops while paused', () => {
  const f = embedded('game');
  const event = { type: 'swing', id: 'one', label: 'Backhand', hand: 'Left' };
  f.receive({ type: 'wee:lobby-state', connected: true, paused: false });
  f.receive({ type: 'wee:game-swing', event }, {});
  f.receive({ type: 'wee:game-swing', event }, f.parent, 'https://another.example');
  expect(f.onSwing).not.toHaveBeenCalled();
  f.receive({ type: 'wee:game-swing', event });
  f.receive({ type: 'wee:game-swing', event });
  expect(f.onSwing).toHaveBeenCalledTimes(1);
  f.receive({ type: 'wee:lobby-state', connected: true, paused: true });
  f.receive({ type: 'wee:game-swing', event: { ...event, id: 'two' } });
  expect(f.onSwing).toHaveBeenCalledTimes(1);
  f.connection.close();
});
