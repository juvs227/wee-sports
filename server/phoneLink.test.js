import { test, expect } from 'vitest';
import { securePhoneOrigin, phoneLinkHandler } from './phoneLink.js';

test('phone origins require HTTPS and cannot carry credentials, paths or query data', () => {
  expect(securePhoneOrigin('https://demo.trycloudflare.com/')).toBe('https://demo.trycloudflare.com');
  for (const invalid of [undefined, 'http://192.168.1.5:5173', 'https://user:pass@example.com', 'https://example.com/path', 'https://example.com/?token=x']) expect(securePhoneOrigin(invalid)).toBeNull();
});
function request(url, origin, forwarded = false) {
  const result = { status: 0, headers: {}, body: '', passed: false };
  phoneLinkHandler(origin, () => { result.passed = true; })({ url, headers: forwarded ? { 'x-forwarded-proto': 'https' } : {}, socket: { remoteAddress: forwarded ? '127.0.0.1' : '192.168.1.20' } }, {
    setHeader: (key, value) => { result.headers[key] = value; },
    writeHead: (status, headers) => { result.status = status; Object.assign(result.headers, headers); },
    end: body => { result.body = body; },
  });
  return result;
}
test('the local TV discovers the secure QR origin at runtime and old phone URLs redirect intact', () => {
  const origin = 'https://demo.trycloudflare.com';
  expect(JSON.parse(request('/api/phone-link', origin).body)).toEqual({ origin });
  const redirect = request('/join?code=ABCD', origin);
  expect(redirect.status).toBe(307);
  expect(redirect.headers.location).toBe(`${origin}/join?code=ABCD`);
  expect(request('/join?code=ABCD', origin, true).passed).toBe(true);
  expect(request('/host/ABCD', origin).passed).toBe(true);
  expect(request('/join?code=ABCD', null).passed).toBe(true);
  expect(JSON.parse(request('/api/phone-link', null).body).origin).toBeNull();
});

test('controller redirects preserve room parameters and allow motion only within the same origin', () => {
  const origin = 'https://demo.trycloudflare.com';
  const path = '/controller.html?room=lobby-ABCD&player=2&sport=bowling';
  const redirected = request(path, origin);
  expect(redirected.status).toBe(307);
  expect(redirected.headers.location).toBe(`${origin}${path}`);
  const tunneled = request(path, origin, true);
  expect(tunneled.passed).toBe(true);
  expect(tunneled.headers['Permissions-Policy']).toBe('accelerometer=(self), gyroscope=(self), fullscreen=(self)');
  expect(request('/socket.io/?EIO=4&transport=polling', origin).passed).toBe(true);
  expect(request('/assets/controller.js', origin).passed).toBe(true);
});

test('a remote HTTP caller cannot skip the secure redirect with a forwarded header', () => {
  let location;
  phoneLinkHandler('https://demo.trycloudflare.com', () => { throw new Error('Should redirect'); })({
    url: '/join?code=ABCD', headers: { 'x-forwarded-proto': 'https' }, socket: { remoteAddress: '192.168.1.20' },
  }, {
    setHeader() {},
    writeHead: (_status, headers) => { location = headers.location; },
    end() {},
  });
  expect(location).toBe('https://demo.trycloudflare.com/join?code=ABCD');
});

test('Cloudflare loopback addresses do not redirect back to the same secure page', () => {
  for (const remoteAddress of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) {
    let passed = false;
    phoneLinkHandler('https://demo.trycloudflare.com', () => { passed = true; })({
      url: '/join?code=ABCD', headers: { 'x-forwarded-proto': 'https' }, socket: { remoteAddress },
    }, { setHeader() {}, writeHead() { throw new Error('Redirect loop'); }, end() {} });
    expect(passed).toBe(true);
  }
});
