import {expect, test} from 'vitest';
import {requestControllerIntent, rememberControllerIntent, rememberedControllerIntent} from '@client/lib/controllerStart.js';

test('Play invokes both permission requests synchronously before waiting for either prompt', async () => {
  const calls = [];
  let allowMotion;
  const result = requestControllerIntent({isSecureContext: true,
    DeviceMotionEvent: {requestPermission() { calls.push('motion'); return new Promise(resolve => {allowMotion = resolve;}); }},
    DeviceOrientationEvent: {requestPermission() { calls.push('orientation'); return Promise.resolve('denied'); }},
  });
  expect(calls).toEqual(['motion', 'orientation']);
  allowMotion('granted');
  expect(await result).toEqual({mode: 'motion', permission: 'granted'});
});

test('denied, unavailable or forbidden motion falls back to playable touch controls', async () => {
  for (const target of [
    {isSecureContext: false, DeviceMotionEvent: {}},
    {isSecureContext: true},
    {isSecureContext: true, DeviceMotionEvent: {}, document: {permissionsPolicy: {allowsFeature: () => false}}},
    {isSecureContext: true, DeviceMotionEvent: {requestPermission: async () => 'denied'}},
    {isSecureContext: true, DeviceMotionEvent: {requestPermission() {throw new Error('blocked');}}},
  ]) expect((await requestControllerIntent(target)).mode).toBe('touch');
});

test('browsers without a permission API can start motion, and optional orientation failure does not block it', async () => {
  expect(await requestControllerIntent({isSecureContext: true, DeviceMotionEvent: {}})).toEqual({mode: 'motion', permission: 'granted'});
  expect((await requestControllerIntent({isSecureContext: true, DeviceMotionEvent: {},
    DeviceOrientationEvent: {requestPermission() {throw new Error('orientation unavailable');}},
  })).mode).toBe('motion');
});

test('remember only the selected mode, and tolerate blocked browser storage', () => {
  const values = new Map();
  const storage = {setItem: (key, value) => values.set(key, value), getItem: key => values.get(key)};
  rememberControllerIntent({mode: 'touch', permission: 'denied'}, storage);
  expect(rememberedControllerIntent(storage)).toEqual({mode: 'touch', permission: 'unavailable'});
  expect([...values.values()]).toEqual(['touch']);
  const blocked = {setItem() {throw new Error('blocked');}, getItem() {throw new Error('blocked');}};
  expect(() => rememberControllerIntent({mode: 'motion'}, blocked)).not.toThrow();
  expect(rememberedControllerIntent(blocked)).toBeNull();
});
