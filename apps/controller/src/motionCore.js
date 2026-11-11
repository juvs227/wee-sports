import {createAutomaticMotionSetup, normalizeNativeGyroscope, toLegacyMotionSample} from '../../../shared/motion.js';
import { createBowlingDeliveryGate } from '../../../src/controller/motionGestures.js';
import { nativeDeviceMotionFields, nativeAccelerometerFields, createNativeSensorClock } from './nativeSample.js';
import { createBowlingAimController } from '../../../src/controller/bowlingAim.js';
import { createSwingStream } from '../../../src/controller/swingStream.js';
import { createSimpleSwingStream } from '../../../src/controller/motionGestures.js';
import { tennisPower } from '../../../src/controller/tennisPower.js';

import {createTennisAim} from '../../../shared/tennisAim.js';
import {nativeDiagnostics} from '../../../shared/diagnostics.js';

/** Native collection only; units, calibration, filters and sport recognition are shared. */
export class MotionController {
  constructor({ session, sensors, onStatus = () => {}, onRelease = () => {}, onSwing = () => {}, hand = 'Right', sensitivity = 1, strokeMode = 'auto', now = () => performance.now() }) {
    this.Gyroscope = sensors.Gyroscope;
    this.DeviceMotion = sensors.DeviceMotion;
    this.Accelerometer = sensors.Accelerometer;
    this.session = session;
    this.onStatus = onStatus;
    this.onRelease = onRelease;
    this.onSwing = onSwing;


    this.hand = hand;
    this.sensitivity = sensitivity;
    this.strokeMode = strokeMode;
    this.now = now;
    this.diagnostics = nativeDiagnostics('phone.native.motion');
    this.sequence = 0;
    this.attempt = 0;
    this.revision = 0;
    this.aim = 0;
    this.active = false;
    this.filter = createBowlingAimController();
    this.deviceClock = createNativeSensorClock();
    this.accelerometerClock = createNativeSensorClock();
    this.gyroClock = createNativeSensorClock();
    this.captureAgeMs = 0; this.maxCaptureAgeMs = 0; this.staleSamples = 0;
    this.tennisAim = createTennisAim({sensitivity});

    this.automatic = createAutomaticMotionSetup();
    this.delivery = createBowlingDeliveryGate();
    this.resetSwing();
  }

  async calibrate() {
    this.stop();
    const attempt = this.attempt;
    const permission = await this.Gyroscope.requestPermissionsAsync();
    if (this.attempt !== attempt) return;
    const available = permission.granted && await this.Gyroscope.isAvailableAsync();
    if (this.attempt !== attempt) return;
    if (!available) throw Object.assign(new Error('This phone could not start motion. Touch controls still work.'), {code:'motion-unavailable'});
    this.active = true;
    this.calibration = null;
    this.automatic.reset();

    this.filter.reset(0);
    this.samples = 0;
    this.lastUi = -Infinity;
    this.lastTime = null;
    this.largestGap = 0;
    this.Gyroscope.setUpdateInterval(1000 / 60);
    let gravityAvailable = await this.DeviceMotion.isAvailableAsync().catch(() => false);
    if (!this.active || this.attempt !== attempt) return;
    // Gyroscope on iOS has no permission requester. DeviceMotion owns the
    // Motion & Fitness permission needed for gravity/acceleration and aim.
    if (gravityAvailable && this.DeviceMotion.requestPermissionsAsync) {
      const permission = await this.DeviceMotion.requestPermissionsAsync().catch(() => ({granted:false}));
      if (!this.active || this.attempt !== attempt) return;
      gravityAvailable = permission.granted;
      if (!gravityAvailable && this.session.seat?.sport === 'bowling') {
        this.stop();
        throw Object.assign(new Error('Allow Motion & Fitness in Settings to use motion bowling.'), {code:'permission-denied'});
      }
    }
    const accelerometerAvailable = this.session.seat?.sport === 'bowling' &&
      Boolean(await this.Accelerometer?.isAvailableAsync().catch(() => false));
    if (!this.active || this.attempt !== attempt) return;
    if (!gravityAvailable && !accelerometerAvailable && this.session.seat?.sport === 'bowling') {
      this.stop();
      throw Object.assign(new Error('Motion aiming is unavailable on this phone. Touch controls still work.'), {code:'aim-unavailable'});
    }
    // Time spent reading a system permission sheet is not sensor silence.
    // Start the watchdog only after permissions resolve and listeners attach.
    this.started = this.now();
    if (gravityAvailable) {
      this.DeviceMotion.setUpdateInterval(1000 / 60);
      this.deviceSubscription = this.DeviceMotion.addListener(reading => {
        if (nativeDeviceMotionFields(reading).gravity) {
          const captured = this.deviceClock.read(reading.accelerationIncludingGravity?.timestamp, this.now());
          if (captured !== null) {this.device = reading; this.deviceReceived = captured;}
        }
      });
    }
    if (accelerometerAvailable) {
      this.Accelerometer.setUpdateInterval(1000 / 60);
      this.accelerometerSubscription = this.Accelerometer.addListener(reading => {
        const fields = nativeAccelerometerFields(reading);
        if (fields.accelerationIncludingGravity) {
          const captured = this.accelerometerClock.read(reading.timestamp, this.now());
          if (captured !== null) {this.rawAcceleration = fields; this.accelerometerReceived = captured;}
        }
      });
    }
    this.gyroSubscription = this.Gyroscope.addListener(reading => this.sample(reading));
    this.noDataTimer = setInterval(() => this.checkReadings(), 250);
  }

