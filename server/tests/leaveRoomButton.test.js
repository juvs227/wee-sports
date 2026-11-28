import {beforeEach, afterEach, expect, test, vi} from 'vitest';
const h = vi.hoisted(() => ({states: [], refs: [], effects: [], si: 0, ri: 0}));
vi.mock('react', async () => ({
  ...(await vi.importActual('react')),
  useId: () => 'leave-title',
  useState(value) {
    const i = h.si++;
    if (!(i in h.states)) h.states[i] = value;
    return [
      h.states[i],
      value => {
        h.states[i] = value;
      },
    ];
  },
  useRef(value) {
    return (h.refs[h.ri++] ??= {current: value});
  },
  useEffect(fn) {
    h.effects.push(fn);
  },
}));
import {LeaveRoomButton} from '@client/components/LeaveRoomButton.jsx';
function nodes(node) {
  if (Array.isArray(node)) {
    return node.flatMap(nodes);
  }
  if (node && typeof node === 'object') {
    return [node, ...nodes(node.children)];
  }
  return [];
}

function text(node) {
  if (Array.isArray(node)) {
    return node.map(text).join('');
  }
  if (node && typeof node === 'object') {
    return text(node.children);
  }
  return typeof node === 'string' ? node : '';
}

beforeEach(() => {
  h.states = [];
  h.refs = [];
  h.effects = [];
  vi.stubGlobal('React', {
    createElement: (type, props, ...children) => ({
      type,
      props: props ?? {},
      children,
    }),
  });
});
afterEach(() => vi.unstubAllGlobals());
function mount(onLeave) {
  const dialog = {showModal: vi.fn(), close: vi.fn()};
  let tree;
  function render() {
    h.si = 0;
    h.ri = 0;
    h.effects = [];
    tree = LeaveRoomButton({onLeave});
    nodes(tree).find(n => n.type === 'dialog').props.ref.current = dialog;
    for (const effect of h.effects) effect();
    return tree;
  }
  render();
  const button = label =>
    nodes(tree).find(n => n.type === 'button' && text(n) === label);
  return {render, button, dialog};
}
test('go home asks first; keep playing and Escape leave the room untouched', () => {
  const leave = vi.fn();
  const ui = mount(leave);
  ui.button('Go home').props.onClick();
  ui.render();
  expect(ui.dialog.showModal).toHaveBeenCalled();
  expect(leave).not.toHaveBeenCalled();
  ui.button('Keep playing').props.onClick();
  ui.render();
  expect(ui.dialog.close).toHaveBeenCalled();
  expect(leave).not.toHaveBeenCalled();
  ui.button('Go home').props.onClick();
  const tree = ui.render();
  const event = {preventDefault: vi.fn()};
  nodes(tree)
    .find(n => n.type === 'dialog')
    .props.onCancel(event);
  ui.render();
  expect(event.preventDefault).toHaveBeenCalled();
  expect(leave).not.toHaveBeenCalled();
});
test('only confirmation leaves and repeated taps cannot submit twice', async () => {
  let done;
  const leave = vi.fn(
    () =>
      new Promise(resolve => {
        done = resolve;
      }),
  );
  const ui = mount(leave);
  ui.button('Go home').props.onClick();
  const tree = ui.render();
  const confirm = nodes(tree)
    .filter(n => n.type === 'button' && text(n) === 'Go home')
    .at(-1);
  confirm.props.onClick();
  confirm.props.onClick();
  ui.render();
  expect(leave).toHaveBeenCalledOnce();
  expect(ui.button('Leaving…').props.disabled).toBe(true);
  done(true);
  await Promise.resolve();
  ui.render();
  expect(ui.dialog.close).toHaveBeenCalled();
});
test('a rejected exit stays open and displays retry feedback', async () => {
  const ui = mount(vi.fn(async () => false));
  ui.button('Go home').props.onClick();
  const tree = ui.render();
  nodes(tree)
    .filter(n => n.type === 'button' && text(n) === 'Go home')
    .at(-1)
    .props.onClick();
  await Promise.resolve();
  expect(text(ui.render())).toContain('Could not leave the room');
});
