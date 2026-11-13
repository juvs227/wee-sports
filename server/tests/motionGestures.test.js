import { test, expect } from 'vitest';
import { createSimpleSwingStream, createBowlingMotionDetector, createBowlingDeliveryGate, bowlingTiltAim } from '@wee/src/controller/motionGestures.js';

const sample = (timeMs, beta, alpha = 0, gamma = 0) => ({ timeMs,
  rotationAlpha: alpha, rotationBeta: beta, rotationGamma: gamma });

test('simple motion maps a deliberate swing to the chosen shot and suppresses follow-through', () => {
  const stream = createSimpleSwingStream('Backhand');
  const results = [];
  for (let time = 0; time <= 2000; time += 20) {
    const rate = time < 300 || time >= 1400 && time < 1700 ? 240 : time < 600 ? -240 : 0;
    stream.push(sample(time, rate));
    results.push(...stream.analyze());
  }
  expect(results.map(result => result.label)).toEqual(['Backhand', 'Backhand']);
  expect(results.map(result => result.startMs)).toEqual([0, 1400]);
});

test('simple motion rejects jitter and disconnected fragments', () => {
  const stream = createSimpleSwingStream();
  for (let time = 0; time <= 1000; time += 20) stream.push(sample(time, 60, 30));
  for (const time of [2000, 2020, 2040, 3000, 3020, 3040]) stream.push(sample(time, 300));
  expect(stream.analyze()).toEqual([]);
});

// Browser DeviceMotion mapping: alpha=X pitch, beta=Y wrist, gamma=Z yaw.
const bowlSample = (time, pitch, twist = 0) => sample(time, twist, pitch);

function delivery(peak = 360, transform = value => value) {
  const detector = createBowlingMotionDetector();
  const rolls = [];
  for (let time = 0; time <= 1600; time += 20) {
    const speed = time < 400 ? peak * Math.sin(Math.PI * time / 400) : 0;
    const result = detector.push(transform(bowlSample(time, speed)));
    if (result) rolls.push(result);
  }
  return rolls;
}

test('bowling underhand pitch releases once after slowing and scales power with speed', () => {
  const slow = delivery(260);
  const fast = delivery(600);
  expect(slow).toHaveLength(1);
  expect(fast).toHaveLength(1);
  expect(slow[0].power).toBeGreaterThanOrEqual(.2);
  expect(fast[0].power).toBeGreaterThan(slow[0].power);
  expect(fast[0].power).toBeLessThanOrEqual(1);
  expect(delivery(600, value => ({ ...value, rotationAlpha: -value.rotationAlpha }))).toEqual([]);
});

test.each([[30, 466.6667], [50, 440], [60, 433.3333], [100, 430]])(
  'a settled straight release at %i Hz removes idle confirmation time without changing power', (hz, previousReleaseMs) => {
    const detector = createBowlingMotionDetector();
    const rolls = [];
    for (let frame = 0; frame <= hz; frame++) {
      const time = frame * 1000 / hz;
      const pitch = time < 400 ? 400 * Math.sin(Math.PI * time / 400) : 0;
      const result = detector.push(bowlSample(time, pitch));
      if (result) rolls.push({time, ...result});
    }
    expect(rolls).toHaveLength(1);
    expect(rolls[0].time).toBeLessThanOrEqual(previousReleaseMs - 15);
    expect(rolls[0].power).toBeCloseTo((400 - 90) / 600);
    expect(rolls[0].spin).toBe(0);
  });

test.each([20, 70, 100])('a %i deg/s wrist turn keeps the full release window and curve', twist => {
  const detector = createBowlingMotionDetector();
  let roll;
  for (let time = 0; time <= 600; time += 20) {
    const result = detector.push(bowlSample(time, time < 400 ? 400 * Math.sin(Math.PI * time / 400) : 0, twist));
    if (result) roll = {time, ...result};
  }
  expect(roll.time).toBe(440);
  // The forward segment starts at 40 ms; twist integrates only its next 400 ms.
  expect(roll.spin).toBeCloseTo((twist * .4 - 6) / 45 * .55);
});

