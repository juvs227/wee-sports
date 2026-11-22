import {expect, test} from 'vitest';
import {isAllowedOrigin} from '@server/origins.js';

test('browser handshakes require a same-host or explicitly allowed origin', () => {
  const request = origin => ({headers: {host: 'sports.example.com', origin}});
  expect(isAllowedOrigin(request('https://sports.example.com'))).toBe(true);
  expect(isAllowedOrigin(request('https://controller.example.com'), ['https://controller.example.com'])).toBe(true);
  for (const origin of ['https://evil.example', 'null', 'file://', 'https://sports.example.com/path',
    'https://user@sports.example.com', 'https://sports.example.com:444', ['https://sports.example.com']]) {
    expect(isAllowedOrigin(request(origin))).toBe(false);
  }
  expect(isAllowedOrigin({headers: {host: 'internal:5173', origin: 'https://evil.example', 'x-forwarded-host': 'evil.example'}})).toBe(false);
});

test('native handshakes without Origin and local browser development remain supported', () => {
  expect(isAllowedOrigin({headers: {host: 'sports.example.com'}})).toBe(true);
  expect(isAllowedOrigin({headers: {host: 'localhost:5173', origin: 'http://localhost:5173'}})).toBe(true);
  expect(isAllowedOrigin({headers: {host: 'internal:5173', origin: 'https://sports.example.com'}}, ['https://sports.example.com'])).toBe(true);
});
