import { expect, test } from 'vitest';
import { shouldTogglePause } from '../src/network/pauseShortcut.js';

test('P pauses once without taking Escape, modified shortcuts, or text input', () => {
  expect(shouldTogglePause({ key: 'p' })).toBe(true);
  expect(shouldTogglePause({ key: 'P' })).toBe(true);
  for (const key of ['Escape', 'Enter', ' ']) expect(shouldTogglePause({ key })).toBe(false);
  for (const flag of ['repeat', 'defaultPrevented', 'isComposing', 'altKey', 'ctrlKey', 'metaKey', 'shiftKey']) {
    expect(shouldTogglePause({ key: 'p', [flag]: true })).toBe(false);
  }
  for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT']) expect(shouldTogglePause({ key: 'p', target: { tagName } })).toBe(false);
  expect(shouldTogglePause({ key: 'p', target: { isContentEditable: true } })).toBe(false);
  expect(shouldTogglePause({ key: 'p', target: { closest: () => ({}) } })).toBe(false);
  expect(shouldTogglePause({ key: 'p', target: { tagName: 'CANVAS' } })).toBe(true);
});