test('one quiet sensor sample during deceleration does not prematurely release a continuing swing', () => {
  const detector = createBowlingMotionDetector();
  for (let time = 0; time <= 300; time += 20) expect(detector.push(bowlSample(time, 400))).toBeNull();
  expect(detector.push(bowlSample(320, 100))).toBeNull();
  expect(detector.push(bowlSample(340, 100))).toBeNull();
  expect(detector.push(bowlSample(360, 0))).toBeNull();
  expect(detector.push(bowlSample(380, 400))).toBeNull();
  expect(detector.phase).toBe('forward');
});

test('a compact swing that settles before minimum duration can still finish qualifying', () => {
  const detector = createBowlingMotionDetector();
  const releases = [];
  for (let time = 0; time <= 300; time += 20) {
    const result = detector.push(bowlSample(time, time <= 80 ? 400 : 0));
    if (result) releases.push({time, ...result});
  }
  expect(releases).toHaveLength(1);
  expect(releases[0].time).toBeGreaterThanOrEqual(160);
  expect(releases[0].power).toBeCloseTo((400 - 90) / 600);
});

test('backswing never charges or releases, even with strong linear acceleration', () => {
  const detector = createBowlingMotionDetector();
  for (let time = 0; time <= 1000; time += 20) {
    const pitch = time < 400 ? -900 * Math.sin(Math.PI * time / 400) : 0;
    expect(detector.push({ ...bowlSample(time, pitch, 100), acceleration: { x: 20, y: -25, z: 15 } })).toBeNull();
    expect(detector.preview).toEqual({ power: 0, spin: 0, peakRotation: 0 });
  }
});

test('a fast backswing followed by a gentle forward swing uses only forward power and curve', () => {
  const detector = createBowlingMotionDetector();
  for (let time = 0; time < 600; time += 20) {
    const pitch = time < 400 ? -900 * Math.sin(Math.PI * time / 400) : 0;
    expect(detector.push({ ...bowlSample(time, pitch, -250), acceleration: { x: 20, y: -25, z: 15 } })).toBeNull();
  }
  const rolls = [];
  for (let time = 0; time <= 1000; time += 20) {
    const pitch = time < 400 ? 260 * Math.sin(Math.PI * time / 400) : 0;
    const result = detector.push(bowlSample(time + 600, pitch));
    if (result) rolls.push(result);
  }
  expect(rolls).toEqual(delivery(260));
});

test('reversing a charged forward swing cancels it instead of releasing on the backswing', () => {
  const detector = createBowlingMotionDetector();
  for (let time = 0; time < 300; time += 20) expect(detector.push(bowlSample(time, 400))).toBeNull();
  expect(detector.preview.power).toBeGreaterThan(0);
  for (let time = 300; time <= 1000; time += 20) {
    expect(detector.push(bowlSample(time, time < 600 ? -400 : 0))).toBeNull();
    expect(detector.preview.power).toBe(0);
  }
});

test('ordinary signed sensor noise cannot charge a bowling delivery', () => {
  const detector = createBowlingMotionDetector();
  for (let time = 0; time <= 1000; time += 20) {
    expect(detector.push(bowlSample(time, Math.sin(time) * 25, Math.cos(time) * 20))).toBeNull();
    expect(detector.preview.power).toBe(0);
  }
});

test('bowling ignores weak movement, sideways tennis strokes, and sensor gaps', () => {
  expect(delivery(60)).toEqual([]);
  expect(delivery(400, value => sample(value.timeMs, value.rotationAlpha, 20))).toEqual([]);
  const detector = createBowlingMotionDetector();
  const results = [];
  for (const time of [0, 20, 40, 60, 500, 520, 540, 560, 580, 600]) {
    const result = detector.push(bowlSample(time, time < 500 ? 400 : 0));
    if (result) results.push(result);
  }
  expect(results).toEqual([]);
});

test('bowling rejects a direction reversal before release and malformed sensor data', () => {
  const detector = createBowlingMotionDetector();
  for (const time of [0, 20, 40, 60, 80]) expect(detector.push(bowlSample(time, 400))).toBeNull();
  expect(detector.push(bowlSample(100, -400))).toBeNull();
  expect(detector.push(bowlSample(120, NaN))).toBeNull();
  for (let time = 140; time <= 500; time += 20) expect(detector.push(bowlSample(time, 0))).toBeNull();
});

