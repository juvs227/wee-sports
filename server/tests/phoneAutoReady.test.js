import {afterEach, beforeEach, expect, test, vi} from 'vitest';
import {EVENTS, PHASES} from '@wee/shared/protocol.js';

const h = vi.hoisted(() => ({effects: [], refs: [], states: [], ri: 0, si: 0, request: vi.fn(async () => ({ok: true}))}));
vi.mock('react', async () => ({...(await vi.importActual('react')),
  useRef(value) {return h.refs[h.ri++] ??= {current: value};},
  useState(value) {const i = h.si++; if (!(i in h.states)) h.states[i] = value;
    return [h.states[i], next => {h.states[i] = typeof next === 'function' ? next(h.states[i]) : next;}];},
  useEffect(effect, deps) {h.effects.push({effect, deps});},
}));
vi.mock('@client/lib/socket.js', () => ({request: h.request}));
vi.mock('@client/lib/useCountdown.js', () => ({useCountdown: () => 5}));
import {PhoneReady} from '@client/components/PhoneReady.jsx';

beforeEach(() => {
  h.effects = []; h.refs = []; h.states = []; h.request.mockReset(); h.request.mockResolvedValue({ok: true});
  vi.stubGlobal('React', {createElement: (type, props, ...children) => ({type, props: props ?? {}, children})});
});
afterEach(() => vi.unstubAllGlobals());
const text = node => Array.isArray(node) ? node.map(text).join('') : node && typeof node === 'object' ? text(node.children) : typeof node === 'string' ? node : '';
const nodes = node => Array.isArray(node) ? node.flatMap(nodes) : node && typeof node === 'object' ? [node, ...nodes(node.children)] : [];
const lobby = (extra = {}) => ({code: 'ABCD', phase: PHASES.READY, sport: 'bowling', gameId: null,
  leaderSlot: 0, canStart: true, players: [{slot: 0, name: 'Sam', setup: 'motion', ready: false}], ...extra});
function mount(initial = {}) {
  let props = {lobby: lobby(), slot: 0, ...initial}, previous = [], cleanups = [], tree;
  function render(changes = {}) {
    props = {...props, ...changes}; h.ri = 0; h.si = 0; h.effects = [];
    tree = PhoneReady(props);
    h.effects.forEach(({effect, deps}, index) => {
      if (!previous[index] || deps.some((dep, i) => !Object.is(dep, previous[index].deps[i]))) {
        cleanups[index]?.(); cleanups[index] = effect();
      }
    });
    previous = h.effects;
  }
  render();
  return {render, button(label) {return nodes(tree).find(node => node.type === 'button' && text(node) === label);}, text: () => text(tree)};
}

test.each(['motion', 'buttons'])('accepted %s setup gets ready without an extra tap or starting the match', setup => {
  mount({lobby: lobby({players: [{slot: 0, name: 'Sam', setup, ready: false}]})});
  expect(h.request).toHaveBeenCalledExactlyOnceWith(EVENTS.PLAYER_READY, {ready: true, skipTutorial: true});
});

test.each([{setup: null}, {ready: true}, {disabled: true}, {phase: PHASES.COUNTDOWN}, {phase: PHASES.GAME}])(
  'automatic readiness respects setup and lifecycle: %j', ({setup = 'motion', ready = false, phase = PHASES.READY, disabled = false}) => {
    mount({disabled, lobby: lobby({phase, players: [{slot: 0, setup, ready}]})});
    expect(h.request).not.toHaveBeenCalled();
  });

test('the current leader explicitly starts a ready roster and duplicate taps are coalesced', async () => {
  const f = mount({lobby: lobby({players: [{slot: 0, name: 'Sam', setup: 'buttons', ready: true}]})});
  expect(h.request).not.toHaveBeenCalled();
  let finish;
  h.request.mockImplementationOnce(() => new Promise(resolve => {finish = resolve;}));
  f.button('Start game').props.onClick(); f.render();
  expect(h.request).not.toHaveBeenCalled();
  const action = f.button('Start now').props.onClick;
  const first = action(); action();
  expect(h.request).toHaveBeenCalledExactlyOnceWith(EVENTS.PLAYER_START, {});
  finish({ok: true}); await first;
});

test('guests wait for the current leader; incomplete setup cannot start a game', async () => {
  const players = [{slot: 0, name: 'Sam', ready: true, setup: 'buttons'}, {slot: 1, name: 'Ari', ready: true, setup: 'buttons'}];
  const f = mount({slot: 1, lobby: lobby({players})});
  expect(f.button('Start game')).toBeUndefined();
  expect(f.text()).toContain('Sam starts the game.');
  f.render({slot: 0, lobby: lobby({players, canStart: false})});
  expect(f.button('Start game').props.disabled).toBe(true);
  await f.button('Start game').props.onClick();
  expect(h.request).not.toHaveBeenCalled();
});

test('returning from a match restores readiness and waits for a new explicit Start', async () => {
  const playing = lobby({phase: PHASES.GAME, gameId: 'finished', players: [{slot: 0, setup: 'motion', ready: true}]});
  const f = mount({lobby: playing});
  f.render({lobby: lobby()});
  expect(h.request).toHaveBeenCalledExactlyOnceWith(EVENTS.PLAYER_READY, {ready: true, skipTutorial: true});
  f.render({lobby: lobby({players: [{slot: 0, setup: 'motion', ready: true}]})});
  f.button('Start game').props.onClick(); f.render();
  await f.button('Start now').props.onClick();
  expect(h.request).toHaveBeenLastCalledWith(EVENTS.PLAYER_START, {});
});

test('a stale Start reply cannot put an error on the returned lobby', async () => {
  const ready = lobby({players: [{slot: 0, setup: 'buttons', ready: true}]});
  const f = mount({lobby: ready});
  let finish;
  h.request.mockImplementationOnce(() => new Promise(resolve => {finish = resolve;}));
  f.button('Start game').props.onClick(); f.render();
  const first = f.button('Start now').props.onClick();
  f.render({lobby: {...ready, phase: PHASES.COUNTDOWN, gameId: 'next'}});
  f.render({lobby: {...ready, canStart: false}});
  finish({ok: false, error: 'timeout'}); await first; f.render();
  expect(f.text()).not.toContain("Couldn't reach");
});

test('cancelling or changing the roster invalidates a start confirmation', async () => {
  const ready=lobby({players:[{slot:0,name:'Sam',setup:'buttons',ready:true}]});
  const f=mount({lobby:ready});
  f.button('Start game').props.onClick();f.render();
  f.button('Keep waiting').props.onClick();f.render();
  await f.button('Start now').props.onClick();
  expect(h.request).not.toHaveBeenCalled();
  f.button('Start game').props.onClick();f.render();
  f.render({lobby:{...ready,players:[...ready.players,{slot:1,name:'Ari',setup:'buttons',ready:true}]}});
  await f.button('Start now').props.onClick();
  expect(h.request).not.toHaveBeenCalled();
  f.render();f.button('Start game').props.onClick();f.render();
  await f.button('Start now').props.onClick();
  expect(h.request).toHaveBeenCalledExactlyOnceWith(EVENTS.PLAYER_START,{});
});
