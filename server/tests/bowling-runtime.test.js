import {afterEach, beforeEach, expect, test, vi} from 'vitest';
import {BowlingMatch} from '@wee/src/bowling/match';

vi.mock('@wee/src/theme.js', () => ({}));
const runtime = vi.hoisted(() => ({world: null, match: null}));
vi.mock('@wee/src/bowling/World', () => ({BowlingWorld: class {
  constructor() {
    runtime.world = this;
    this.rolling = false;
    this.start = vi.fn(); this.stop = vi.fn(); this.dispose = vi.fn(); this.setAim = vi.fn();
    this.roll = vi.fn(() => { this.rolling = true; this.onState(this.getState()); return {ok: true}; });
    this.reset = vi.fn(() => {
      runtime.match = new BowlingMatch([{player: 1, name: 'Yit'}]);
      this.rolling = false;
      this.onState(this.getState());
    });
  }
  getState() { return runtime.match.getState(this.rolling); }
}}));

let listeners;
let parent;
let elements;
function node() {
  return {hidden: true, children: [], dataset: {}, style: {setProperty: vi.fn()},
    classList: {toggle: vi.fn()}, setAttribute: vi.fn(),
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; }};
}
beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks(); vi.useFakeTimers();
  runtime.match = new BowlingMatch([{player: 1, name: 'Yit'}]);
  listeners = new Map(); elements = new Map(); parent = {postMessage: vi.fn()};
  vi.stubGlobal('window', {parent, addEventListener: (kind, callback) => listeners.set(kind, callback),
    removeEventListener: kind => listeners.delete(kind)});
  vi.stubGlobal('location', {origin: 'https://wee.test'});
  vi.stubGlobal('document', {body: node(), createElement: node, querySelector: () => node(),
    getElementById(id) { if (!elements.has(id)) elements.set(id, node()); return elements.get(id); }});
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });
const receive = (data, source = parent, origin = location.origin) => listeners.get('message')({data, source, origin});
const state = overrides => receive({type: 'wee:lobby-state', sport: 'bowling', paused: false,
  connected: true, playing: true, gameId: 'bowl-one', players: [{slot: 0, name: 'Yit'}], ...overrides});
const command = overrides => receive({type: 'wee:game-command', command: {id: 'cmd-1', gameId: 'bowl-one', action: 'new-match', ...overrides}});
const result = () => parent.postMessage.mock.calls.filter(([message]) => message.type === 'wee:game-command-result').at(-1)?.[0].result;

test('live aim accepts only fresh authenticated current-turn state and never changes a moving ball', async () => {
  await import('@wee/src/bowlingMain.ts');
  state({generation: 3, hostEpoch: 2});
  expect(runtime.world.setAim).toHaveBeenCalledExactlyOnceWith(0);
  expect(document.getElementById('aim-hud').hidden).toBe(false);
  runtime.world.setAim.mockClear();
  const snapshots = vi.spyOn(runtime.world, 'getState');
  const aim = (overrides = {}, source = parent) => receive({type: 'wee:game-aim', event: {
    gameId: 'bowl-one', player: 1, generation: 3, hostEpoch: 2, seq: 4, aim: .4, locked: true, ...overrides,
  }}, source);
  aim();
  expect(runtime.world.setAim).toHaveBeenCalledExactlyOnceWith(.4, true);
  expect(document.getElementById('aim-label').textContent).toBe('Aim · right');
  expect(document.getElementById('aim-state').textContent).toBe('Locked');
  expect(snapshots).not.toHaveBeenCalled();
  for (const overrides of [{seq: 3}, {gameId: 'old'}, {player: 2}, {generation: 2}, {hostEpoch: 1}, {seq: 5, aim: NaN}, {seq: 5, aim: 2}]) aim(overrides);
  aim({seq: 5}, {});
  expect(runtime.world.setAim).toHaveBeenCalledTimes(1);
  expect(document.getElementById('aim-label').textContent).toBe('Aim · right');
  runtime.world.rolling = true;
  runtime.world.onState(runtime.world.getState());
  aim({seq: 5});
  expect(runtime.world.setAim).toHaveBeenCalledTimes(1);
  runtime.world.rolling = false;
  runtime.world.onState(runtime.world.getState());
  state({generation: 4, hostEpoch: 2});
  aim({generation: 4, seq: 1, locked: false});
  expect(runtime.world.setAim).toHaveBeenLastCalledWith(.4, false);
  expect(document.getElementById('aim-state').textContent).toBe('Live');
  state({generation: 4, hostEpoch: 2, paused: true});
  expect(document.getElementById('aim-hud').hidden).toBe(true);
  aim({generation: 4, seq: 2});
  expect(runtime.world.setAim).toHaveBeenCalledTimes(3); // Centre on turn boundary, then the new aim.
});

