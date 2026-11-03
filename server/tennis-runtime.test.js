import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { ScoreSystem } from '../src/Tennis/scoreSystem';

// Theme behavior is covered independently; these fixtures model game/relay APIs.
vi.mock('../src/theme.js', () => ({}));

const runtime = vi.hoisted(() => ({ world: null, close: vi.fn(),
  sound: { mountButton: vi.fn(), play: vi.fn(), setActive: vi.fn(), dispose: vi.fn() } }));
vi.mock('../src/audio/sportsAudio', () => ({ createSportsAudio: () => runtime.sound }));
vi.mock('../src/Tennis/World', () => ({ World: class {
  constructor() {
    this.start = vi.fn(); this.stop = vi.fn(); this.dispose = vi.fn(); this.swing = vi.fn();
    this.setPlayerInput = vi.fn();
    this.setSplitScreen = vi.fn(); this.startRound = vi.fn();
    this.settings = { autoMove: true, timingAssist: true, assistance: 'standard', botDifficulty: 'standard', format: 'full' };
    this.configure = vi.fn(settings => Object.assign(this.settings, settings));
    this.startPractice = vi.fn(); this.stopPractice = vi.fn();
    this.ball = { userData: { isWaitingForServe: true } };
    this.score = { player1: 0, player2: 0, roundsPlayer1: 0, roundsPlayer2: 0,
      setsPlayer1: 0, setsPlayer2: 0, server: 'player1', tieBreak: false,
      completedSets: [], lastPoint: null, matchWinner: null, format: 'full' };
    runtime.world = this;
  }
  getScore() { return this.score; }
  getPracticeState() { return { active: false, stroke: 'alternate', hand: 'Right', attempts: 0, returns: 0, streak: 0, bestStreak: 0 }; }
  getServeState() { return { attempt: 1, side: 'deuce', status: 'ready' }; }
  getSettings() { return { ...this.settings }; }
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
    getElementById(id) { if (!elements.has(id)) elements.set(id, { checked: true }); return elements.get(id); },
  });
  vi.stubGlobal('location', { origin: 'https://wee.test', href: 'https://wee.test/game.html?room=lobby-SOLO', search: '?room=lobby-SOLO' });
  vi.stubGlobal('history', { replaceState: vi.fn() });
  vi.stubGlobal('__PUBLIC_ORIGIN__', '');
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

const state = overrides => listeners.get('message')({ source: parent, origin: location.origin,
  data: { type: 'wee:lobby-state', paused: false, connected: true,
    gameId: 'solo-match', players: [{ slot: 0, name: 'Solo player' }], ...overrides } });

const command = (payload, event = {}) => listeners.get('message')({ source: parent, origin: location.origin,
  data: { type: 'wee:game-command', command: { id: 'command-1', gameId: 'solo-match', ...payload } }, ...event });
const commandResults = () => parent.postMessage.mock.calls.filter(([message]) => message.type === 'wee:game-command-result').map(([message]) => message);

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
  expect(published().at(-1)[0]).toEqual({ type: 'wee:tennis-state', gameId: 'solo-match', phase: 'serve', server: 1, winner: null, practice: false, serveAttempt: 1 });
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
  const audio = () => parent.postMessage.mock.calls.filter(([message]) => message.type === 'wee:game-audio');
  expect(audio()).toHaveLength(1);
  expect(audio()[0][0]).toMatchObject({ gameId: 'solo-match', sport: 'tennis', event: 'serve' });
  vi.advanceTimersByTime(1000);
  expect(audio()).toHaveLength(1);
  document.getElementById('play-again').onclick();
  expect(audio().map(([message]) => message.event)).toEqual(['serve', 'stop', 'start']);
  state({ paused: true });
  runtime.world.onGameEvent({ kind: 'point', player: 1 });
  expect(audio()).toHaveLength(3);
  listeners.get('pagehide')({ persisted: false });
  expect(runtime.sound.play).not.toHaveBeenCalled(); // Homepage context owns every sound.
});

test('solo shows both views and actual stroke results carry the current match ID', async () => {
  await import('../src/main.ts'); state({});
  expect(runtime.world.setSplitScreen).toHaveBeenLastCalledWith(true);
  runtime.world.onStrokeResult({ id: 'stroke-1', player: 1, result: 'hit', reason: 'Good contact', receivedToContactMs: 75 });
  expect(parent.postMessage).toHaveBeenLastCalledWith({ type: 'wee:stroke-result', gameId: 'solo-match',
    id: 'stroke-1', player: 1, result: 'hit', reason: 'Good contact', receivedToContactMs: 75 }, location.origin);
  parent.postMessage.mockClear(); state({ paused: true });
  runtime.world.onStrokeResult({ id: 'stroke-2', player: 1, result: 'miss', reason: 'Late' });
  expect(parent.postMessage).not.toHaveBeenCalled();
});

