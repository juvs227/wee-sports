import {afterEach, beforeEach, expect, test, vi} from 'vitest';
const h = vi.hoisted(() => ({states: [], refs: [], effects: [], si: 0, ri: 0, navigate: vi.fn(), camera: vi.fn(), stop: vi.fn()}));
vi.mock('react', async () => ({...(await vi.importActual('react')),
  useRef(value) {return h.refs[h.ri++] ??= {current: value};},
  useState(value) {const i = h.si++; if (!(i in h.states)) h.states[i] = value;
    return [h.states[i], next => {h.states[i] = typeof next === 'function' ? next(h.states[i]) : next;}];},
  useEffect(effect, deps) {h.effects.push({effect, deps});},
}));
vi.mock('react-router-dom', () => ({useNavigate: () => h.navigate}));
vi.mock('@client/lib/roomScan.js', async original => ({...await original(), startRoomCamera: h.camera}));
import {RoomScanner} from '@client/components/RoomScanner.jsx';
const text = node => Array.isArray(node) ? node.map(text).join('') : node && typeof node === 'object' ? text(node.children) : typeof node === 'string' ? node : '';
const nodes = node => Array.isArray(node) ? node.flatMap(nodes) : node && typeof node === 'object' ? [node, ...nodes(node.children)] : [];
beforeEach(() => {
  h.states = []; h.refs = []; h.effects = []; h.navigate.mockReset(); h.camera.mockReset(); h.stop.mockReset(); h.camera.mockReturnValue(h.stop);
  vi.stubGlobal('React', {createElement: (type, props, ...children) => ({type, props: props ?? {}, children})});
  vi.stubGlobal('location', {origin: 'https://wee.test', assign: vi.fn()});
  vi.stubGlobal('document', Object.assign(new EventTarget(), {hidden: false}));
});
afterEach(() => vi.unstubAllGlobals());
function mount(props = {}) {
  let previous = [], cleanups = [], tree;
  const dialog = {showModal: vi.fn(), close: vi.fn()}, video = {}, button = {focus: vi.fn()};
  function render() {
    h.si = 0; h.ri = 0; h.effects = []; tree = RoomScanner(props);
    h.refs[0].current = dialog; h.refs[1].current = video; h.refs[2].current = button;
    h.effects.forEach(({effect, deps}, index) => {
      if (!previous[index] || deps.some((dep, i) => !Object.is(dep, previous[index].deps[i]))) {
        cleanups[index]?.(); cleanups[index] = effect();
      }
    });
    previous = h.effects;
  }
  render();
  return {render, dialog, button(label) {return nodes(tree).find(node => node.type === 'button' && text(node) === label);},
    node(type) {return nodes(tree).find(node => node.type === type);}, text: () => text(tree),
    open() {nodes(tree).find(node => node.type === 'button').props.onClick(); render();},
    scan(value) {const handled = h.camera.mock.calls.at(-1)[1].onCode(value); render(); return handled;}};
}

test('camera opens only on a tap; canceling a scan keeps the current seat', () => {
  const leave = vi.fn(); const f = mount({activeRoom: {code: 'CDGH'}, onLeave: leave});
  expect(h.camera).not.toHaveBeenCalled();
  f.open(); expect(h.camera).toHaveBeenCalledOnce();
  f.button('Close').props.onClick(); f.render();
  expect(h.stop).toHaveBeenCalledOnce();
  expect(leave).not.toHaveBeenCalled(); expect(h.navigate).not.toHaveBeenCalled();
});

test('same-room scans keep the controller, while invalid codes never offer a room switch', () => {
  const leave = vi.fn(); const f = mount({activeRoom: {code: 'CDGH'}, onLeave: leave}); f.open();
  expect(f.scan('https://elsewhere.test/profile')).toBe(false);
  expect(f.button('Leave and join')).toBeUndefined();
  expect(f.scan('https://wee.test/join?code=CDGH')).toBe(true);
  expect(f.dialog.close).toHaveBeenCalled(); expect(leave).not.toHaveBeenCalled(); expect(h.navigate).not.toHaveBeenCalled();
});

test('switching TV requires an explicit successful leave and coalesces repeated confirmation taps', async () => {
  let finish; const leave = vi.fn(() => new Promise(resolve => {finish = resolve;}));
  const f = mount({activeRoom: {code: 'CDGH'}, onLeave: leave}); f.open(); f.scan('K7PM');
  expect(h.stop).toHaveBeenCalled(); expect(leave).not.toHaveBeenCalled(); expect(h.navigate).not.toHaveBeenCalled();
  const action = f.button('Leave and join').props.onClick;
  const pending = action(); action(); expect(leave).toHaveBeenCalledOnce();
  finish(true); await pending;
  expect(h.navigate).toHaveBeenCalledExactlyOnceWith('/join?code=K7PM');
});

test('failed room departure keeps the scanner confirmation and current connection available', async () => {
  const f = mount({activeRoom: {code: 'CDGH'}, onLeave: vi.fn(async () => false)}); f.open(); f.scan('K7PM');
  await f.button('Leave and join').props.onClick(); f.render();
  expect(h.navigate).not.toHaveBeenCalled(); expect(f.dialog.close).not.toHaveBeenCalled();
  expect(f.text()).toContain('Couldn’t leave this lobby yet.');
  expect(f.button('Keep playing').props.disabled).toBe(false);
});

test('permission failures expose manual code entry in the same dialog without dropping a seat', () => {
  const leave = vi.fn(); const f = mount({activeRoom: {code: 'CDGH'}, onLeave: leave}); f.open();
  h.camera.mock.calls.at(-1)[1].onError('Camera access is off. Enter the TV code here.'); f.render();
  expect(h.stop).toHaveBeenCalled(); expect(f.text()).toContain('Camera access is off.');
  f.node('input').props.onChange({target: {value: 'k7pm'}}); f.render();
  f.node('form').props.onSubmit({preventDefault() {}}); f.render();
  expect(f.button('Leave and join')).toBeDefined();
  expect(leave).not.toHaveBeenCalled(); expect(h.navigate).not.toHaveBeenCalled();
});