test('wrist twist curves in either direction, ignores jitter and stays bounded', () => {
  const twist = gamma => delivery(400, value => ({ ...value, rotationBeta: gamma }))[0];
  expect(twist(0).spin).toBe(0);
  expect(twist(5).spin).toBe(0);
  expect(twist(20).spin).toBeGreaterThan(0);
  expect(twist(70).spin).toBeGreaterThan(0);
  expect(twist(70).spin).toBeLessThan(.3);
  expect(twist(-70).spin).toBeCloseTo(-twist(70).spin);
  expect(twist(150).spin).toBeLessThanOrEqual(.55);
  expect(twist(150).spin).toBeGreaterThan(twist(70).spin);
});

test('wrist rotation through release adds curve but later follow-through cannot', () => {
  const lateTurn = delivery(400, value => ({ ...value, rotationBeta: value.timeMs > 340 ? 100 : 0 }));
  expect(lateTurn).toHaveLength(1);
  expect(lateTurn[0].spin).toBeGreaterThan(0);
  expect(delivery(400, value => ({...value, rotationBeta: value.timeMs > 600 ? 250 : 0}))[0].spin).toBe(0);
});

test('power can use linear acceleration but works without it and never uses gravity', () => {
  const gyro = delivery(300)[0];
  const measured = delivery(300, value => ({ ...value, acceleration: { x: 0, y: 14, z: 0 } }))[0];
  expect(measured.power).toBeGreaterThan(gyro.power);
  expect(measured.power).toBeLessThanOrEqual(1);
  expect(delivery(300, value => ({ ...value, acceleration: { x: null, y: null, z: null } }))[0]).toEqual(gyro);
  expect(delivery(300, value => ({ ...value, accelerationIncludingGravity: { x: 0, y: 0, z: 9.8 } }))[0]).toEqual(gyro);
  expect(delivery(0, value => ({ ...value, acceleration: { x: 30, y: 30, z: 30 } }))).toEqual([]);
  expect(delivery(300, value => ({ ...value, acceleration: { x: 0, y: value.timeMs > 340 ? -30 : 0, z: 0 } }))[0]).toEqual(gyro);
});

test('wrist curve and power remain close at common sensor sampling rates', () => {
  const rolls = [30, 60, 100].map(hz => {
    const detector = createBowlingMotionDetector();
    for (let time = 0; time <= 1000; time += 1000 / hz) {
      const envelope = time < 400 ? Math.sin(Math.PI * time / 400) : 0;
      const result = detector.push(bowlSample(time, 400 * envelope, 100 * envelope));
      if (result) return result;
    }
  });
  expect(rolls.every(Boolean)).toBe(true);
  for (const roll of rolls) {
    expect(Math.abs(roll.power - rolls[0].power)).toBeLessThan(.03);
    expect(Math.abs(roll.spin - rolls[0].spin)).toBeLessThan(.1);
  }
});

test('tilt follows quick side positioning and rejects invalid gravity', () => {
  expect(bowlingTiltAim({ x: 0, y: 0, z: 9.8 }, 0)).toBe(0);
  expect(bowlingTiltAim({ x: -3, y: 0, z: 9.3 }, 10)).toBeGreaterThan(.3);
  expect(bowlingTiltAim({ x: 3, y: 0, z: 9.3 }, 10)).toBeLessThan(-.3);
  expect(bowlingTiltAim({ x: -.1, y: 0, z: 9.79 }, 10)).toBe(0);
  expect(bowlingTiltAim({ x: -.5, y: 0, z: 9.79 }, 10)).toBeGreaterThan(0);
  expect(bowlingTiltAim({ x: -7, y: 0, z: 7 }, 10)).toBe(1);
  for (const gravity of [null, { x: null, y: 0, z: 9.8 }, { x: 0, y: 9.8, z: 0 }, { x: 0, y: 0, z: 30 }]) {
    expect(bowlingTiltAim(gravity, 0)).toBeNull();
  }
  expect(bowlingTiltAim({ x: -3, y: 0, z: 9.3 }, 120)).toBeGreaterThan(.3);
  expect(bowlingTiltAim({ x: -3, y: 0, z: 9.3 }, 360)).toBeGreaterThan(.3);
});

