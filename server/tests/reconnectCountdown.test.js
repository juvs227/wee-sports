import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {afterEach, beforeEach, expect, test, vi} from 'vitest';
import {ReconnectCountdown} from '@client/components/ReconnectCountdown.jsx';

beforeEach(() => {
  vi.stubGlobal('React', React);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function render(props = {}) {
  return renderToStaticMarkup(React.createElement(ReconnectCountdown, props));
}

test('server remaining time is displayed separately for each disconnected player', () => {
  const html = render({
    members: [
      {name: 'Alex', msLeft: 59001},
      {name: 'Sam', msLeft: 23000},
    ],
  });

  expect(html).toContain('Alex');
  expect(html).toContain('60s to reconnect');
  expect(html).toContain('Sam');
  expect(html).toContain('23s to reconnect');
  expect(html).not.toContain('About');
});

test('an offline controller has a clearly estimated countdown until server state returns', () => {
  expect(render({estimating: true})).toContain('About 60s to reconnect');
  const synchronized = render({
    estimating: true,
    members: [{name: 'Alex', msLeft: 12000}],
  });

  expect(synchronized).toContain('12s to reconnect');
  expect(synchronized).not.toContain('About');
});

test('zero or negative time waits for server expiry without claiming the game has resumed', () => {
  for (const msLeft of [0, -1000]) {
    const html = render({members: [{name: 'Alex', msLeft}]});
    expect(html).toContain('Reconnect window ended');
    expect(html).not.toContain('-1s');
  }
});

test('host sessions with no expiry are not given a false countdown', () => {
  const html = render({members: [{name: 'TV', msLeft: null}]});
  expect(html).toContain('Waiting for the TV to return');
  expect(html).not.toContain('60s');
});

test('a connected room with no missing members has no countdown', () => {
  expect(render()).toBe('');
  expect(render({members: []})).toBe('');
});
