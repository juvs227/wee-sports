const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finiteSample = sample => Number.isFinite(sample?.timeMs) &&
  ['rotationAlpha', 'rotationBeta', 'rotationGamma'].every(axis => Number.isFinite(sample[axis]));

/** Explicitly selected shot mapping; does not claim to classify handed strokes. */
export function createSimpleSwingStream(label = 'Forehand') {
  let previous = null;
  let started = null;
  let angle = 0;
  let peak = 0;
  let quietSince = null;
  let recovering = false;
  let recoveryStarted = null;
  const pending = [];
  const reset = () => { started = null; angle = 0; peak = 0; quietSince = null; };
  return {
    push(sample) {
      if (!finiteSample(sample)) { reset(); previous = null; return; }
      const gap = previous === null ? 0 : sample.timeMs - previous;
      if (gap <= 0 || gap > 100) reset();
      previous = sample.timeMs;
      const speed = Math.hypot(sample.rotationAlpha, sample.rotationBeta, sample.rotationGamma);
      if (recovering) {
        quietSince = speed < 70 ? quietSince ?? sample.timeMs : null;
        if (sample.timeMs - recoveryStarted >= 450 && quietSince !== null && sample.timeMs - quietSince >= 250) {
          recovering = false; reset();
        }
        return;
      }
      if (speed < 140) { reset(); return; }
      started ??= sample.timeMs;
      peak = Math.max(peak, speed);
      angle += speed * Math.max(0, Math.min(gap, 100)) / 1000;
      if (sample.timeMs - started >= 100 && angle >= 22) {
        pending.push({ label, early: true, complete: false, startMs: started, peakRotation: peak, detectionDelayMs: sample.timeMs - started, simple: true });
        recovering = true; recoveryStarted = sample.timeMs; reset();
      }
    },
    analyze() { return pending.splice(0); },
    get phase() { return recovering ? 'recovering' : 'ready'; },
  };
}

/** A bowling delivery is a forward underhand pitch followed by deceleration.
 * The turn gate below admits one delivery after a brief rest.
 * Power is a bounded game input, not an estimate of real ball speed.
 */
export function createBowlingMotionDetector() {
  let previous = null;
  let started = null;
  let peak = 0;
  let rotation = 0;
  let pitchRotation = 0;
  let slowSince = null;
  let quietSamples = 0;
  let finished = false;
  let twist = 0;
  let accelerationPeak = 0;
  function values() {
    const gyroPower = clamp((peak - 90) / 600, .2, 1);
    const accelerationPower = clamp(accelerationPeak / 18, 0, 1);
    // Acceleration assists the gyro estimate only when the device supplies
    // gravity-free readings; gravity itself must never charge a shot.
    const power = peak ? clamp(Math.max(gyroPower, gyroPower * .8 + accelerationPower * .2), .2, 1) : 0;
    // Normal grip changes should stay straight. Deliberate wrist turns ramp
    // gently, with less than full side spin even at the end of the range.
    const turn = clamp((Math.abs(twist) - 6) / 45, 0, 1);
    const spin = Math.sign(twist) * turn * .55 || 0;
    return { power, spin, peakRotation: peak };
  }
  function reset() { started = null; peak = 0; rotation = 0; pitchRotation = 0; slowSince = null; quietSamples = 0; twist = 0; accelerationPeak = 0; }
  return {
    push(sample) {
      if (finished) return null;
      if (!finiteSample(sample)) { reset(); previous = null; return null; }
      const gap = previous === null ? 0 : sample.timeMs - previous;
      if (gap <= 0 || gap > 100) reset();
      previous = sample.timeMs;
      // DeviceMotion rotationRate uses alpha=X, beta=Y, gamma=Z (W3C).
      // With screen up and the phone top toward the TV, +X is forward pitch;
      // +Y wrist rotation requests curve to the right as seen on the TV.
      // A negative forward sample must neither arm a release nor
      // contribute power, angle or curve to the following forward delivery.
      if (sample.rotationAlpha < -35) { reset(); return null; }
      const pitch = Math.max(0, sample.rotationAlpha);
      const speed = Math.hypot(sample.rotationAlpha, sample.rotationBeta, sample.rotationGamma);
      let dt = Math.max(0, Math.min(gap, 100)) / 1000;
      if (started === null) {
        if (pitch < 100 || pitch < speed * .55) return null;
        started = sample.timeMs;
        dt = 0; // No angle is credited from before this forward segment.
      }
      if (sample.timeMs - started > 1800) {
        reset(); return null;
      }
      peak = Math.max(peak, pitch);
      rotation += speed * dt;
      pitchRotation += pitch * dt;
      // Include wrist rotation as the swing slows into release. Active wrist
      // turns keep the full 80 ms window; a confirmed, quiet finish can release
      // sooner. Backswing samples were excluded above.
      const forwardPower = pitch >= Math.max(100, peak * .45);
      twist += sample.rotationBeta * dt;
      const acceleration = sample.acceleration;
      if (forwardPower && acceleration && ['x', 'y', 'z'].every(axis => Number.isFinite(acceleration[axis]))) {
        accelerationPeak = Math.max(accelerationPeak, Math.min(30, Math.hypot(acceleration.x, acceleration.y, acceleration.z)));
      }
      slowSince = pitch < peak * .45 ? slowSince ?? sample.timeMs : null;
      quietSamples = slowSince !== null && pitch <= 35 &&
        Math.abs(sample.rotationBeta) <= 12 && Math.abs(sample.rotationGamma) <= 12 ? quietSamples + 1 : 0;
      const settled = quietSamples >= 2 && sample.timeMs - slowSince >= 40;
      if (slowSince !== null && (sample.timeMs - slowSince >= 80 || settled)) {
        if (sample.timeMs - started >= 160 && pitchRotation >= 25 && pitchRotation >= rotation * .55 && peak >= 150) {
          finished = true;
          return values();
        }
        // A quick compact swing may settle before its minimum duration. Keep
        // the original confirmation window to qualify it instead of erasing it.
        if (sample.timeMs - slowSince >= 80) reset();
      }
      return null;
    },
    get preview() { return values(); },
    get phase() { return finished ? 'finished' : started === null ? 'ready' : 'forward'; },
  };
}

