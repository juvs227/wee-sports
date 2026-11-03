import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { EVENTS } from '../shared/protocol.js';

const h = vi.hoisted(() => ({ refs: [], effects: [], socketHandlers: new Map(),
  emit: vi.fn(), request: vi.fn(async () => ({ ok: true })), connection: 'online' }));
vi.mock('react', async () => ({ ...(await vi.importActual('react')),
  useRef(value) { const ref = { current: value }; h.refs.push(ref); return ref; },
  useState(value) { return [value, () => {}]; },
  useEffect(effect) { h.effects.push(effect); },
}));
vi.mock('../client/src/lib/socket.js', () => ({ request: h.request, useConnection: () => h.connection,
  socket: { connected: true, volatile: { emit: h.emit },
    on(name, fn) { h.socketHandlers.set(name, fn); }, off(name) { h.socketHandlers.delete(name); } } }));
import { PrototypeFrame } from '../client/src/components/PrototypeFrame.jsx';

let listener;
let cleanups;
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks();
  h.refs = []; h.effects = []; h.socketHandlers.clear(); h.connection = 'online'; cleanups = [];
  // Vitest's minimal transform uses classic JSX; only effects are under test.
  vi.stubGlobal('React', { createElement: () => null });
  vi.stubGlobal('window', { location: { origin: 'https://wee.test' },
    addEventListener(_event, callback) { listener = callback; }, removeEventListener() { listener = null; } });
});
afterEach(() => { cleanups.forEach(cleanup => cleanup?.()); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

function mount(overrides = {}) {
  const onAudio = vi.fn();
  PrototypeFrame({ code: 'ABCD', gameId: 'match-a', sport: 'tennis', onAudio, ...overrides });
  const contentWindow = { postMessage: vi.fn() };
  h.refs[0].current = { contentWindow };
  cleanups = h.effects.map(effect => effect());
  const receive = (data, envelope = {}) => listener({ data, source: contentWindow, origin: window.location.origin, ...envelope });
  receive({ type: 'wee:bridge-ready' });
  return { onAudio, contentWindow, receive };
}

test('homepage audio accepts only the current game frame, sport, session and known event', async () => {
  const f = mount();
  const audio = { type: 'wee:game-audio', gameId: 'match-a', sport: 'tennis', event: 'hit' };
  await f.receive(audio, { source: {} }); await f.receive(audio, { origin: 'https://wrong.test' });
  await f.receive({ ...audio, gameId: 'old' }); await f.receive({ ...audio, sport: 'bowling' });
  await f.receive({ ...audio, event: 'external-url' });
  expect(f.onAudio).not.toHaveBeenCalled();
  await f.receive(audio); expect(f.onAudio).toHaveBeenCalledExactlyOnceWith('hit');
  const result = { type: 'wee:stroke-result', id: 'stroke', gameId: 'match-a', player: 1,
    result: 'hit', reason: 'Good contact', receivedToContactMs: 66 };
  await f.receive(result);
  expect(h.emit).toHaveBeenCalledExactlyOnceWith(EVENTS.HOST_STROKE_RESULT, result);
});

test.each([{ paused: true }, { playing: false }, { controller: true }])('inactive/phone frames cannot send TV effects: %j', async props => {
  const f = mount(props);
  await f.receive({ type: 'wee:game-audio', gameId: 'match-a', sport: 'tennis', event: 'hit' });
  expect(f.onAudio).not.toHaveBeenCalled();
});

test('stroke feedback is forwarded only to the current phone seat and match', () => {
  const f = mount({ controller: true, player: 1 });
  f.contentWindow.postMessage.mockClear();
  const result = { id: 'stroke', gameId: 'match-a', player: 1, result: 'miss', reason: 'Too late' };
  const receive = h.socketHandlers.get(EVENTS.GAME_STROKE_RESULT);
  receive({ ...result, player: 2 }); receive({ ...result, gameId: 'old' });
  expect(f.contentWindow.postMessage).not.toHaveBeenCalled();
  receive(result);
  expect(f.contentWindow.postMessage).toHaveBeenCalledExactlyOnceWith({ ...result, type: 'wee:stroke-result' }, window.location.origin);
});
