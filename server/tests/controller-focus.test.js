import {afterEach, expect, test, vi} from 'vitest';
import {focusControllerSection} from '@wee/src/controller/focusSection.js';
afterEach(() => vi.unstubAllGlobals());

test('embedded focus reports document coordinates and leaves child scroll position unchanged', () => {
  vi.stubGlobal('location', {origin: 'https://wee.test'});
  const element = {scrollIntoView: vi.fn(), getBoundingClientRect: () => ({top: 40})};
  const parent = {postMessage: vi.fn()}, target = {parent, scrollY: 180};
  focusControllerSection(element, target);
  expect(element.scrollIntoView).not.toHaveBeenCalled();
  expect(target.scrollY).toBe(180);
  expect(parent.postMessage).toHaveBeenCalledExactlyOnceWith({type: 'wee:controller-focus', offset: 220}, location.origin);
});

test('standalone settings retain local scrolling', () => {
  const element = {scrollIntoView: vi.fn()}, target = {};
  target.parent = target;
  focusControllerSection(element, target);
  expect(element.scrollIntoView).toHaveBeenCalledExactlyOnceWith({block: 'start', behavior: 'instant'});
});
