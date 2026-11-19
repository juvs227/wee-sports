import {afterEach, beforeEach, expect, test, vi} from 'vitest';

const h = vi.hoisted(() => ({states: [], refs: [], effects: [], elements: [], stateIndex: 0, refIndex: 0,
  setState: vi.fn(), profileRequest: vi.fn(), claims: vi.fn(), request: vi.fn(), saveToken: vi.fn(),
  navigate: vi.fn(), disconnect: vi.fn(), connect: vi.fn(), routeState: null}));
vi.mock('react', async () => ({...(await vi.importActual('react')),
  useRef(value) {return h.refs[h.refIndex++] ??= {current: value};},
  useState(value) {
    const index = h.stateIndex++;
    if (!(index in h.states)) h.states[index] = typeof value === 'function' ? value() : value;
    return [h.states[index], next => {h.setState(); h.states[index] = typeof next === 'function' ? next(h.states[index]) : next;}];
  },
  useEffect(effect) {h.effects.push(effect);},
}));
vi.mock('react-router-dom', () => ({Link: 'Link', useNavigate: () => h.navigate, useLocation: () => ({state: h.routeState})}));
vi.mock('@client/lib/profile.js', () => ({profileRequest: h.profileRequest, claimGuestHistory: h.claims}));
vi.mock('@client/lib/reconnect.js', () => ({saveToken: h.saveToken}));
vi.mock('@client/lib/socket.js', () => ({request: h.request, useConnection: () => 'online',
  socket: {disconnect: h.disconnect, connect: h.connect}}));
import Profile from '@client/pages/Profile.jsx';

let cleanup;
const flush = async () => {for (let index = 0; index < 8; index++) await Promise.resolve();};
const render = () => {h.stateIndex = 0; h.refIndex = 0; h.elements = []; Profile();};
const profile = {username: 'player', displayName: 'Player', avatar: 'ball', preferences: {hand: 'Right', sensitivity: 1}};
beforeEach(() => {
  vi.clearAllMocks(); cleanup = null;
  h.states = []; h.refs = []; h.effects = []; h.routeState = null;
  vi.stubGlobal('navigator', {});
  vi.stubGlobal('React', {createElement: (tag, props, ...children) => {h.elements.push({tag, props, children}); return null;}});
  h.claims.mockResolvedValue();
});
afterEach(() => {cleanup?.(); vi.unstubAllGlobals();});

test('leaving a profile load aborts it and ignores an already arriving response', async () => {
  let finish;
  h.profileRequest.mockImplementation(() => new Promise(resolve => {finish = resolve;}));
  render(); cleanup = h.effects[0]();
  const signal = h.profileRequest.mock.calls[0][1].signal;
  cleanup(); finish({profile}); await flush();
  expect(signal.aborted).toBe(true);
  expect(h.setState).not.toHaveBeenCalled();
  expect(h.claims).not.toHaveBeenCalled();
});

test('a late sign-in response cannot reconnect the shared room socket after navigation', async () => {
  h.profileRequest.mockRejectedValueOnce(Object.assign(new Error('not-signed-in'), {status: 401}));
  render(); cleanup = h.effects[0](); await flush(); render();
  let finish;
  h.profileRequest.mockImplementationOnce(() => new Promise(resolve => {finish = resolve;}));
  const submit = h.elements.find(element => element.tag === 'form').props.onSubmit;
  const pending = submit({preventDefault() {}});
  h.setState.mockClear(); cleanup(); finish({profile}); await pending;
  expect(h.disconnect).not.toHaveBeenCalled();
  expect(h.connect).not.toHaveBeenCalled();
  expect(h.setState).not.toHaveBeenCalled();
});

test('leaving during claim sync prevents starting another history request', async () => {
  h.profileRequest.mockResolvedValue({profile});
  let finish;
  h.claims.mockImplementation(() => new Promise(resolve => {finish = resolve;}));
  render(); cleanup = h.effects[0](); await flush();
  h.setState.mockClear(); cleanup(); finish(); await flush();
  expect(h.profileRequest).toHaveBeenCalledTimes(1);
  expect(h.setState).not.toHaveBeenCalled();
});

test('a late saved-game restore retains its room proof without navigating away from a new page', async () => {
  h.profileRequest.mockImplementation(async path => path === '/history' ? {history: []} : path === '/recovery'
    ? {matches: [{matchId: 'saved-game', sport: 'bowling', playerName: 'Player', savedAt: 0}]} : {profile});
  render(); cleanup = h.effects[0](); await flush(); render();
  let finish;
  h.request.mockImplementation(() => new Promise(resolve => {finish = resolve;}));
  const restore = h.elements.find(element => element.tag === 'button' && element.children.includes('Continue on this screen')).props.onClick;
  const pending = restore();
  h.setState.mockClear(); cleanup(); finish({ok: true, code: 'K7PM', token: 'private-proof'}); await pending;
  expect(h.saveToken).toHaveBeenCalledWith('host', 'K7PM', 'private-proof');
  expect(h.navigate).not.toHaveBeenCalled();
  expect(h.setState).not.toHaveBeenCalled();
});

test.each(['/host/K7PM', '/join?code=K7PM'])('sign-in provides a return to the original room: %s', returnTo => {
  h.routeState = {returnTo}; render();
  expect(h.elements.find(element => element.tag === 'Link').props.to).toBe(returnTo);
});

test('untrusted profile return state cannot create an external navigation link', () => {
  h.routeState = {returnTo: 'https://outside.example'}; render();
  expect(h.elements.find(element => element.tag === 'Link').props.to).toBe('/home');
});
