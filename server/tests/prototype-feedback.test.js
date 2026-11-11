import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { EVENTS } from '@wee/shared/protocol.js';

const h = vi.hoisted(() => ({ refs: [], effects: [], refIndex: 0, reuseRefs: false, socketHandlers: new Map(),
  emit: vi.fn(), requestSwing: vi.fn(async () => ({ ok: true })), request: vi.fn(async () => ({ ok: true })), connection: 'online' }));
vi.mock('react', async () => ({ ...(await vi.importActual('react')),
  useRef(value) {
    if (h.reuseRefs) return h.refs[h.refIndex++];
    const ref = { current: value }; h.refs.push(ref); return ref;
  },
  useState(value) { return [value, () => {}]; },
  useEffect(effect, deps) { h.effects.push({ effect, deps }); },
}));
vi.mock('@client/lib/socket.js', () => ({ request: h.request, requestSwing: h.requestSwing, useConnection: () => h.connection,
  socket: { connected: true, volatile: { emit: h.emit },
    on(name, fn) { h.socketHandlers.set(name, fn); }, off(name) { h.socketHandlers.delete(name); } } }));
import { PrototypeFrame } from '@client/components/PrototypeFrame.jsx';

let listener;
let cleanups;
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks();
  h.refs = []; h.effects = []; h.refIndex = 0; h.reuseRefs = false;
  h.socketHandlers.clear(); h.connection = 'online'; cleanups = [];
  // Vitest's minimal transform uses classic JSX; only effects are under test.
  vi.stubGlobal('React', { createElement: () => null });
  vi.stubGlobal('window', { location: { origin: 'https://wee.test' },
    addEventListener(_event, callback) { listener = callback; }, removeEventListener() { listener = null; } });
});
afterEach(() => { cleanups.forEach(cleanup => cleanup?.()); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

function mount(overrides = {}) {
  const onAudio = vi.fn();
  let props = { code: 'ABCD', gameId: 'match-a', sport: 'tennis', onAudio, ...overrides };
  PrototypeFrame(props);
  const contentWindow = { postMessage: vi.fn() };
  h.refs[0].current = { contentWindow };
  let effects = h.effects;
  cleanups = effects.map(({ effect }) => effect());
  const receive = (data, envelope = {}) => listener({ data, source: contentWindow, origin: window.location.origin, ...envelope });
  receive({ type: 'wee:bridge-ready' });
  const rerender = changes => {
    props = { ...props, ...changes };
    h.refIndex = 0; h.reuseRefs = true; h.effects = [];
    PrototypeFrame(props);
    h.reuseRefs = false;
    h.effects.forEach(({ effect, deps }, index) => {
      if (deps.some((dep, depIndex) => !Object.is(dep, effects[index].deps[depIndex]))) {
        cleanups[index]?.(); cleanups[index] = effect();
      }
    });
    effects = h.effects;
  };
  const unmount = () => { cleanups.forEach(cleanup => cleanup?.()); cleanups = []; };
  return { onAudio, contentWindow, receive, rerender, unmount };
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


test('switching sports keeps the same controller document and sends sport through its bridge', () => {
  const frames = [];
  React.createElement = (tag, props) => { if (tag === 'iframe') frames.push(props); return null; };
  const first = mount({ controller: true, sport: 'tennis' });
  expect(first.contentWindow.postMessage).toHaveBeenCalledWith(expect.objectContaining({
    type: 'wee:lobby-state', sport: 'tennis',
  }), window.location.origin);
  PrototypeFrame({ code: 'ABCD', controller: true, player: 1, sport: 'bowling', gameId: 'match-b' });
  expect(frames[1].src).toBe(frames[0].src);
  expect(frames[1].key).toBe(frames[0].key);
  PrototypeFrame({ code: 'ABCD', controller: false, sport: 'tennis' });
  PrototypeFrame({ code: 'ABCD', controller: false, sport: 'bowling' });
  expect(frames[2].src).not.toBe(frames[3].src);
});

const gameCommand = (extra = {}) => ({ id: 'options-1', gameId: 'match-a', action: 'configure', settings: { timingAssist: false }, ...extra });
const commandResult = (extra = {}) => ({ type: 'wee:game-command-result', id: 'options-1', gameId: 'match-a', result: { ok: true }, ...extra });

test('phone commands wait for a matching result from the current TV iframe', async () => {
  const f = mount(), ack = vi.fn();
  const command = gameCommand();
  h.socketHandlers.get(EVENTS.GAME_COMMAND)(command, ack);
  expect(f.contentWindow.postMessage).toHaveBeenCalledWith({ type: 'wee:game-command', command }, window.location.origin);
  expect(ack).not.toHaveBeenCalled();
  await f.receive(commandResult(), { source: {} });
  await f.receive(commandResult(), { origin: 'https://wrong.test' });
  await f.receive(commandResult({ gameId: 'old-match' }));
  await f.receive(commandResult({ id: 'unrelated' }));
  await f.receive(commandResult({ result: { ok: 'yes' } }));
  expect(ack).not.toHaveBeenCalled();
  await f.receive(commandResult({ result: { ok: false, error: 'solo-only' } }));
  expect(ack).toHaveBeenCalledExactlyOnceWith({ ok: false, error: 'solo-only' });
  await f.receive(commandResult());
  vi.advanceTimersByTime(2000);
  expect(ack).toHaveBeenCalledTimes(1);
});

test('commands reject stale games, unsupported sport controls and duplicate pending delivery', () => {
  const f = mount(), ack = vi.fn(), duplicateAck = vi.fn();
  const command = h.socketHandlers.get(EVENTS.GAME_COMMAND);
  f.contentWindow.postMessage.mockClear();
  command(gameCommand({ gameId: 'old' }), ack);
  command(gameCommand({ settings: { gravity: 0 } }), ack);
  expect(ack).toHaveBeenCalledTimes(2);
  expect(f.contentWindow.postMessage).not.toHaveBeenCalled();
  command(gameCommand(), ack);
  command(gameCommand(), duplicateAck);
  expect(duplicateAck).toHaveBeenCalledExactlyOnceWith({ ok: false, error: 'duplicate-command' });
  expect(f.contentWindow.postMessage).toHaveBeenCalledTimes(1);
  f.rerender({ sport: 'bowling', gameId: 'match-b' });
  f.receive({ type: 'wee:bridge-ready' });
  f.contentWindow.postMessage.mockClear();
  h.socketHandlers.get(EVENTS.GAME_COMMAND)(gameCommand({ gameId: 'match-b' }), duplicateAck);
  expect(f.contentWindow.postMessage).not.toHaveBeenCalled();
});

test('a command timeout ignores a late game result and settles only once', async () => {
  const f = mount(), ack = vi.fn();
  h.socketHandlers.get(EVENTS.GAME_COMMAND)(gameCommand(), ack);
  vi.advanceTimersByTime(1800);
  expect(ack).toHaveBeenCalledExactlyOnceWith({ ok: false, error: 'game-loading' });
  await f.receive(commandResult());
  expect(ack).toHaveBeenCalledTimes(1);
});

test.each([{ paused: true }, { playing: false }, { gameId: 'new-match' }, { connection: 'offline' }, { unmount: true }])(
  'pending game commands are cancelled on a lifecycle change: %j', async change => {
    const f = mount(), ack = vi.fn();
    h.socketHandlers.get(EVENTS.GAME_COMMAND)(gameCommand(), ack);
    if (change.unmount) f.unmount();
    else if (change.connection) { h.connection = change.connection; f.rerender({}); }
    else f.rerender(change);
    expect(ack).toHaveBeenCalledExactlyOnceWith({ ok: false, error: 'game-loading' });
    if (!change.unmount) await f.receive(commandResult());
    vi.advanceTimersByTime(2000);
    expect(ack).toHaveBeenCalledTimes(1);
  },
);

test('a phone frame cannot receive match commands or publish TV options/results', async () => {
  const f = mount({ controller: true });
  expect(h.socketHandlers.has(EVENTS.GAME_COMMAND)).toBe(false);
  await f.receive(commandResult());
  await f.receive({ type: 'wee:game-options', gameId: 'match-a', sport: 'bowling' });
  expect(h.request).not.toHaveBeenCalled();
});

test('only current validated TV options are forwarded as a sanitized snapshot', async () => {
  const f = mount({ sport: 'bowling' });
  const options = { type: 'wee:game-options', gameId: 'match-a', sport: 'bowling', extra: 'discard' };
  await f.receive(options, { source: {} });
  await f.receive({ ...options, gameId: 'old' });
  await f.receive({ ...options, sport: 'tennis' });
  expect(h.request).not.toHaveBeenCalled();
  await f.receive(options);
  expect(h.request).toHaveBeenCalledExactlyOnceWith(EVENTS.HOST_GAME_OPTIONS, { gameId: 'match-a', sport: 'bowling' });
});

test('bowling results cross only the current TV bridge and carry seat numbers rather than names', async () => {
  const f = mount({ sport: 'bowling' });
  const result = { type: 'wee:bowling-state', gameId: 'match-a', phase: 'complete', currentPlayer: null,
    frame: 10, winners: [1, 2], winnerScore: 180, names: ['Untrusted'], extra: true };
  await f.receive(result, { source: {} });
  await f.receive(result, { origin: 'https://wrong.test' });
  await f.receive({ ...result, gameId: 'old-match' });
  await f.receive({ ...result, winners: [1, 1] });
  await f.receive({ ...result, winnerScore: 301 });
  await f.receive({ ...result, phase: 'ready', currentPlayer: 1, frame: 1 });
  expect(h.request).not.toHaveBeenCalled();
  await f.receive(result);
  expect(h.request).toHaveBeenCalledExactlyOnceWith(EVENTS.HOST_GAME_STATE, {
    gameId: 'match-a', phase: 'complete', currentPlayer: null, frame: 10, winners: [1, 2], winnerScore: 180,
  });
  await f.receive({ type: 'wee:bowling-state', gameId: 'match-a', phase: 'ready', currentPlayer: 1, frame: 1 });
  expect(h.request).toHaveBeenLastCalledWith(EVENTS.HOST_GAME_STATE, {
    gameId: 'match-a', phase: 'ready', currentPlayer: 1, frame: 1,
  });
  await f.receive({ type: 'wee:bowling-state', gameId: 'match-a', phase: 'complete', currentPlayer: null, frame: 10 });
  expect(h.request).toHaveBeenLastCalledWith(EVENTS.HOST_GAME_STATE, {
    gameId: 'match-a', phase: 'complete', currentPlayer: null, frame: 10,
  });
});

test.each([{ controller: true, sport: 'bowling' }, { sport: 'tennis' }])(
  'a phone or tennis frame cannot publish bowling winners: %j', async props => {
    const f = mount(props);
    await f.receive({ type: 'wee:bowling-state', gameId: 'match-a', phase: 'complete', currentPlayer: null,
      frame: 10, winners: [1], winnerScore: 300 });
    expect(h.request).not.toHaveBeenCalled();
  },
);

test('tennis input crosses only the current playing frame and uses the unbuffered request path', async () => {
  const f = mount({controller: true});
  const event = {type: 'swing', id: 'swing-a', gameId: 'match-a', label: 'Forehand', hand: 'Right'};
  await f.receive({type: 'wee:player-swing', event: {...event, gameId: 'old'}});
  expect(h.requestSwing).not.toHaveBeenCalled();
  await f.receive({type: 'wee:player-swing', event});
  expect(h.requestSwing).toHaveBeenCalledExactlyOnceWith(EVENTS.PLAYER_SWING, event, expect.any(Function));
  expect(f.contentWindow.postMessage).toHaveBeenLastCalledWith({type: 'wee:swing-ack', gameId: 'match-a', result: {ok: true, id: 'swing-a'}}, window.location.origin);
  f.rerender({playing: false});
  await f.receive({type: 'wee:player-swing', event});
  expect(h.requestSwing).toHaveBeenCalledOnce();
});

test('a pending phone swing loses its delivery scope after pause and resume', async () => {
  const f = mount({controller: true});
  const event = {type: 'swing', id: 'waiting', gameId: 'match-a', label: 'Forehand', hand: 'Right'};
  let finish;
  h.requestSwing.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const pending = f.receive({type: 'wee:player-swing', event});
  const current = h.requestSwing.mock.calls[0][2];
  expect(current()).toBe(true);
  f.rerender({paused: true}); f.rerender({paused: false});
  expect(current()).toBe(false);
  finish({ok: false, error: 'not-playing'}); await pending;
});

test('late tennis acknowledgements and forwarded inputs cannot affect a replacement game', async () => {
  const f = mount({controller: true});
  const event = {type: 'swing', id: 'swing-a', gameId: 'match-a', label: 'Forehand', hand: 'Right'};
  let finish;
  h.requestSwing.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const pending = f.receive({type: 'wee:player-swing', event});
  f.rerender({gameId: 'match-b'}); f.contentWindow.postMessage.mockClear();
  finish({ok: true}); await pending;
  expect(f.contentWindow.postMessage).not.toHaveBeenCalled();
  f.unmount();
  h.refs = []; h.effects = []; h.refIndex = 0; h.reuseRefs = false;
  const tv = mount(), ack = vi.fn(); tv.contentWindow.postMessage.mockClear();
  h.socketHandlers.get(EVENTS.GAME_SWING)({...event, gameId: 'old'}, ack);
  expect(ack).toHaveBeenLastCalledWith({ok: false});
  expect(tv.contentWindow.postMessage).not.toHaveBeenCalled();
  h.socketHandlers.get(EVENTS.GAME_SWING)(event, ack);
  expect(tv.contentWindow.postMessage).toHaveBeenCalledExactlyOnceWith({type: 'wee:game-swing', event}, window.location.origin);
});

test('pause shortcut uses the trusted current game and can request resume while paused', async () => {
  const onPauseToggle = vi.fn();
  const f = mount({onPauseToggle, paused: true, manuallyPaused: true});
  const message = {type: 'wee:pause-toggle', gameId: 'match-a'};
  await f.receive(message, {source: {}}); await f.receive(message, {origin: 'https://wrong.test'});
  await f.receive({...message, gameId: 'old'});
  expect(onPauseToggle).not.toHaveBeenCalled();
  await f.receive(message); expect(onPauseToggle).toHaveBeenCalledOnce();
  expect(f.contentWindow.postMessage).toHaveBeenCalledWith(expect.objectContaining({type: 'wee:lobby-state', manuallyPaused: true}), window.location.origin);
  f.rerender({playing: false}); await f.receive(message);
  expect(onPauseToggle).toHaveBeenCalledOnce();
  f.rerender({playing: true, controller: true}); await f.receive(message);
  expect(onPauseToggle).toHaveBeenCalledOnce();
});