  checkReadings() {
    if (!this.active) return;
    if (this.session.inputActive === false) {this.started = this.now(); return;}
    const silence = this.now() - Math.max(this.lastTime ?? this.started, this.started);
    const missingAim = this.session.seat?.sport === 'bowling' &&
      this.now() - Math.max(this.deviceReceived ?? this.started, this.accelerometerReceived ?? this.started, this.started) > 2000;
    if (silence > 2000 || missingAim) this.onStatus({state:'no-readings',reason:missingAim ? 'aim-no-readings' : 'motion-no-readings'});
    else if (!this.automatic.read(this.now() / 1000).ready) {
      this.readyNotified = false;
      this.delivery.suspend();  this.resetSwing();
      this.onStatus({state:'warming'});
    }
  }

  sample(reading) {
    if (!this.active) return;
    const received = this.now();
    const time = this.gyroClock.read(reading.timestamp, received);
    if (time === null) {this.diagnostics.count('sensor.duplicateOrOutOfOrder'); return;}
    this.captureAgeMs = Math.max(0, received - time);
    this.maxCaptureAgeMs = Math.max(this.maxCaptureAgeMs, this.captureAgeMs);
    this.diagnostics.observe('sensor.captureAgeMs', this.captureAgeMs);
    // A delayed native callback is not a new gesture. Keep only fresh capture
    // intervals; a subsequent gap safely resets recognition before resuming.
    if (this.captureAgeMs > 100) {this.staleSamples++; this.diagnostics.count('sensor.stale'); return;}
    const sample = normalizeNativeGyroscope(reading, {
      timeSeconds: time / 1000, sequence: this.sequence++,
      screenAngle: this.device?.orientation ?? 0, calibrationRevision: this.revision,
    });
    if (!sample) return;
    this.samples++;
    this.diagnostics.count('sensor.accepted');
    if (this.lastTime !== null) this.diagnostics.observe('sensor.intervalMs',time-this.lastTime);
    if (this.lastTime !== null) this.largestGap = Math.max(this.largestGap, time - this.lastTime);
    this.lastTime = time;
    const deviceFields = nativeDeviceMotionFields(this.device);
    if (deviceFields.gravity && this.deviceReceived !== null && time - this.deviceReceived < 250) {
      Object.assign(sample, deviceFields);
    } else if (this.rawAcceleration && time - this.accelerometerReceived < 250) {
      Object.assign(sample, this.rawAcceleration);
    }
    const seat = this.session.seat;
    const safeBoundary = !this.session.playing() ||
      (seat?.sport === 'bowling' && seat.gameState?.phase === 'ready' && this.delivery.phase !== 'forward');
    const status = this.automatic.push(sample, {safeBoundary,recenter:safeBoundary});
    this.calibration = status.calibration;
    const aimReady = seat?.sport !== 'bowling' || Boolean(sample.gravity || sample.accelerationIncludingGravity);
    if (!status.ready || !aimReady) {
      this.readyNotified = false;
      this.delivery.suspend();  this.resetSwing();
      if (time - this.lastUi > 100) {this.lastUi = time; this.onStatus({state:'warming'});}
      return;
    }
    if (!this.readyNotified) {this.readyNotified = true; this.onStatus({state:'ready'});}
    const corrected = status.sample;
    if (this.session.inputSetup !== 'motion') return;
    if (!this.session.playing()) {
      if (this.wasPlaying) this.resetInput();
      this.wasPlaying = false;
      return;
    }
    this.wasPlaying = true;
    if (this.session.controlsActive===false || seat.gameState?.phase==='complete') {
      this.controlsQuietSince=null;
      if (!this.controlsSuspended) {
        this.resetInput();

        this.controlsSuspended=true;
      }

      return;
    }
    if(this.controlsSuspended) {
      const rate=Math.hypot(corrected.angularVelocity.x,corrected.angularVelocity.y,corrected.angularVelocity.z);
      this.controlsQuietSince=rate<=.55 ? this.controlsQuietSince ?? time : null;
      if(this.controlsQuietSince===null || time-this.controlsQuietSince<120) {

        return;
      }
      this.resetInput();this.controlsSuspended=false;this.controlsQuietSince=null;
    }
    if (this.session.seat?.sport === 'bowling') {
      const legacy = toLegacyMotionSample(corrected);
      const turnKey = this.session.bowlingTurnKey;
      const active = this.session.playing() && seat.gameState?.phase === 'ready' &&
        seat.gameState?.currentPlayer === seat.slot + 1 && this.session.bowlingReleasedTurn !== turnKey;
      const release = this.delivery.push(legacy, {active,turnKey,aim:this.aim});
      if (this.delivery.lockedAim === null) {
        const gravityTime = sample.gravity ? this.deviceReceived : this.accelerometerReceived;
        const nextAim = this.filter.push(corrected, {gravityTimeSeconds:gravityTime / 1000, sensitivity:this.sensitivity});
        if (nextAim !== null) this.aim = nextAim;
      }
      if (active) this.session.latest('aim', {aim:this.delivery.lockedAim ?? this.aim,locked:this.delivery.lockedAim !== null});
      if (release) {this.session.bowlingReleasedTurn = turnKey; this.onRelease(release);}
    } else if (this.session.seat?.sport === 'tennis') {
      this.tennisAim.push(corrected);
      this.swing.push(toLegacyMotionSample(corrected));
      for (const stroke of this.swing.analyze()) {
        if (stroke.label === 'Unknown' || !(stroke.complete || stroke.early || stroke.fast)) continue;
        this.diagnostics.count('swing.recognized');
        if (Number.isFinite(stroke.detectionDelayMs)) this.diagnostics.observe('swing.recognitionMs',stroke.detectionDelayMs);
        this.onSwing({type:'swing', label:stroke.label, hand:this.hand, ...this.tennisAim.capture(stroke.startMs),
          power:Math.min(1, tennisPower(stroke.peakRotation, null, stroke.label) * this.sensitivity)});
      }
    } else
    if (time - this.lastUi > 100) {
      this.lastUi = time;
      this.onStatus({ state: 'ready', aim: this.aim, delivery:this.delivery.phase,
        captureAgeMs:this.captureAgeMs, maxCaptureAgeMs:this.maxCaptureAgeMs, staleSamples:this.staleSamples,
        achievedHz: this.samples / Math.max(.001, (time - this.started) / 1000), largestGapMs: this.largestGap });
    }
  }