test('eight-player standings remain complete and move the turn marker without opening the full scorecard', async () => {
  runtime.match = new BowlingMatch(Array.from({length: 8}, (_, index) => ({player: index + 1, name: `Player ${index + 1}`})));
  await import('@wee/src/bowlingMain.ts');
  state({players: Array.from({length: 8}, (_, slot) => ({slot, name: `Player ${slot + 1}`}))});
  const standings = () => document.getElementById('score-totals').children;
  expect(standings()).toHaveLength(8);
  expect(standings().map(row => row.dataset.active)).toEqual(['true', ...Array(7).fill('false')]);
  for (let i = 0; i < 7; i++) runtime.match.record([]);
  runtime.world.onState(runtime.world.getState());
  expect(standings().map(row => row.dataset.active)).toEqual([...Array(7).fill('false'), 'true']);
  expect(standings()[7].children[0].textContent).toBe('P8 · Player 8');
  expect(document.getElementById('score-body').children).toHaveLength(8);
  const dialog = document.getElementById('scorecard-dialog');
  dialog.showModal = vi.fn();
  document.getElementById('open-scorecard').onclick();
  expect(dialog.showModal).toHaveBeenCalledOnce();
});

test('a completed delivery reveals an unlocked centre guide for the next turn', async () => {
  await import('@wee/src/bowlingMain.ts'); state({});
  receive({type: 'wee:game-aim', event: {gameId: 'bowl-one', player: 1, seq: 1, aim: -.6, locked: true}});
  expect(document.getElementById('aim-state').textContent).toBe('Locked');
  receive({type: 'wee:game-roll', event: {id: 'delivery', gameId: 'bowl-one', player: 1, aim: -.6, spin: 0, power: .7}});
  expect(document.getElementById('aim-hud').hidden).toBe(true);
  runtime.match.record([1, 2]);
  runtime.world.rolling = false;
  runtime.world.onState(runtime.world.getState());
  expect(runtime.world.setAim).toHaveBeenLastCalledWith(0);
  expect(document.getElementById('aim-label').textContent).toBe('Aim · centre');
  expect(document.getElementById('aim-state').textContent).toBe('Live');
  expect(document.getElementById('aim-hud').hidden).toBe(false);
});

test('recovery bridge can request a fresh stable checkpoint without accepting a foreign request', async () => {
  await import('@wee/src/bowlingMain.ts'); state({});
  const payload = {version: 1, boundary: 'settled', match: {version: 1, players: [{player: 1, name: 'Yit'}], deliveries: []}, pins: [], settings: {aim: 0}};
  runtime.world.exportCheckpoint = vi.fn(() => payload);
  receive({type: 'wee:checkpoint-request', gameId: 'old'});
  receive({type: 'wee:checkpoint-request', gameId: 'bowl-one'}, {});
  expect(runtime.world.exportCheckpoint).not.toHaveBeenCalled();
  receive({type: 'wee:checkpoint-request', gameId: 'bowl-one'});
  receive({type: 'wee:checkpoint-request', gameId: 'bowl-one'});
  const checkpoints = parent.postMessage.mock.calls.filter(([message]) => message.type === 'wee:game-checkpoint');
  expect(checkpoints).toHaveLength(2);
  expect(checkpoints[0][0]).toMatchObject({gameId: 'bowl-one', sport: 'bowling', checkpointVersion: 1, rulesVersion: 1, payload});
  runtime.world.exportCheckpoint.mockReturnValue(null); // A delivery is in flight.
  receive({type: 'wee:checkpoint-request', gameId: 'bowl-one'});
  expect(parent.postMessage.mock.calls.filter(([message]) => message.type === 'wee:game-checkpoint')).toHaveLength(2);
});

test('phone restart is scoped to the current match and a duplicate cannot restart twice', async () => {
  await import('@wee/src/bowlingMain.ts'); state({});
  expect(document.getElementById('replay').hidden).toBe(true);
  command({});
  expect(runtime.world.reset).toHaveBeenCalledOnce();
  expect(result()).toEqual({ok: true});
  expect(parent.postMessage).toHaveBeenCalledWith({type: 'wee:game-options', sport: 'bowling', gameId: 'bowl-one'}, location.origin);
  command({});
  expect(result()).toMatchObject({ok: false, error: 'duplicate-command'});
  expect(runtime.world.reset).toHaveBeenCalledOnce();
});