/** Natural swing entry: fresh quiet samples prepare the current player's turn.
 * A release stays latched until an authoritative turnKey changes. Pausing,
 * reconnecting or a local timeout cannot create a new turn. An explicit,
 * correlated rejection that proves no ball was released can permit a retry.
 */
export function createBowlingDeliveryGate({quietMs = 250, quietSpeed = 45} = {}) {
  let key, previous = null, quietSince = null, detector = null, aim = null, released = false;
  const suspend = () => { previous = null; quietSince = null; detector = null; aim = null; };
  return {
    push(sample, {active = false, turnKey, aim: liveAim = 0} = {}) {
      if (turnKey !== key) { key = turnKey; released = false; suspend(); }
      if (!active || released || !finiteSample(sample)) { suspend(); return null; }
      const gap = previous === null ? 0 : sample.timeMs - previous;
      if (gap <= 0 || gap > 100) suspend();
      previous = sample.timeMs;
      if (!detector) {
        const speed = Math.hypot(sample.rotationAlpha, sample.rotationBeta, sample.rotationGamma);
        quietSince = speed <= quietSpeed ? quietSince ?? sample.timeMs : null;
        if (quietSince === null || sample.timeMs - quietSince < quietMs) return null;
        detector = createBowlingMotionDetector();
      }
      const before = detector.phase;
      const delivery = detector.push(sample);
      if (before !== 'forward' && detector.phase === 'forward') aim = clamp(Number.isFinite(liveAim) ? liveAim : 0, -1, 1);
      if (detector.phase === 'ready') aim = null;
      if (!delivery) return null;
      released = true;
      return {...delivery, aim: aim ?? clamp(liveAim, -1, 1)};
    },
    suspend,
    rejectRelease(turnKey, result) {
      // Unknown outcomes and duplicates may already be moving on the TV. Do
      // not unlock them on a timeout, a delayed ACK or a changed generation.
      if (!released || turnKey !== key || result?.ok !== false || ![
        'network-busy', 'disconnected', 'paused', 'not-playing', 'wrong-generation',
        'game-loading', 'game-command-pending', 'not-ready-to-roll', 'not-your-turn', 'bad-roll',
      ].includes(result.error)) return false;
      released = false;
      suspend();
      return true;
    },
    get phase() { return released ? 'finished' : detector?.phase ?? 'rest'; },
    get lockedAim() { return aim; },
    get preview() { return detector?.preview ?? {power: 0, spin: 0, peakRotation: 0}; },
  };
}

/** Screen-up tilt aim consumes gravity only while positioning. The delivery
 * gate locks the line; speed alone must not freeze a legitimate side tilt. */
export function bowlingTiltAim(gravity, rotationSpeed) {
  if (!gravity || !['x', 'y', 'z'].every(axis => Number.isFinite(gravity[axis])) || !Number.isFinite(rotationSpeed)) return null;
  const magnitude = Math.hypot(gravity.x, gravity.y, gravity.z);
  if (magnitude < 7.5 || magnitude > 12 || Math.abs(gravity.z) < 5) return null;
  // Engines expose either support acceleration or downward gravity. For the
  // screen-up playing pose the two vectors are opposites; their tilt ratio
  // must produce the same lane direction, without browser-name detection.
  const supportSign = Math.sign(gravity.z);
  const angle = -Math.atan2(gravity.x * supportSign, Math.abs(gravity.z)) * 180 / Math.PI;
  // A small center band removes hand tremor without hiding the first four
  // degrees of every aiming movement. Full travel still takes 35 degrees.
  return Math.sign(angle) * clamp((Math.abs(angle) - 1) / 34, 0, 1) || 0;
}
