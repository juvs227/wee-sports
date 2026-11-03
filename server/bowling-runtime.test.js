import {afterEach, beforeEach, expect, test, vi} from 'vitest';
import {BowlingMatch} from '../src/bowling/match';

vi.mock('../src/theme.js', () => ({}));
const runtime = vi.hoisted(() => ({world: null, match: null}));
vi.mock('../src/bowling/World', () => ({BowlingWorld: class {
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

test('phone restart is scoped to the current match and a duplicate cannot restart twice', async () => {
  await import('../src/bowlingMain.ts'); state({});
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
  await import('../src/bowlingMain.ts'); state({});
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

test('strike callout expires once and a repeated state does not show it again', async () => {
  await import('../src/bowlingMain.ts'); state({});
  runtime.match.record([]); runtime.world.onState(runtime.world.getState());
  expect(document.getElementById('callout-title').textContent).toBe('Strike!');
  expect(document.getElementById('roll-callout').hidden).toBe(false);
  vi.advanceTimersByTime(2400);
  expect(document.getElementById('roll-callout').hidden).toBe(true);
  runtime.world.onState(runtime.world.getState());
  expect(document.getElementById('roll-callout').hidden).toBe(true);
});

test('pause and starting the next roll clear a spare or strike callout immediately', async () => {
  await import('../src/bowlingMain.ts'); state({});
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
  await import('../src/bowlingMain.ts'); state({});
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
  await import('../src/bowlingMain.ts');
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
