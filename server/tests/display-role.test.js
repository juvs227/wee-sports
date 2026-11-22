import {expect, test} from 'vitest';
import {displayRole} from '@client/lib/displayRole.js';
import {scannedRoom} from '@client/lib/roomScan.js';

test('phones and tablets enter the remote regardless of their orientation or screen width', () => {
  for (const device of [
    {userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)'},
    {userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Mobile Safari/537.36'},
    {userAgent: 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)'},
    {userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)', platform: 'MacIntel', maxTouchPoints: 5},
    {userAgent: 'Mozilla/5.0 (Linux; Android 14; Tablet)'},
    {userAgent: 'Future mobile browser', userAgentData: {mobile: true}},
    {userAgent: 'Mozilla/5.0 (Windows Phone 10.0; Android 6.0.1)'},
  ]) expect(displayRole(device)).toBe('remote');
});

test('computers and TVs remain hosts, including touch Windows and Android-based televisions', () => {
  for (const device of [
    {userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', maxTouchPoints: 10},
    {userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)', platform: 'MacIntel', maxTouchPoints: 0},
    {userAgent: 'Mozilla/5.0 (X11; Linux x86_64)'},
    {userAgent: 'Mozilla/5.0 (X11; CrOS x86_64)'},
    {userAgent: 'Mozilla/5.0 (SMART-TV; Linux; Tizen 8.0)'},
    {userAgent: 'Mozilla/5.0 (Web0S; Linux/SmartTV)'},
    {userAgent: 'Mozilla/5.0 (Linux; Android 9; BRAVIA 4K GB)'},
    {userAgent: 'Mozilla/5.0 (Linux; Android 9; AFTMM Build/PS)'},
    {userAgent: 'Mozilla/5.0 (Linux; Android 11; Android TV)', userAgentData: {mobile: true}},
    {},
  ]) expect(displayRole(device)).toBe('tv');
});

test('scanning accepts TV links and codes, preserves tunnel origins and drops unrelated parameters', () => {
  const origin = 'https://wee.example';
  expect(scannedRoom('k7pm', origin)).toBe(origin + '/join?code=K7PM');
  expect(scannedRoom('  K7PM  ', origin)).toBe(origin + '/join?code=K7PM');
  expect(scannedRoom(origin + '/join?code=k7pm', origin)).toBe(origin + '/join?code=K7PM');
  expect(scannedRoom('https://tv.example/join?code=K7PM&redirect=https://elsewhere.example/#ignored', origin))
    .toBe('https://tv.example/join?code=K7PM');
  expect(scannedRoom('http://192.168.1.7:5173/join?code=K7PM', origin)).toBe('http://192.168.1.7:5173/join?code=K7PM');
});

test('unrelated or malformed QR values never become navigation targets', () => {
  for (const value of [null, '', 'ABCD!', 'https://example.com', 'javascript:alert(1)',
    'https://user:pass@wee.example/join?code=K7PM', 'https://wee.example/host/K7PM',
    'https://wee.example/join?code=K7PM&code=AAAA', 'https://wee.example/join?code=too-long',
    'https://wee.example/join?code=K7P', 'https://wee.example/join?code=%%%%',
    'https://wee.example/join?code=K7PM' + 'a'.repeat(2048)]) {
    expect(scannedRoom(value, 'https://wee.example')).toBeNull();
  }
});