  resetSwing() { this.swing = this.strokeMode === 'auto'
    ? createSwingStream(this.hand, {fast:true, suppressReturns:true}) : createSimpleSwingStream(this.strokeMode); }
  updatePreferences({hand = this.hand, sensitivity = this.sensitivity, strokeMode = this.strokeMode}) {
    if (hand === this.hand && sensitivity === this.sensitivity && strokeMode === this.strokeMode) return;
    this.hand = hand; this.sensitivity = sensitivity; this.strokeMode = strokeMode;

    this.tennisAim = createTennisAim({sensitivity});
    this.resetInput();
  }
  resetInput() { this.delivery.suspend();  this.tennisAim.reset();  this.resetSwing(); this.aim = 0; this.filter.reset(0);   }
  allowNewDelivery() { this.delivery = createBowlingDeliveryGate(); }
  recenter() { this.resetInput(); this.automatic.reset(); }
  stop() {
    this.attempt++;
    this.active = false;
    this.delivery.suspend();
    this.deviceSubscription?.remove(); this.deviceSubscription = null;
    this.accelerometerSubscription?.remove(); this.accelerometerSubscription = null;
    this.gyroSubscription?.remove(); this.gyroSubscription = null;
    clearInterval(this.noDataTimer);
    this.device = null;
    this.deviceReceived = null;
    this.deviceClock.reset();
    this.accelerometerClock.reset();
    this.gyroClock.reset();
    this.rawAcceleration = null;
    this.accelerometerReceived = null;
    this.readyNotified = false;
    this.wasPlaying = false;
    this.controlsSuspended = false;
    this.controlsQuietSince = null;
    this.automatic.reset();

    this.tennisAim.reset();

    this.resetSwing();
  }
}
