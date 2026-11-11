const { test } = require('node:test');
const assert = require('node:assert/strict');

test('Expo iOS and Android gravity-down fixtures produce the same screen-up bowling aim', async () => {
  const { nativeDeviceMotionFields, nativeBowlingSupportVector } = await import('../src/nativeSample.js');
  const { normalizeWebMotion } = await import('../../../shared/motion.js');
  const { bowlingTiltAim } = await import('../../../src/controller/motionGestures.js');
  const g = 9.80665;
  for (const degrees of [-25, 0, 25]) {
    const support = { x: Math.sin(degrees * Math.PI / 180) * g, y: 0, z: Math.cos(degrees * Math.PI / 180) * g };
    const linear = { x: .25, y: -.4, z: .1 };
    // Exact formulas from installed expo-sensors 58.0.4 native sources.
    const ios = Object.fromEntries(['x', 'y', 'z'].map(axis => [axis, linear[axis] - support[axis]]));
    const android = Object.fromEntries(['x', 'y', 'z'].map(axis => [axis, (linear[axis] + support[axis]) - 2 * support[axis]]));
    const browser = normalizeWebMotion({ acceleration: linear,
      accelerationIncludingGravity: Object.fromEntries(['x', 'y', 'z'].map(axis => [axis, linear[axis] + support[axis]])) }, {timeSeconds:1,sequence:1});
    for (const total of [ios, android]) {
      const sample = nativeDeviceMotionFields({acceleration:linear,accelerationIncludingGravity:total});
      assert.ok(sample.gravity.z < 0, 'canonical native gravity remains physical down');
      const aim = bowlingTiltAim(nativeBowlingSupportVector(sample.gravity), 0);
      assert.ok(Math.abs(aim - bowlingTiltAim(browser.gravity, 0)) < 1e-12);
      if (degrees) assert.notEqual(aim, 0, 'left/right tilt must change aim');
    }
  }
});

test('native gravity requires real linear and total acceleration and strips timestamp metadata', async () => {
  const { nativeDeviceMotionFields, nativeBowlingSupportVector } = await import('../src/nativeSample.js');
  assert.equal(nativeDeviceMotionFields({accelerationIncludingGravity:{x:0,y:0,z:-9.8}}).gravity, undefined);
  assert.equal(nativeDeviceMotionFields({acceleration:{x:0,y:null,z:0},accelerationIncludingGravity:{x:0,y:0,z:-9.8}}).gravity, undefined);
  assert.deepEqual(nativeDeviceMotionFields({acceleration:{x:1,y:2,z:3,timestamp:999}}), {acceleration:{x:1,y:2,z:3}});
  assert.equal(nativeBowlingSupportVector(undefined), undefined);
});

test('raw iPhone and Android Accelerometer g units give the same tilt without inventing linear acceleration', async () => {
  const {nativeAccelerometerFields}=await import('../src/nativeSample.js');
  const {createBowlingAimController}=await import('../../../src/controller/bowlingAim.js');
  const aims=[];
  for(const sign of [-1,1]) {
    const fields=nativeAccelerometerFields({x:sign*.3,y:0,z:sign*Math.sqrt(1-.3**2),timestamp:42});
    assert.equal(fields.acceleration,undefined);
    assert.equal(fields.gravity,undefined);
    assert.ok(Math.abs(Math.hypot(...Object.values(fields.accelerationIncludingGravity))-9.80665)<1e-9);
    aims.push(createBowlingAimController().push({...fields,timeSeconds:1,angularVelocity:{x:0,y:0,z:0}}));
  }
  assert.ok(Math.abs(aims[0])>.2);
  assert.equal(aims[0],aims[1]);
});

test('native capture timestamps reject duplicate gravity and retain callback delay without mixing clock origins', async () => {
  const {createNativeSensorClock}=await import('../src/nativeSample.js');
  const clock=createNativeSensorClock();
  assert.equal(clock.read(12345,1000),1000);
  assert.equal(clock.read(12345,1017),null,'a repeated fused frame is not fresh gravity');
  assert.ok(Math.abs(clock.read(12345.033,1050)-1033)<1e-6,'callback delay does not relabel old gravity as current');
  assert.equal(clock.read(12344,1067),null,'out-of-order data is discarded');
  clock.reset();
  assert.equal(clock.read(12350,2000),2000);
  assert.equal(clock.read(undefined,2017),2017,'sources without timestamps still use monotonic receipt time');
});
