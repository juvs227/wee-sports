import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { EVENTS, PHASES } from '@wee/shared/protocol.js';

const h = vi.hoisted(() => ({ refs: [], states: [], effects: [], ri: 0, si: 0, request: vi.fn() }));
vi.mock('react', async () => ({ ...(await vi.importActual('react')),
  useRef(value) { const i = h.ri++; return h.refs[i] ??= { current: value }; },
  useState(value) { const i = h.si++; if (!(i in h.states)) h.states[i] = value;
    return [h.states[i], next => { h.states[i] = typeof next === 'function' ? next(h.states[i]) : next; }]; },
  useEffect(effect, deps) { h.effects.push({ effect, deps }); },
}));
vi.mock('@client/lib/socket.js', () => ({ request: h.request }));
vi.mock('@client/components/ThemeToggle.jsx', () => ({ ThemeToggle: () => null }));
import { PhoneGameOptions } from '@client/components/PhoneGameOptions.jsx';

beforeEach(() => {
  h.refs = []; h.states = []; h.effects = []; h.request.mockReset(); h.request.mockResolvedValue({ ok: true });
  vi.stubGlobal('React', { createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }) });
});
afterEach(() => vi.unstubAllGlobals());

const settings = { assistance: 'standard', botDifficulty: 'standard', autoMove: true,
  timingAssist: true, splitView: true, format: 'quick' };