test('invalid, stale, paused, rolling and foreign-origin commands cannot reset a match', async () => {
  await import('@wee/src/bowlingMain.ts'); state({});
  command({gameId: 'old-match'}); expect(result().ok).toBe(false);
  command({action: 'close-lobby'}); expect(result().ok).toBe(false);
  state({paused: true}); command({}); expect(result().ok).toBe(false);
  state({paused: false}); runtime.world.rolling = true;
  command({}); expect(result()).toMatchObject({ok: false, error: 'ball-in-play'});
  runtime.world.rolling = false;
  receive({type: 'wee:game-command', command: {id: 'cmd-2', gameId: 'bowl-one', action: 'new-match'}}, {}, location.origin);
  receive({type: 'wee:game-command', command: {id: 'cmd-2', gameId: 'bowl-one', action: 'new-match'}}, parent, 'https://other.test');
  expect(runtime.world.reset).not.toHaveBeenCalled();
});

test('bowling P requests server pause/resume for the current game without resetting or locally resuming', async () => {
  await import('@wee/src/bowlingMain.ts'); parent.postMessage.mockClear();
  const key = overrides => listeners.get('keydown')({ key: 'p', preventDefault: vi.fn(), ...overrides });
  key({}); expect(parent.postMessage).not.toHaveBeenCalled();
  state({}); runtime.world.start.mockClear(); runtime.world.stop.mockClear(); parent.postMessage.mockClear();
  const event = { key: 'p', preventDefault: vi.fn() };
  listeners.get('keydown')(event);
  expect(event.preventDefault).toHaveBeenCalledOnce();
  expect(parent.postMessage).toHaveBeenCalledExactlyOnceWith({ type: 'wee:pause-toggle', gameId: 'bowl-one' }, location.origin);
  expect(runtime.world.stop).not.toHaveBeenCalled();
  for (const ignored of [{ key: 'Escape' }, { repeat: true }, { metaKey: true }, { target: { tagName: 'SELECT' } }]) key(ignored);
  expect(parent.postMessage).toHaveBeenCalledTimes(1);
  state({ paused: true, manuallyPaused: true });
  expect(runtime.world.stop).toHaveBeenCalledOnce();
  expect(document.getElementById('roll-status').textContent).toContain('resume on your phone or TV');
  parent.postMessage.mockClear(); key({ key: 'P' });
  expect(parent.postMessage).toHaveBeenCalledExactlyOnceWith({ type: 'wee:pause-toggle', gameId: 'bowl-one' }, location.origin);
  expect(runtime.world.start).not.toHaveBeenCalled(); expect(runtime.world.reset).not.toHaveBeenCalled();
  listeners.get('pagehide')({ persisted: false });
  expect(listeners.has('keydown')).toBe(false);
});

test('hidden bowling cannot resume or release a ball until pageshow receives a fresh unpaused snapshot', async () => {
  await import('@wee/src/bowlingMain.ts'); state({});
  const roll = () => receive({ type: 'wee:game-roll', event: { id: 'held-roll', gameId: 'bowl-one', player: 1, power: .6, aim: 0, spin: 0 } });
  listeners.get('pagehide')({ persisted: true }); runtime.world.start.mockClear();
  state({}); roll(); command({});
  expect(runtime.world.start).not.toHaveBeenCalled(); expect(runtime.world.roll).not.toHaveBeenCalled();
  expect(runtime.world.reset).not.toHaveBeenCalled(); expect(result()).toEqual({ ok: false, error: 'paused' });
  parent.postMessage.mockClear();
  listeners.get('keydown')({ key: 'p', preventDefault: vi.fn() });
  expect(parent.postMessage).not.toHaveBeenCalled();
  listeners.get('pageshow')({ persisted: true });
  expect(parent.postMessage).toHaveBeenLastCalledWith({ type: 'wee:bridge-ready' }, location.origin);
  roll(); expect(runtime.world.roll).not.toHaveBeenCalled(); expect(runtime.world.start).not.toHaveBeenCalled();
  state({ paused: true, manuallyPaused: true }); roll();
  expect(runtime.world.roll).not.toHaveBeenCalled(); expect(runtime.world.start).not.toHaveBeenCalled();
  state({}); roll();
  expect(runtime.world.start).toHaveBeenCalledOnce(); expect(runtime.world.roll).toHaveBeenCalledOnce();
  expect(runtime.world.reset).not.toHaveBeenCalled();
});

test('bowling stops when a lobby snapshot no longer contains an active game', async () => {
  await import('@wee/src/bowlingMain.ts'); state({}); runtime.world.stop.mockClear();
  state({ gameId: null, playing: false });
  expect(runtime.world.stop).toHaveBeenCalledOnce();
  expect(document.getElementById('roll').disabled).toBe(true);
  parent.postMessage.mockClear();
  listeners.get('keydown')({ key: 'p', preventDefault: vi.fn() });
  expect(parent.postMessage).not.toHaveBeenCalled();
});