test('phone match commands require the trusted parent, current match, and a running game', async () => {
  await import('../src/main.ts'); state({});
  const configure = { action: 'configure', settings: { assistance: 'beginner' } };
  command(configure, { source: {} });
  command(configure, { origin: 'https://unrelated.test' });
  expect(runtime.world.configure).not.toHaveBeenCalled();
  expect(commandResults()).toHaveLength(0);
  command({ ...configure, gameId: 'old-match' });
  expect(commandResults().at(-1).result).toEqual({ ok: false, error: 'stale-game' });
  command({ ...configure, settings: { gravity: 0 } });
  expect(commandResults().at(-1).result).toEqual({ ok: false, error: 'bad-game-command' });
  state({ paused: true }); command(configure);
  expect(commandResults().at(-1).result).toEqual({ ok: false, error: 'paused' });
  expect(runtime.world.configure).not.toHaveBeenCalled();
});

test('phone options apply existing game settings and split views, then publish actual settings', async () => {
  await import('../src/main.ts'); state({});
  command({ action: 'configure', settings: { assistance: 'beginner', timingAssist: false, splitView: false } });
  expect(runtime.world.configure).toHaveBeenLastCalledWith({ assistance: 'beginner', timingAssist: false });
  expect(runtime.world.setSplitScreen).toHaveBeenLastCalledWith(false);
  expect(commandResults().at(-1)).toEqual({ type: 'wee:game-command-result', id: 'command-1', gameId: 'solo-match', result: { ok: true } });
  const options = () => parent.postMessage.mock.calls.filter(([message]) => message.type === 'wee:game-options').map(([message]) => message);
  expect(options().at(-1)).toMatchObject({ gameId: 'solo-match', sport: 'tennis', humanOpponent: false,
    settings: { assistance: 'beginner', timingAssist: false, splitView: false, format: 'full' },
    practice: { active: false, stroke: 'alternate', hand: 'Right' } });
  const count = options().length;
  vi.advanceTimersByTime(1000); state({});
  expect(options()).toHaveLength(count);
  state({ connected: false }); state({ connected: true });
  expect(options()).toHaveLength(count + 1);
});

test('new-match retries acknowledge once without resetting a second time', async () => {
  await import('../src/main.ts'); state({});
  command({ action: 'new-match', format: 'full' });
  command({ action: 'new-match', format: 'full' });
  expect(runtime.world.startRound).toHaveBeenCalledOnce();
  expect(runtime.world.configure).toHaveBeenCalledOnce();
  expect(commandResults().map(message => message.result)).toEqual([{ ok: true }, { ok: true }]);
  command({ id: 'new-format', action: 'new-match', format: 'quick' });
  expect(runtime.world.configure).toHaveBeenLastCalledWith({ format: 'quick' });
  // The real configure method starts the round itself when the format changes.
  expect(runtime.world.startRound).toHaveBeenCalledOnce();
});

test('solo practice controls work while human-opponent commands cannot enable practice or hide their view', async () => {
  await import('../src/main.ts'); state({});
  command({ action: 'practice-start', stroke: 'backhand', hand: 'Left' });
  expect(runtime.world.startPractice).toHaveBeenLastCalledWith('backhand', 'Left');
  command({ id: 'stop-practice', action: 'practice-stop' });
  expect(runtime.world.stopPractice).toHaveBeenCalledOnce();
  state({ players: [{ slot: 0, name: 'One' }, { slot: 1, name: 'Two' }] });
  command({ id: 'human-practice', action: 'practice-start', stroke: 'alternate', hand: 'Right' });
  command({ id: 'human-view', action: 'configure', settings: { splitView: false } });
  command({ id: 'human-bot', action: 'configure', settings: { botDifficulty: 'beginner' } });
  expect(commandResults().slice(-3).every(message => message.result.error === 'solo-only')).toBe(true);
  expect(runtime.world.startPractice).toHaveBeenCalledOnce();
  expect(runtime.world.configure).not.toHaveBeenCalled();
  expect(runtime.world.setSplitScreen).toHaveBeenLastCalledWith(true);
});