const tennis = () => ({ code: 'ABCD', gameId: 'game-1', sport: 'tennis', phase: PHASES.GAME, paused: false,
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

test('P1 confirms a return without requiring game options or every participant to reconnect', async () => {
  const lobby = tennis(); lobby.paused = true; lobby.gameOptions = null;
  const f = mount(lobby);
  expect(f.button('Return to lobby').props.disabled).toBe(false);
  await f.button('Return to lobby').props.onClick(); f.render();
  expect(h.request).not.toHaveBeenCalled();
  expect(f.text()).toContain('controller setup stay in the lobby');
  f.button('Keep playing').props.onClick(); f.render();
  expect(f.button('End match and return')).toBeUndefined();
  await f.button('Return to lobby').props.onClick(); f.render();
  await f.button('End match and return').props.onClick(); f.render();
  expect(h.request).toHaveBeenCalledExactlyOnceWith(EVENTS.PLAYER_RETURN_TO_LOBBY, { gameId: 'game-1' });
  expect(f.dialog.close).toHaveBeenCalled();
});

test('return is available in the winner prompt and countdown, but never to another seat or offline phone', () => {
  const lobby = tennis(); lobby.gameState = { phase: 'complete', server: 1, winner: 1 };
  const f = mount(lobby);
  expect(f.button('Return to lobby')).toBeDefined();
  f.render({ disabled: true });
  expect(f.button('Return to lobby').props.disabled).toBe(true);
  f.render({ disabled: false, slot: 1 });
  expect(f.button('Return to lobby')).toBeUndefined();
  f.render({ slot: 0, lobby: { ...tennis(), phase: PHASES.COUNTDOWN } }); f.render();
  expect(f.button('Return to lobby').props.disabled).toBe(false);
});

test('return requests are coalesced, and a stale reply cannot alter the next match dialog', async () => {
  const f = mount();
  await f.button('Return to lobby').props.onClick(); f.render();
  let finish;
  h.request.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const action = f.button('End match and return').props.onClick;
  const first = action(); action();
  expect(h.request).toHaveBeenCalledTimes(1);
  f.render({ lobby: { ...tennis(), gameId: 'game-2' } }); f.render();
  f.dialog.close.mockClear();
  finish({ ok: false, error: 'timeout' }); await first; f.render();
  expect(f.dialog.close).not.toHaveBeenCalled();
  expect(f.text()).not.toContain("Couldn't reach the game server.");
  expect(f.button('End match and return')).toBeUndefined();
});

test('a failed return retains its confirmation and tells the player why', async () => {
  const f = mount();
  await f.button('Return to lobby').props.onClick(); f.render();
  h.request.mockResolvedValue({ ok: false, error: 'disconnected' });
  await f.button('End match and return').props.onClick(); f.render();
  expect(f.text()).toContain('Reconnecting… Keep this page open.');
  expect(f.button('End match and return').props.disabled).toBe(false);
});

test('P1 pause is explicit, coalesced and remains resumable while shared play is paused', async () => {
  const f = mount();
  let finish;
  h.request.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const click = f.button('Pause game').props.onClick;
  const first = click(); click();
  expect(h.request).toHaveBeenCalledExactlyOnceWith(EVENTS.PLAYER_PAUSE, { gameId: 'game-1', paused: true });
  finish({ ok: true, manuallyPaused: true, paused: true }); await first;
  f.render({ lobby: { ...tennis(), manuallyPaused: true, paused: true } });
  expect(f.button('Resume game').props.disabled).toBe(false);
  expect(f.text()).toContain('Game paused. Player 1 or the TV can resume.');
  h.request.mockResolvedValue({ ok: true, manuallyPaused: false, paused: true });
  await f.button('Resume game').props.onClick();
  f.render({ lobby: { ...tennis(), manuallyPaused: false, paused: true } });
  expect(h.request).toHaveBeenLastCalledWith(EVENTS.PLAYER_PAUSE, { gameId: 'game-1', paused: false });
  expect(f.text()).toContain('Still waiting for everyone to reconnect and finish setup.');
});

test('TV pause changes clear stale phone acknowledgements without closing the dialog or hiding errors', async () => {
  const f = mount();
  const paused = { ...tennis(), manuallyPaused: true, paused: true };
  h.request.mockResolvedValue({ ok: true, manuallyPaused: true, paused: true });
  await f.button('Pause game').props.onClick(); f.render({ lobby: paused });
  expect(f.text()).toContain('Game paused.');
  f.dialog.close.mockClear();
  f.render({ lobby: { ...tennis(), manuallyPaused: false } });
  expect(f.button('Pause game').props.disabled).toBe(false);
  expect(f.text()).not.toContain('Game paused.');
  expect(f.dialog.close).not.toHaveBeenCalled();

  h.request.mockResolvedValue({ ok: false, error: 'delivery-pending' });
  await f.button('Pause game').props.onClick(); f.render();
  f.render({ lobby: paused });
  expect(f.text()).toContain('Your roll is reaching the TV.');
  expect(f.dialog.close).not.toHaveBeenCalled();
});

test('a late pause acknowledgement cannot contradict a newer TV resume', async () => {
  const f = mount();
  let finish;
  h.request.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const first = f.button('Pause game').props.onClick();
  f.render({ lobby: { ...tennis(), manuallyPaused: true, paused: true } });
  f.render({ lobby: { ...tennis(), manuallyPaused: false } });
  finish({ ok: true, manuallyPaused: true, paused: true }); await first; f.render();
  expect(f.text()).not.toContain('Game paused.');
  expect(f.button('Pause game').props.disabled).toBe(false);
});

test('pause is unavailable to P2, offline controllers, countdowns and already completed games', () => {
  const f = mount(tennis(), 1);
  expect(f.button('Pause game')).toBeUndefined();
  f.render({ slot: 0, disabled: true });
  expect(f.button('Pause game').props.disabled).toBe(true);
  f.render({ disabled: false, lobby: { ...tennis(), phase: PHASES.COUNTDOWN } });
  expect(f.button('Pause game')).toBeUndefined();
  f.update({ phase: 'complete', winner: 2, server: 1 }, { phase: PHASES.GAME });
  expect(f.button('Pause game')).toBeUndefined();
});

test('completion racing a pause cannot trap replay behind a missing resume control', async () => {
  const f = mount({ ...tennis(), paused: true, manuallyPaused: true,
    gameState: { phase: 'complete', winner: 1, server: 1 } });
  expect(f.button('Resume game').props.disabled).toBe(false);
  h.request.mockResolvedValue({ ok: true, manuallyPaused: false, paused: false });
  await f.button('Resume game').props.onClick();
  f.update({ phase: 'complete', winner: 1, server: 1 }, { paused: false, manuallyPaused: false });
  expect(f.button('Play again').props.disabled).toBe(false);
});

test('a failed pause reports why and a stale pause reply does not update the next game', async () => {
  const f = mount();
  h.request.mockResolvedValue({ ok: false, error: 'delivery-pending' });
  await f.button('Pause game').props.onClick(); f.render();
  expect(f.text()).toContain('Your roll is reaching the TV.');
  let finish;
  h.request.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const first = f.button('Pause game').props.onClick();
  f.render({ lobby: { ...tennis(), gameId: 'new-game' } }); f.render();
  finish({ ok: false, error: 'timeout' }); await first; f.render();
  expect(f.text()).not.toContain("Couldn't reach");
});
