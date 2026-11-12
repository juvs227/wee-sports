import {expect, test, vi} from 'vitest';
import {createOrientationSource} from '../../src/controller/orientationCalibration.js';
import {isSwing} from '../../shared/protocol.js';
import {copySwingDetails, isNormalVector} from '../../shared/swingDetails.js';
import {createSwingOrientation} from '../../src/controller/swingOrientation.js';

const swing = {type: 'swing', id: 'orientation-test', label: 'Forehand', hand: 'Right', power: .5};
test('orientation metadata is optional, bounded and compatible with placement and PR 14 calls', () => {
  const normal = [0, 0, 1];
  expect(isSwing(swing)).toBe(true);
  expect(copySwingDetails(normal, [1, 0, 0])).toEqual({netNormal: normal, swingNormal: [1, 0, 0]});
  const result = copySwingDetails({aim: .4, depth: -.2, netNormal: normal, swingNormal: [-1, 0, 0], ignored: 'private'});
  expect(result).toEqual({aim: .4, depth: -.2, netNormal: normal, swingNormal: [-1, 0, 0]});
  expect(result.netNormal).not.toBe(normal);
  expect(isSwing({...swing, ...result})).toBe(true);
  for (const value of [null, [0, 0], [0, 0, 0], [NaN, 0, 1], [Infinity, 0, 0], [1e6, 0, 0], {x: 1}]) {
    expect(isNormalVector(value)).toBe(false);
    expect(isSwing({...swing, netNormal: value})).toBe(false);
    expect(isSwing({...swing, swingNormal: value})).toBe(false);
  }
});

test('a play session keeps its initial reference but never sends stale or stopped orientation', async () => {
  let now = 0; const sources = [];
  const capture = createSwingOrientation({clock: () => now, createSource() {
    const source = {start: async () => {}, stop() {}, onReading: null}; sources.push(source); return source;
  }});
  await capture.start({bias: {alpha: 0, beta: 0, gamma: 0}});
  const source = sources[0];
  expect(capture.details()).toBe(null);
  source.onReading([], [0, 0, 1]);
  now = 50; source.onReading([], [1, 0, 0]);
  expect(capture.details()).toEqual({netNormal: [0, 0, 1], swingNormal: [1, 0, 0]});
  now = 301; expect(capture.details()).toBe(null);
  capture.stop(); source.onReading([], [0, 1, 0]); expect(capture.details()).toBe(null);
  await capture.start(); source.onReading([], [1, 0, 0]); expect(capture.details()).toBe(null);
  sources[1].onReading([], [0, -1, 0]);
  expect(capture.details()).toEqual({netNormal: [0, -1, 0], swingNormal: [0, -1, 0]});
});


function sensorTarget() {
  const handlers = new Map(), sensors = [];
  const target = {
    document: {hidden: false},
    addEventListener(name, fn) {if (!handlers.has(name)) handlers.set(name, new Set()); handlers.get(name).add(fn);},
    removeEventListener(name, fn) {handlers.get(name)?.delete(fn);},
    AbsoluteOrientationSensor: class {
      handlers = new Map(); quaternion = [0, 0, 0, 1];
      constructor() {sensors.push(this);}
      start() {} stop() {this.stopped = true;}
      addEventListener(name, fn) {this.handlers.set(name, fn);}
      removeEventListener(name) {this.handlers.delete(name);}
      emit(name, event = {}) {this.handlers.get(name)?.(event);}
    },
  };
  const emit = (name, event) => {for (const fn of handlers.get(name) ?? []) fn(event);};
  return {target, sensors, handlers, emit};
}
const motion = {rotationRate: {alpha: 0, beta: 0, gamma: 0}, accelerationIncludingGravity: {x: 0, y: 0, z: 9.81}};

test('native runtime failure resets the reference, falls back to motion and cleans up on stop', async () => {
  const f = sensorTarget(); let now = 0;
  const source = createOrientationSource({target: f.target, clock: () => now, permissions: {query: async () => ({state: 'granted'})}});
  const capture = createSwingOrientation({createSource: () => source, clock: () => now});
  await capture.start(); f.sensors[0].emit('reading');
  expect(capture.details()).toEqual({netNormal: [0, 0, 1], swingNormal: [0, 0, 1]});
  f.sensors[0].emit('error', {error: new Error('sensor failed')});
  expect(capture.details()).toBeNull();
  expect(f.sensors[0].stopped).toBe(true);
  f.emit('devicemotion', motion); now = 20; f.emit('devicemotion', motion);
  expect(capture.details()?.swingNormal).toEqual([0, 0, 1]);
  capture.stop(); expect([...f.handlers.values()].every(set => set.size === 0)).toBe(true);
  expect(source.getNormal()).toBeNull();
});

test('stopping during the native permission query never resurrects a sensor', async () => {
  const f = sensorTarget(); let resolve;
  const permission = new Promise(done => {resolve = done;});
  const source = createOrientationSource({target: f.target, permissions: {query: () => permission}});
  const started = source.start(); source.stop(); resolve({state: 'granted'}); await started;
  expect(f.sensors).toHaveLength(0);
  expect(f.handlers.size).toBe(0);
});

test('unavailable native permission falls back without accepting missing or stale motion data', async () => {
  const f = sensorTarget(); let now = 0;
  const source = createOrientationSource({target: f.target, clock: () => now, permissions: {query: async () => ({state: 'prompt'})}});
  source.onReading = vi.fn(); await source.start();
  expect(f.sensors).toHaveLength(0);
  f.emit('devicemotion', {rotationRate: {alpha: null, beta: 0, gamma: 0}, accelerationIncludingGravity: motion.accelerationIncludingGravity});
  now = 10; f.emit('devicemotion', motion); expect(source.onReading).not.toHaveBeenCalled();
  now = 30; f.emit('devicemotion', motion); expect(source.onReading).toHaveBeenCalledOnce();
  now = 1000; f.emit('devicemotion', motion); expect(source.onReading).toHaveBeenCalledOnce();
  f.target.document.hidden = true; now = 1020; f.emit('devicemotion', motion);
  expect(source.onReading).toHaveBeenCalledOnce(); source.stop();
});