test('strike callout expires once and a repeated state does not show it again', async () => {
  await import('@wee/src/bowlingMain.ts'); state({});
  runtime.match.record([]); runtime.world.onState(runtime.world.getState());
  expect(document.getElementById('callout-title').textContent).toBe('Strike!');
  expect(document.getElementById('roll-callout').hidden).toBe(false);
  vi.advanceTimersByTime(2400);
  expect(document.getElementById('roll-callout').hidden).toBe(true);
  runtime.world.onState(runtime.world.getState());
  expect(document.getElementById('roll-callout').hidden).toBe(true);
});

test('pause and starting the next roll clear a spare or strike callout immediately', async () => {
  await import('@wee/src/bowlingMain.ts'); state({});
  runtime.match.record([1, 2]); runtime.world.onState(runtime.world.getState());
  runtime.match.record([]); runtime.world.onState(runtime.world.getState());
  expect(document.getElementById('callout-title').textContent).toBe('Spare!');
  state({paused: true});
  expect(document.getElementById('roll-callout').hidden).toBe(true);
  state({paused: false});
  expect(document.getElementById('roll-callout').hidden).toBe(true);
  runtime.match.record([]); runtime.world.onState(runtime.world.getState());
  expect(document.getElementById('roll-callout').hidden).toBe(false);
  runtime.world.rolling = true; runtime.world.onState(runtime.world.getState());
  expect(document.getElementById('roll-callout').hidden).toBe(true);
});

test('a final fill-ball strike appears before the ranking, then a phone restart clears both', async () => {
  await import('@wee/src/bowlingMain.ts'); state({});
  for (let roll = 0; roll < 12; roll++) {
    runtime.match.record([]);
    runtime.world.onState(runtime.world.getState());
  }
  expect(document.getElementById('callout-title').textContent).toBe('Strike!');
  expect(document.getElementById('results').hidden).toBe(true);
  const row = document.getElementById('score-body').children[0];
  expect(row.children[10].children[0].children.map(box => box.textContent)).toEqual(['X', 'X', 'X']);
  expect(row.children[10].children[1].textContent).toBe('300');
  expect(row.children[11].textContent).toBe('300');
  vi.advanceTimersByTime(2400);
  expect(document.getElementById('roll-callout').hidden).toBe(true);
  expect(document.getElementById('results').hidden).toBe(false);
  expect(document.getElementById('result-winner').textContent).toBe('Yit wins!');
  expect(document.getElementById('result-score').textContent).toBe('300 points');
  expect(document.getElementById('replay-prompt').textContent).toBe('Play again? Choose on your phone.');
  expect(parent.postMessage).toHaveBeenCalledWith({type: 'wee:bowling-state', gameId: 'bowl-one',
    phase: 'complete', currentPlayer: null, frame: 10, winners: [1], winnerScore: 300}, location.origin);

  command({});
  expect(result()).toEqual({ok: true});
  expect(document.getElementById('results').hidden).toBe(true);
  expect(document.getElementById('roll-callout').hidden).toBe(true);
  expect(document.getElementById('frame-label').textContent).toBe('Frame 1 / 10 · Ball 1');
  expect(document.getElementById('score-body').children[0].children[11].textContent).toBe('0');
  expect(document.getElementById('result-winner').textContent).toBe('');
  expect(document.getElementById('ranking').children).toHaveLength(0);
});

test('tied bowling totals name both winners without choosing the first seat', async () => {
  runtime.match = new BowlingMatch([{player: 1, name: 'Yit'}, {player: 2, name: 'Teammate'}]);
  await import('@wee/src/bowlingMain.ts');
  state({players: [{slot: 0, name: 'Yit'}, {slot: 1, name: 'Teammate'}]});
  while (!runtime.match.getState().complete) {
    runtime.match.record([]); runtime.world.onState(runtime.world.getState());
  }
  vi.advanceTimersByTime(2400);
  expect(document.getElementById('results').hidden).toBe(false);
  expect(document.getElementById('result-winner').textContent).toBe('Tied for first!');
  expect(document.getElementById('ranking').children.map(row => row.dataset.winner)).toEqual(['true', 'true']);
  expect(parent.postMessage).toHaveBeenCalledWith({type: 'wee:bowling-state', gameId: 'bowl-one',
    phase: 'complete', currentPlayer: null, frame: 10, winners: [1, 2], winnerScore: 300}, location.origin);
  const rows = document.getElementById('ranking').children;
  runtime.world.onState(runtime.world.getState());
  expect(document.getElementById('ranking').children).toBe(rows);
});
