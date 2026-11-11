import {expect, test, vi} from 'vitest';
import {createBowlingAimController, createBowlingAimFilter, createBowlingAimStream} from '@wee/src/controller/bowlingAim.js';
import {bowlingTiltAim} from '@wee/src/controller/motionGestures.js';

test('the actual aim tracker follows the same gradual tilt at 30, 60 and 100 Hz', () => {
  const results = [30, 60, 100].map(rate => {
    const controller = createBowlingAimController();
    let value = 0;
    for (let i = 0; i <= rate / 2; i++) value = controller.push({timeSeconds: i / rate,
      gravity: tiltedGravity(i / rate * 40), angularVelocity: {x: 0, y: 40 * Math.PI / 180, z: 0}});
    return value;
  });
  for (const value of results) expect(Math.abs(value - 19 / 34)).toBeLessThan(.04);
  expect(Math.max(...results) - Math.min(...results)).toBeLessThan(.03);
});

test('latest aim is bounded to display cadence, locks immediately and does not replay on pause', () => {
  const send = vi.fn();
  const stream = createBowlingAimStream(send);
  stream.publish(0, false, 0, true);
  for (let time = 1; time < 12; time++) stream.publish(time / 100, false, time, true);
  expect(send).toHaveBeenCalledTimes(1);
  stream.publish(.5, false, 12, true);
  stream.publish(.5, true, 13, true);
  expect(send.mock.calls.at(-1)[0]).toEqual({aim: .5, locked: true, sequence: 3});
  stream.publish(-.8, false, 100, false);
  expect(send).toHaveBeenCalledTimes(3);
  stream.publish(.2, false, 200, true);
  expect(send.mock.calls.at(-1)[0]).toEqual({aim: .2, locked: false, sequence: 4});
  for (const aim of [NaN, Infinity, -2, 2]) stream.publish(aim, false, 300, true);
  expect(send).toHaveBeenCalledTimes(4);
});

test('deliberate aim reaches over 90 percent within two 60Hz samples without overshooting', () => {
  const filter = createBowlingAimFilter();
  filter.reset(0, 0);
  expect(filter.push(.8, 1 / 60)).toBeGreaterThan(.5);
  expect(filter.push(.8, 2 / 60)).toBeGreaterThan(.72);
  const reverse = filter.push(-.8, 3 / 60);
  expect(reverse).toBeLessThan(0);
  expect(filter.push(-.8, 4 / 60)).toBeLessThan(-.6);
  for (let i = 5; i < 60; i++) expect(filter.push(-.8, i / 60)).toBeGreaterThanOrEqual(-.8);
});

test('small aim tremors stay filtered and stale timestamps cannot rewind the guide', () => {
  const filter = createBowlingAimFilter(); filter.reset(0, 0);
  for (let i = 1; i < 60; i++) expect(Math.abs(filter.push(i % 2 ? .012 : -.012, i / 60))).toBeLessThan(.007);
  expect(filter.push(.6, 2)).toBe(.6); // A new stream after a gap starts at its latest value.
  expect(filter.push(-.9, 1)).toBe(.6);
  expect(filter.push(NaN, 3)).toBe(.6);
});

test('stationary aim refreshes without a per-sensor packet flood', () => {
  const send = vi.fn();
  const stream = createBowlingAimStream(send);
  for (let time = 0; time <= 1000; time++) stream.publish(.1, false, time, true);
  expect(send).toHaveBeenCalledTimes(6);
});

const tiltedGravity = degrees => ({x: -Math.sin(degrees * Math.PI / 180) * 9.80665,
  y: 0, z: Math.cos(degrees * Math.PI / 180) * 9.80665});

test('quick side tilt follows every gyro sample between 30Hz gravity updates without a frozen first half', () => {
  const controller = createBowlingAimController();
  const gyro = {x: 0, y: 300 * Math.PI / 180, z: 0};
  controller.push({timeSeconds: 0, gravity: tiltedGravity(0), angularVelocity: {x: 0, y: 0, z: 0}});
  let previous = 0;
  for (let index = 1; index <= 6; index++) {
    const gravityIndex = Math.floor(index / 2) * 2;
    const aim = controller.push({timeSeconds: index / 60, gravity: tiltedGravity(gravityIndex * 5), angularVelocity: gyro},
      {gravityTimeSeconds: gravityIndex / 60});
    const expected = bowlingTiltAim(tiltedGravity(index * 5), 0);
    expect(aim).toBeGreaterThan(previous + .05);
    expect(expected - aim).toBeLessThan(.08);
    previous = aim;
  }
  // Prediction must stop when gravity disappears, rather than accumulating drift.
  expect(controller.push({timeSeconds: .22, angularVelocity: gyro})).toBeNull();
});

test('gravity-free acceleration cannot pull an aiming phone in the wrong direction', () => {
  const controller = createBowlingAimController();
  const gravity = tiltedGravity(20);
  expect(controller.push({timeSeconds: 1, gravity,
    accelerationIncludingGravity: {...gravity, x: gravity.x + 8}, angularVelocity: {x: 0, y: 6, z: 0}}))
    .toBeCloseTo(bowlingTiltAim(gravity, 0), 10);
  expect(controller.push({timeSeconds: .9, gravity: tiltedGravity(-20)})).toBeNull();
});

test('sensor callback jitter around 60Hz does not halve moving aim updates', () => {
  const send = vi.fn(); const stream = createBowlingAimStream(send);
  let time = 0;
  for (let index = 0; index < 12; index++) {
    time += [15, 17, 16, 18][index % 4];
    stream.publish(index / 20, false, time, true);
  }
  expect(send).toHaveBeenCalledTimes(12);
});
