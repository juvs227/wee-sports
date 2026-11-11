import { afterEach, beforeEach, expect, test, vi } from 'vitest';

let events;
let system;
let systemChanged;
let values;
let frames;
let storage;
beforeEach(() => {
  vi.resetModules();
  events = new Map(); values = new Map(); frames = [];
  storage = { getItem: vi.fn(key => values.get(key) ?? null),
    setItem: vi.fn((key, value) => values.set(key, value)) };
  system = { matches: false, addEventListener: vi.fn((_, listener) => { systemChanged = listener; }) };
  const page = { localStorage: storage, matchMedia: vi.fn(() => system),
    addEventListener: (name, listener) => events.set(name, listener) };
  page.parent = page;
  vi.stubGlobal('window', page);
  vi.stubGlobal('location', { origin: 'https://wee.test' });
  vi.stubGlobal('document', { documentElement: { dataset: {} }, querySelectorAll: () => frames });
});
afterEach(() => vi.unstubAllGlobals());
const theme = () => document.documentElement.dataset.theme;
const receive = (data, source = window.parent, origin = location.origin) => events.get('message')({ data, source, origin });

test('system appearance is followed until a player chooses and persists a theme', async () => {
  const api = await import('@wee/src/theme.js');
  expect(theme()).toBe('light');
  expect(window.matchMedia).toHaveBeenCalledWith('(prefers-color-scheme: dark)');
  system.matches = true; systemChanged();
  expect(theme()).toBe('dark');
  const changed = vi.fn();
  const unsubscribe = api.subscribeTheme(changed);
  api.setTheme('light');
  expect(theme()).toBe('light');
  expect(storage.setItem).toHaveBeenCalledWith('wee:theme', 'light');
  expect(changed).toHaveBeenCalledOnce();
  system.matches = false; systemChanged(); system.matches = true; systemChanged();
  expect(theme()).toBe('light');
  expect(changed).toHaveBeenCalledOnce();
  api.setTheme('unexpected');
  expect(changed).toHaveBeenCalledOnce();
  unsubscribe(); api.setTheme('dark');
  expect(changed).toHaveBeenCalledOnce();
});

test('saved choice survives a reload and overrides a different system preference', async () => {
  values.set('wee:theme', 'dark');
  const api = await import('@wee/src/theme.js');
  expect(api.getTheme()).toBe('dark');
  expect(theme()).toBe('dark');
  api.setTheme('light');
  vi.resetModules(); system.matches = true;
  await import('@wee/src/theme.js');
  expect(theme()).toBe('light');
});

test('storage updates sync other pages while unrelated changes do nothing', async () => {
  await import('@wee/src/theme.js');
  events.get('storage')({ key: 'another-setting', newValue: 'dark' });
  expect(theme()).toBe('light');
  events.get('storage')({ key: 'wee:theme', newValue: 'dark' });
  expect(theme()).toBe('dark');
  events.get('storage')({ key: 'wee:theme', newValue: null });
  expect(theme()).toBe('light');
  events.get('storage')({ key: 'wee:theme', newValue: 'dark' });
  events.get('storage')({ key: null, newValue: null });
  expect(theme()).toBe('light');
});

test('parent theme reaches existing and newly ready owned frames when storage is blocked', async () => {
  storage.getItem.mockImplementation(() => { throw Error('blocked'); });
  storage.setItem.mockImplementation(() => { throw Error('blocked'); });
  const current = { postMessage: vi.fn() };
  frames.push({ contentWindow: current });
  const api = await import('@wee/src/theme.js');
  expect(current.postMessage).toHaveBeenLastCalledWith({ type: 'wee:theme', theme: 'light' }, location.origin);
  api.setTheme('dark');
  expect(theme()).toBe('dark');
  expect(current.postMessage).toHaveBeenLastCalledWith({ type: 'wee:theme', theme: 'dark' }, location.origin);
  const added = { postMessage: vi.fn() };
  frames.push({ contentWindow: added });
  receive({ type: 'wee:theme-ready' }, added);
  expect(added.postMessage).toHaveBeenCalledExactlyOnceWith({ type: 'wee:theme', theme: 'dark' }, location.origin);
  const stranger = { postMessage: vi.fn() };
  receive({ type: 'wee:theme-ready' }, stranger);
  receive({ type: 'wee:theme-ready' }, added, 'https://unrelated.test');
  expect(stranger.postMessage).not.toHaveBeenCalled();
  expect(added.postMessage).toHaveBeenCalledOnce();
});

test('embedded frames accept only a valid theme from their same-origin parent', async () => {
  storage.getItem.mockImplementation(() => { throw Error('blocked'); });
  const parent = { postMessage: vi.fn() };
  window.parent = parent;
  await import('@wee/src/theme.js');
  expect(parent.postMessage).toHaveBeenCalledExactlyOnceWith({ type: 'wee:theme-ready' }, location.origin);
  receive({ type: 'wee:theme', theme: 'dark' }, parent, 'https://unrelated.test');
  receive({ type: 'wee:theme', theme: 'dark' }, {});
  receive({ type: 'wee:theme', theme: 'unknown' });
  receive({ type: 'unrelated', theme: 'dark' });
  expect(theme()).toBe('light');
  receive({ type: 'wee:theme', theme: 'dark' });
  expect(theme()).toBe('dark');
  expect(storage.setItem).not.toHaveBeenCalled();
  system.matches = false; systemChanged();
  expect(theme()).toBe('dark');
  receive({ type: 'wee:theme', theme: 'light' });
  expect(theme()).toBe('light');
});
