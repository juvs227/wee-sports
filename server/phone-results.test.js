import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { EVENTS, PHASES } from '../shared/protocol.js';

const h = vi.hoisted(() => ({ refs: [], states: [], effects: [], ri: 0, si: 0, request: vi.fn() }));
vi.mock('react', async () => ({ ...(await vi.importActual('react')),
  useRef(value) { const i = h.ri++; return h.refs[i] ??= { current: value }; },
  useState(value) { const i = h.si++; if (!(i in h.states)) h.states[i] = value;
    return [h.states[i], next => { h.states[i] = typeof next === 'function' ? next(h.states[i]) : next; }]; },
  useEffect(effect, deps) { h.effects.push({ effect, deps }); },
}));
vi.mock('../client/src/lib/socket.js', () => ({ request: h.request }));
vi.mock('../client/src/components/ThemeToggle.jsx', () => ({ ThemeToggle: () => null }));
import { PhoneGameOptions } from '../client/src/components/PhoneGameOptions.jsx';

beforeEach(() => {
  h.refs = []; h.states = []; h.effects = []; h.request.mockReset(); h.request.mockResolvedValue({ ok: true });
  vi.stubGlobal('React', { createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }) });
});
afterEach(() => vi.unstubAllGlobals());

const settings = { assistance: 'standard', botDifficulty: 'standard', autoMove: true,
  timingAssist: true, splitView: true, format: 'quick' };
const tennis = () => ({ code: 'ABCD', gameId: 'game-1', sport: 'tennis', phase: PHASES.TUTORIAL, paused: false,
  players: [{ slot: 0, name: 'Sam' }], gameState: { phase: 'serve', winner: null, server: 1 },
  gameOptions: { gameId: 'game-1', sport: 'tennis', settings,
    practice: { active: false, stroke: 'alternate', hand: 'Right' }, humanOpponent: false } });
function mount(lobby = tennis(), slot = 0) {
  let props = { lobby, slot, disabled: false }, previous = [], tree;
  const dialog = { showModal: vi.fn(), close: vi.fn() };
  function render(changes = {}) {
    props = { ...props, ...changes }; h.ri = 0; h.si = 0; h.effects = [];
    tree = PhoneGameOptions(props); h.refs[0].current = dialog;
    h.effects.forEach(({ effect, deps }, i) => {
      if (!previous[i] || deps.some((dep, j) => !Object.is(dep, previous[i].deps[j]))) effect();
    });
    previous = h.effects; return tree;
  }
  const nodes = value => Array.isArray(value) ? value.flatMap(nodes) : value && typeof value === 'object'
    ? [value, ...nodes(value.children)] : [];
  const text = value => Array.isArray(value) ? value.map(text).join('') : value && typeof value === 'object'
    ? text(value.children) : typeof value === 'string' || typeof value === 'number' ? String(value) : '';
  render(); render();
  return { dialog, render, update(state, extra = {}) {
    render({ lobby: { ...props.lobby, gameState: state, ...extra } }); render();
  }, button(label) { return nodes(tree).find(node => node.type === 'button' && text(node) === label); }, text() { return text(tree); } };
}

test('completion prompts once, respects dismissal/reconnect, and prompts again after a rematch', () => {
  const f = mount();
  expect(f.dialog.showModal).not.toHaveBeenCalled();
  const complete = { phase: 'complete', server: 1, winner: 2 };
  f.update(complete);
  expect(f.dialog.showModal).toHaveBeenCalledTimes(1);
  expect(f.text()).toContain('Bot wins!');
  f.button('Not now').props.onClick();
  f.update({ ...complete }); f.render({ disabled: true }); f.render({ disabled: false });
  expect(f.dialog.showModal).toHaveBeenCalledTimes(1);
  f.update({ phase: 'serve', server: 1, winner: null });
  f.update({ ...complete, winner: 1 });
  expect(f.dialog.showModal).toHaveBeenCalledTimes(2);
  expect(f.text()).toContain('Sam wins!');
});

test('paused results wait for reconnect; only P1 can replay with the applied match format', async () => {
  const lobby = tennis();
  lobby.paused = true; lobby.gameState = { phase: 'complete', winner: 1, server: 1 };
  const f = mount(lobby);
  expect(f.dialog.showModal).not.toHaveBeenCalled();
  f.update(lobby.gameState, { paused: false });
  let finish;
  h.request.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const action = f.button('Play again').props.onClick;
  const first = action(); action();
  expect(h.request).toHaveBeenCalledTimes(1);
  expect(h.request).toHaveBeenCalledWith(EVENTS.PLAYER_GAME_COMMAND,
    expect.objectContaining({ gameId: 'game-1', action: 'new-match', format: 'quick' }));
  finish({ ok: true }); await first;
  f.update({ phase: 'prepare', server: 1, winner: null });
  expect(f.button('Play again')).toBeUndefined();
});

test('bowling ties and zero scores display correctly without granting P2 replay authority', () => {
  const lobby = { ...tennis(), sport: 'bowling', players: [{ slot: 0, name: 'Sam' }, { slot: 1, name: 'Ari' }],
    gameState: { phase: 'complete', currentPlayer: null, frame: 10, winners: [1, 2], winnerScore: 0 },
    gameOptions: { gameId: 'game-1', sport: 'bowling' } };
  const f = mount(lobby, 1);
  expect(f.text()).toContain('A shared victory!');
  expect(f.text()).toContain('Sam & Ari');
  expect(f.text()).toContain('0points');
  expect(f.button('Play again')).toBeUndefined();
  expect(f.button('Keep watching')).toBeDefined();
});

test('a failed replay keeps the result available and shows a useful error', async () => {
  const lobby = tennis(); lobby.gameState = { phase: 'complete', server: 1, winner: 2 };
  const f = mount(lobby);
  h.request.mockResolvedValue({ ok: false, error: 'game-loading' });
  await f.button('Play again').props.onClick(); f.render();
  expect(f.text()).toContain('Waiting for the TV game. Try again in a moment.');
  expect(f.button('Play again').props.disabled).toBe(false);
});
