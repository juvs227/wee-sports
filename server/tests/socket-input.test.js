import {afterEach, beforeEach, expect, test, vi} from 'vitest';
import {Manager} from 'socket.io-client';

const h = vi.hoisted(() => ({socket: null}));
vi.mock('socket.io-client', async () => ({...(await vi.importActual('socket.io-client')), io: () => h.socket}));

let packets, request, requestSwing;
beforeEach(async () => {
  vi.resetModules(); vi.useFakeTimers();
  const manager = new Manager('http://localhost', {autoConnect: false});
  manager.engine = {transport: {writable: true}, _hasPingExpired: () => false};
  packets = [];
  manager._packet = packet => packets.push(packet);
  h.socket = manager.socket('/'); h.socket.connected = true;
  ({request, requestSwing} = await import('@client/lib/socket.js'));
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });
const input = {type: 'swing', id: 'one', gameId: 'current', hand: 'Right', label: 'Forehand'};

test('blocked motion expires without entering Socket.IO buffers or replaying on recovery', async () => {
  h.socket.io.engine.transport.writable = false;
  const blocked = requestSwing('player:swing', input);
  await vi.advanceTimersByTimeAsync(80);
  expect(await blocked).toEqual({ok: false, error: 'network-busy'});
  expect(packets).toEqual([]); expect(h.socket.sendBuffer).toEqual([]);
  expect(Object.keys(h.socket.acks)).toEqual([]);
  h.socket.io.engine.transport.writable = true;
  h.socket.emitBuffered();
  expect(packets).toEqual([]);
  const pending = requestSwing('player:swing', {...input, id: 'fresh'});
  await Promise.resolve();
  expect(packets).toHaveLength(1);
  expect(packets[0].data).toEqual(['player:swing', {...input, id: 'fresh'}]);
  h.socket.onack({id: packets[0].id, data: [{ok: true, receivers: 1}]});
  expect(await pending).toEqual({ok: true, receivers: 1});
});

test('a normal polling handoff waits briefly and delivers exactly once without queued bursts', async () => {
  h.socket.io.engine.transport.writable = false;
  const pending = requestSwing('player:swing', input);
  const excess = await Promise.all(Array.from({length: 12}, (_, i) => requestSwing('player:swing', {...input, id: `extra-${i}`})));
  expect(excess.every(result => result.error === 'network-busy')).toBe(true);
  await vi.advanceTimersByTimeAsync(20);
  h.socket.io.engine.transport.writable = true;
  await vi.advanceTimersByTimeAsync(4);
  expect(packets).toHaveLength(1);
  expect(h.socket.sendBuffer).toEqual([]);
  h.socket.onack({id: packets[0].id, data: [{ok: true}]});
  expect(await pending).toEqual({ok: true});
});

test('a match lifecycle change while waiting cancels the old motion even after recovery', async () => {
  h.socket.io.engine.transport.writable = false;
  let current = true;
  const pending = requestSwing('player:swing', input, () => current);
  await vi.advanceTimersByTimeAsync(12);
  current = false; h.socket.io.engine.transport.writable = true;
  await vi.advanceTimersByTimeAsync(4);
  expect(await pending).toEqual({ok: false, error: 'not-playing'});
  expect(packets).toEqual([]); expect(h.socket.sendBuffer).toEqual([]);
});

test('offline motion never queues while ordinary ready/settings requests retain reliable delivery', async () => {
  h.socket.connected = false;
  expect(await requestSwing('player:swing', input)).toEqual({ok: false, error: 'disconnected'});
  expect(h.socket.sendBuffer).toEqual([]);
  h.socket.connected = true; h.socket.io.engine.transport.writable = false;
  const pending = request('player:ready', {ready: true});
  expect(packets[0].data).toEqual(['player:ready', {ready: true}]);
  h.socket.onack({id: packets[0].id, data: [{ok: true}]});
  expect(await pending).toEqual({ok: true});
});

test('unacknowledged strokes settle on timeout and cannot leave pending acknowledgement handlers', async () => {
  const pending = requestSwing('player:swing', input);
  await vi.advanceTimersByTimeAsync(2000);
  expect(await pending).toEqual({ok: false, error: 'timeout'});
  expect(Object.keys(h.socket.acks)).toEqual([]);
  expect(h.socket.sendBuffer).toEqual([]);
});
