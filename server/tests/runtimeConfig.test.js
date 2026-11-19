import {expect, test} from 'vitest';
import {runtimeConfig} from '@server/runtimeConfig.js';

test('production public URLs choose custom then Railway origins and ignore local development variables', () => {
  expect(runtimeConfig({PORT: '8080', PUBLIC_GAME_URL: 'https://sports.example.com/', RAILWAY_PUBLIC_DOMAIN: 'wee.up.railway.app'}, {production: true}))
    .toEqual({port: 8080, publicOrigin: 'https://sports.example.com', origins: ['https://sports.example.com']});
  expect(runtimeConfig({RAILWAY_PUBLIC_DOMAIN: 'wee.up.railway.app'}, {production: true}).publicOrigin).toBe('https://wee.up.railway.app');
  expect(runtimeConfig({VITE_PUBLIC_URL: 'https://old.trycloudflare.com', NGROK_HOST: 'old.ngrok.io'}, {production: true}).publicOrigin).toBeNull();
  expect(runtimeConfig({NGROK_HOST: 'local.ngrok.io'}).publicOrigin).toBe('https://local.ngrok.io');
});

test('invalid production QR destinations and malformed allowed origins fail before serving traffic', () => {
  for (const url of ['http://sports.example.com', 'https://user:secret@sports.example.com', 'https://sports.example.com/join',
    'https://localhost', 'https://127.0.0.1', 'https://10.0.0.1', 'https://192.168.1.1', 'https://172.16.0.1',
    'https://[::1]', 'https://tv.local', 'https://sports.example.com/?token=secret']) {
    expect(() => runtimeConfig({PUBLIC_GAME_URL: url}, {production: true})).toThrow('public phone URL');
  }
  expect(runtimeConfig({CLIENT_ORIGIN: 'https://controller.example.com, http://localhost:5173'}).origins).toHaveLength(2);
  for (const origin of ['*', 'https://sports.example.com/path', 'https://user:secret@sports.example.com']) {
    expect(() => runtimeConfig({CLIENT_ORIGIN: origin})).toThrow('CLIENT_ORIGIN');
  }
});

test('ports honor Railway values and ephemeral local tests, rejecting malformed values', () => {
  expect(runtimeConfig({}).port).toBe(5173);
  expect(runtimeConfig({PORT: '0'}).port).toBe(0);
  for (const port of ['', '-1', '65536', 'NaN', '3000.5']) expect(() => runtimeConfig({PORT: port})).toThrow('PORT');
});