test('a completed set announces its winner once, then continues the match until two sets are won', async () => {
  await import('../src/main.ts'); state({});
  const scoring = new ScoreSystem();
  for (let point = 0; point < 24; point++) scoring.awardPoint('player2', 'player1');
  runtime.world.score = scoring.getScore();
  vi.advanceTimersByTime(250);
  expect(document.getElementById('set-result').hidden).toBe(false);
  expect(document.getElementById('set-result-label').textContent).toBe('Set 1 complete');
  expect(document.getElementById('set-winner').textContent).toBe('Bot wins the set');
  expect(document.getElementById('set-result-score').textContent).toBe('6–0');
  expect(document.getElementById('set-next').textContent).toContain('Set 2');
  expect(document.getElementById('match-result').hidden).toBe(true);
  expect(runtime.world.startRound).not.toHaveBeenCalled();
  runtime.world.ball.userData.isWaitingForServe = false;
  vi.advanceTimersByTime(250);
  expect(document.getElementById('set-result').hidden).toBe(true);
  runtime.world.ball.userData.isWaitingForServe = true;
  vi.advanceTimersByTime(250);
  expect(document.getElementById('set-result').hidden).toBe(true);
  vi.advanceTimersByTime(3500);
  expect(document.getElementById('set-result').hidden).toBe(true);
  vi.advanceTimersByTime(1000);
  expect(document.getElementById('set-result').hidden).toBe(true);

  for (let point = 0; point < 24; point++) scoring.awardPoint('player2', 'player1');
  runtime.world.score = scoring.getScore();
  vi.advanceTimersByTime(250);
  expect(document.getElementById('set-result').hidden).toBe(true);
  expect(document.getElementById('match-result').hidden).toBe(false);
  expect(document.getElementById('match-winner').textContent).toBe('Bot wins!');
  expect(document.getElementById('match-result-score').textContent).toBe('2–0 in sets');
  expect(document.getElementById('match-result-detail').textContent).toBe('6–0 · 6–0');
  expect(document.getElementById('match-replay-prompt').textContent).toBe('Play again? Choose on your phone.');
  expect(document.getElementById('play-again').hidden).toBe(true);
  vi.advanceTimersByTime(8000);
  expect(document.getElementById('match-result').hidden).toBe(false);
  expect(runtime.world.startRound).not.toHaveBeenCalled();
  scoring.reset(); runtime.world.score = scoring.getScore();
  vi.advanceTimersByTime(250);
  expect(document.getElementById('match-result').hidden).toBe(true);
  expect(document.getElementById('set-result').hidden).toBe(true);
});

test('quick-match result waits for a two-point margin and offers standalone replay', async () => {
  window.parent = window;
  await import('../src/main.ts');
  const scoring = new ScoreSystem('quick');
  for (let point = 0; point < 6; point++) {
    scoring.awardPoint('player1', 'player2'); scoring.awardPoint('player2', 'player1');
  }
  scoring.awardPoint('player1', 'player2');
  runtime.world.score = scoring.getScore(); vi.advanceTimersByTime(250);
  expect(document.getElementById('match-result').hidden).toBe(true);
  scoring.awardPoint('player1', 'player2');
  runtime.world.score = scoring.getScore(); vi.advanceTimersByTime(250);
  expect(document.getElementById('match-result').hidden).toBe(false);
  expect(document.getElementById('match-result-label').textContent).toBe('Match complete');
  expect(document.getElementById('match-result-score').textContent).toBe('8–6 in the tie-break');
  expect(document.getElementById('play-again').hidden).toBe(false);
  runtime.world.startRound.mockImplementation(() => { scoring.reset(); runtime.world.score = scoring.getScore(); });
  document.getElementById('play-again').onclick();
  expect(document.getElementById('match-result').hidden).toBe(true);
  expect(runtime.world.startRound).toHaveBeenCalledOnce();
});

test('deuce and advantage stay in the score strip without announcing a set or match winner', async () => {
  await import('../src/main.ts'); state({});
  const scoring = new ScoreSystem();
  for (let point = 0; point < 3; point++) {
    scoring.awardPoint('player1', 'player2'); scoring.awardPoint('player2', 'player1');
  }
  runtime.world.score = scoring.getScore(); vi.advanceTimersByTime(250);
  expect(document.getElementById('score-format').textContent).toBe('Deuce');
  expect(document.getElementById('points-1').textContent).toBe('40');
  expect(document.getElementById('points-2').textContent).toBe('40');
  expect(document.getElementById('match-result').hidden).toBe(true);
  expect(document.getElementById('set-result').hidden).toBe(true);
  scoring.awardPoint('player1', 'player2');
  runtime.world.score = scoring.getScore(); vi.advanceTimersByTime(250);
  expect(document.getElementById('score-format').textContent).toBe('Advantage');
  expect(document.getElementById('points-1').textContent).toBe('Adv');
  scoring.awardPoint('player1', 'player2');
  runtime.world.score = scoring.getScore(); vi.advanceTimersByTime(250);
  expect(document.getElementById('games-progress').textContent).toBe('Games 1–0');
  expect(document.getElementById('match-result').hidden).toBe(true);
  expect(document.getElementById('set-result').hidden).toBe(true);
});
