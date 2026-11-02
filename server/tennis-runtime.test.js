import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const runtime = vi.hoisted(() => ({ world: null, close: vi.fn(),
  sound: { mountButton: vi.fn(), play: vi.fn(), setActive: vi.fn(), dispose: vi.fn() } }));
vi.mock('../src/audio/sportsAudio', () => ({ createSportsAudio: () => runtime.sound }));
vi.mock('../src/World/World', () => ({ World: class {
  constructor() {
    this.start = vi.fn(); this.stop = vi.fn(); this.dispose = vi.fn(); this.swing = vi.fn();
    this.setPlayerInput = vi.fn();
    this.ball = { userData: { isWaitingForServe: true } };
    this.score = { player1: 0, player2: 0, roundsPlayer1: 0, roundsPlayer2: 0,
      setsPlayer1: 0, setsPlayer2: 0, server: 'player1', tieBreak: false,
      completedSets: [], lastPoint: null, matchWinner: null };
    runtime.world = this;
  }
  getScore() { return this.score; }
} }));
vi.mock('../src/Controllers/inputController', () => ({ InputController: class {} }));
vi.mock('../src/network/swingConnection.js', () => ({ connectSwings: () => ({ close: runtime.close }) }));

let listeners;
let parent;
beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks(); vi.useFakeTimers();
  listeners = new Map();
  parent = { postMessage: vi.fn() };
  const elements = new Map();
  vi.stubGlobal('window', { parent,
    addEventListener(type, callback) { listeners.set(type, callback); },
    removeEventListener(type) { listeners.delete(type); },
    setInterval, clearInterval,
  });
  vi.stubGlobal('document', {
    querySelector: () => ({}),
    createElement: () => ({ setAttribute: vi.fn() }),
    body: { append: vi.fn() },
    getElementById(id) { if (!elements.has(id)) elements.set(id, {}); return elements.get(id); },
  });
  vi.stubGlobal('location', { origin: 'https://wee.test', href: 'https://wee.test/game.html?room=lobby-SOLO', search: '?room=lobby-SOLO' });
  vi.stubGlobal('history', { replaceState: vi.fn() });
  vi.stubGlobal('__PUBLIC_ORIGIN__', '');
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

const state = overrides => listeners.get('message')({ source: parent, origin: location.origin,
  data: { type: 'wee:lobby-state', paused: false, connected: true,
    gameId: 'solo-match', players: [{ slot: 0, name: 'Solo player' }], ...overrides } });

test('solo contact notifications use the current lobby match and stop while paused', async () => {
  await import('../src/main.ts');
  runtime.world.onBallHit(1);
  expect(parent.postMessage).not.toHaveBeenCalled();
  state({});
  runtime.world.onBallHit(1);
  expect(parent.postMessage).toHaveBeenLastCalledWith({ type: 'wee:game-hit', player: 1, gameId: 'solo-match' }, location.origin);
  parent.postMessage.mockClear();
  state({ paused: true });
  runtime.world.onBallHit(1);
  expect(parent.postMessage).not.toHaveBeenCalled();
  state({ gameId: 'next-solo-match' });
  runtime.world.onBallHit(1);
  expect(parent.postMessage).toHaveBeenLastCalledWith({ type: 'wee:game-hit', player: 1, gameId: 'next-solo-match' }, location.origin);
});

test('restoring a solo game from browser history asks the lobby for fresh state before resuming', async () => {
  await import('../src/main.ts');
  state({});
  runtime.world.start.mockClear();
  listeners.get('pagehide')({ persisted: true });
  expect(runtime.world.stop).toHaveBeenCalledOnce();
  listeners.get('pageshow')({ persisted: true });
  expect(parent.postMessage).toHaveBeenLastCalledWith({ type: 'wee:bridge-ready' }, location.origin);
  expect(runtime.world.start).not.toHaveBeenCalled();
  state({ paused: true });
  expect(runtime.world.start).not.toHaveBeenCalled();
  state({});
  expect(runtime.world.start).toHaveBeenCalledOnce();
});

test('serve status reaches the phone only on a state change and is refreshed after reconnect', async () => {
  await import('../src/main.ts');
  state({});
  const published = () => parent.postMessage.mock.calls.filter(([message]) => message.type === 'wee:tennis-state');
  expect(published().at(-1)[0]).toEqual({ type: 'wee:tennis-state', gameId: 'solo-match', phase: 'serve', server: 1, winner: null });
  state({}); vi.advanceTimersByTime(1000);
  expect(published()).toHaveLength(1);
  runtime.world.ball.userData.isWaitingForServe = false;
  vi.advanceTimersByTime(250);
  expect(published().at(-1)[0].phase).toBe('rally');
  runtime.world.ball.userData = { isWaitingForServe: true, serveDelayRemaining: 1.2 };
  vi.advanceTimersByTime(250);
  expect(published().at(-1)[0].phase).toBe('prepare');
  runtime.world.ball.userData.serveDelayRemaining = 0;
  vi.advanceTimersByTime(250);
  expect(published().at(-1)[0].phase).toBe('serve');
  runtime.world.score = { ...runtime.world.score, matchWinner: 'player2', setsPlayer2: 2 };
  vi.advanceTimersByTime(250);
  expect(published().at(-1)[0]).toMatchObject({ phase: 'complete', winner: 2 });
  const count = published().length;
  state({ connected: false }); state({ connected: true });
  expect(published()).toHaveLength(count + 1);
});

test('tennis audio follows real game events, not score polls, and pauses with the game', async () => {
  await import('../src/main.ts');
  runtime.world.onGameEvent({ kind: 'hit', player: 1 });
  expect(runtime.sound.play).not.toHaveBeenCalled();
  state({});
  runtime.world.onGameEvent({ kind: 'serve', player: 1 });
  expect(runtime.sound.play).toHaveBeenCalledExactlyOnceWith('serve');
  vi.advanceTimersByTime(1000);
  expect(runtime.sound.play).toHaveBeenCalledTimes(1);
  state({ paused: true });
  expect(runtime.sound.setActive).toHaveBeenLastCalledWith(false);
  runtime.world.onGameEvent({ kind: 'point', player: 1 });
  expect(runtime.sound.play).toHaveBeenCalledTimes(1);
  listeners.get('pagehide')({ persisted: false });
  expect(runtime.sound.dispose).toHaveBeenCalledOnce();
});