test('opposite gravity and support-acceleration conventions keep the same bowling aim', () => {
  for (const x of [-5, -2, 0, 2, 5]) {
    const support = {x, y: 0, z: Math.sqrt(9.81 ** 2 - x ** 2)};
    const gravity = {x: -support.x, y: -support.y, z: -support.z};
    expect(bowlingTiltAim(gravity, 0)).toBeCloseTo(bowlingTiltAim(support, 0), 12);
  }
});


test('natural bowling gate freezes aim at forward onset and latches until a new authoritative turn', () => {
  const gate = createBowlingDeliveryGate();
  let time = 0, key = 'turn-1', aim = .35;
  const push = (pitch = 0, twist = 0, active = true) => gate.push(bowlSample(time += 20, pitch, twist), {active, turnKey: key, aim});
  for (let i = 0; i < 20; i++) expect(push(400)).toBeNull(); // Joining during motion cannot bowl.
  for (let i = 0; i < 16; i++) push();
  expect(gate.phase).toBe('ready');
  expect(gate.lockedAim).toBeNull();
  for (let i = 0; i < 15; i++) push(-500); // Backswing does not lock aim or charge power.
  expect(gate.preview.power).toBe(0);
  aim = -.4;
  push(400);
  expect(gate.phase).toBe('forward');
  expect(gate.lockedAim).toBe(-.4);
  aim = .8;
  const rolls = [];
  for (let i = 0; i < 35; i++) { const result = push(i < 15 ? 400 : 0, i < 20 ? 100 : 0); if (result) rolls.push(result); }
  expect(rolls).toHaveLength(1);
  expect(rolls[0].aim).toBe(-.4);
  expect(rolls[0].spin).toBeGreaterThan(0);
  gate.suspend();
  for (let i = 0; i < 60; i++) expect(push(i > 20 && i < 40 ? 400 : 0, 0, i > 5)).toBeNull();
  expect(gate.phase).toBe('finished'); // ACK/reconnect/timeouts are not a new delivery.
  key = 'turn-2';
  for (let i = 0; i < 16; i++) push();
  for (let i = 0; i < 35; i++) { const result = push(i < 15 ? 400 : 0); if (result) rolls.push(result); }
  expect(rolls).toHaveLength(2);
});

test('natural gate drops partial swings on a sensor gap, hidden page or turn loss', () => {
  for (const interruption of ['gap', 'suspend', 'turn']) {
    const gate = createBowlingDeliveryGate();
    let time = 0;
    const push = (pitch = 0, active = true) => gate.push(bowlSample(time += 20, pitch), {active, turnKey: 1, aim: 0});
    for (let i = 0; i < 16; i++) push();
    for (let i = 0; i < 10; i++) push(400);
    if (interruption === 'gap') time += 300;
    if (interruption === 'suspend') gate.suspend();
    if (interruption === 'turn') push(400, false);
    for (let i = 0; i < 8; i++) expect(push()).toBeNull();
    expect(gate.phase).toBe('rest');
  }
});

test('only a correlated, definite rejection unlocks a delivery, after another quiet rest', () => {
  const gate = createBowlingDeliveryGate();
  let time = 0;
  const push = (pitch = 0) => gate.push(bowlSample(time += 20, pitch), {active: true, turnKey: 'turn-1', aim: .2});
  for (let i = 0; i < 16; i++) push();
  const rolls = [];
  for (let i = 0; i < 35; i++) {const result = push(i < 15 ? 400 : 0); if (result) rolls.push(result);}
  expect(rolls).toHaveLength(1);
  expect(gate.rejectRelease('old-turn', {ok: false, error: 'network-busy'})).toBe(false);
  for (const result of [{ok: true}, {ok: false}, ...['timeout', 'outcome-unknown', 'duplicate-roll', 'invalid-response'].map(error => ({ok: false, error}))]) {
    expect(gate.rejectRelease('turn-1', result)).toBe(false);
    expect(gate.phase).toBe('finished');
  }
  expect(gate.rejectRelease('turn-1', {ok: false, error: 'network-busy'})).toBe(true);
  for (let i = 0; i < 30; i++) expect(push(400)).toBeNull();
  for (let i = 0; i < 16; i++) push();
  for (let i = 0; i < 35; i++) {const result = push(i < 15 ? 400 : 0); if (result) rolls.push(result);}
  expect(rolls).toHaveLength(2);
});
