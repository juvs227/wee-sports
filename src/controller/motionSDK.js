/**
 * Motion SDK — phone sensor pipeline for motion-controlled games.
 *
 * Owns: sensor ingestion, bias calibration, screen orientation.
 * Does not own: swing detection, game logic, networking.
 *
 * Usage:
 *   const sdk = createMotionSDK({ detector, onEmit, onReady });
 *   await sdk.start();   // requests permission and begins streaming
 *   sdk.pause();         // stops forwarding samples to the detector
 *   sdk.resume();
 *   sdk.stop();          // tears down sensors
 *
 * The detector receives one enriched sample per devicemotion event:
 *   { timeMs, rotationAlpha, rotationBeta, rotationGamma,  ← degrees/s
 *     acceleration,                                         ← {x,y,z} m/s²
 *     orientation: { quaternion, normal } | null }          ← screen facing
 *
 * When the detector calls emit(struct), the SDK calls onEmit(struct).
 * The struct shape is entirely game-defined.
 */

import {createWebMotionAdapter} from './webMotionAdapter.js';
import {createAutomaticMotionSetup, toLegacyMotionSample} from '../../shared/motion.js';
import {createOrientationSource} from './orientationSource.js';

export function createMotionSDK({
  detector: initialDetector,
  onEmit = () => {},
  onReady = () => {},
  onState = () => {},
  onSample = () => {},
  target = globalThis.window,
} = {}) {
  let paused = false;
  let latestOrientation = null;
  let motionSetup = createAutomaticMotionSetup({readyGapSeconds: 1.5});
  let detector = initialDetector;

  const orientation = createOrientationSource({
    onReading(quaternion, normal) {
      latestOrientation = {quaternion: [...quaternion], normal: [...normal]};
    },
    target,
  });

  const emit = struct => onEmit(struct);

  const adapter = createWebMotionAdapter({
    target,
    onSample(rawSample) {
      const result = motionSetup.push(rawSample, {safeBoundary: paused});
      if (!result.ready) return;
      if (result.justReady) onReady();
      if (paused) return;

      const legacy = toLegacyMotionSample(result.sample, {timeOriginSeconds: 0});
      if (!legacy) return;

      // Enriched sample: legacy fields for existing detectors + canonical fields
      // for aim tracking + orientation from the sensor fusion.
      const sample = {
        timeSeconds: result.sample.timeSeconds,
        angularVelocity: result.sample.angularVelocity,
        acceleration: result.sample.acceleration,
        gravity: result.sample.gravity,
        timeMs: legacy.timeMs,
        rotationAlpha: legacy.rotationAlpha,
        rotationBeta: legacy.rotationBeta,
        rotationGamma: legacy.rotationGamma,
        orientation: latestOrientation,
      };

      detector?.push(sample, emit);
      onSample(sample);
    },
    onReset() {
      latestOrientation = null;
    },
    onState,
  });

  return {
    async start(options = {}) {
      await adapter.start(options);
      orientation.start();
    },
    stop() {
      detector?.flush?.(emit);
      adapter.stop();
      orientation.stop();
      latestOrientation = null;
    },
    pause() {
      paused = true;
    },
    resume() {
      paused = false;
    },
    setDetector(d) {
      detector = d;
    },
    dispose() {
      adapter.dispose();
      orientation.stop();
    },
  };
}
