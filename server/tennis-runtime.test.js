import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const runtime = vi.hoisted(() => ({ world: null, close: vi.fn() }));
vi.mock('../src/World/World', () => ({ World: class {
  constructor() {
    this.start = vi.fn(); this.stop = vi.fn(); this.dispose = vi.fn(); this.swing = vi.fn();
    this.setPlayerInput = vi.fn();
    this.ball = { userData: { isWaitingForServe: true } };
    runtime.world = this;
  }
  getScore() { return { player1: 0, player2: 0, roundsPlayer1: 0, roundsPlayer2: 0 }; }
} }));
vi.mock('../src/Controllers/inputController', () => ({ InputController: class {} }));
vi.mock('../src/network/swingConnection.js', () => ({ connectSwings: () => ({ close: runtime.close }) }));

let listeners;
let parent;
beforeEach(() => {
  vi.resetModules(); vi.useFakeTimers();
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
