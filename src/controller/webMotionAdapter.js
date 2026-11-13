import {normalizeWebMotion, orientationFromWebEvent, toLegacyMotionSample} from '../../shared/motion.js';

/** Use the canonical path without changing the old controller's permission,
 * calibration or degree-based recognizer behavior. */
export function readLegacyWebMotion(event, {timeMs, timeOriginMs = 0, sequence = 0, bias, screenAngle = 0} = {}) {
  const sample = normalizeWebMotion(event, {timeSeconds: timeMs / 1000, sequence, screenAngle});
  if (!sample?.angularVelocity) return null;
  const legacy = toLegacyMotionSample(sample, {timeOriginSeconds: timeOriginMs / 1000, bias});
  return {sample, legacy, rate: {alpha: event.rotationRate.alpha, beta: event.rotationRate.beta, gamma: event.rotationRate.gamma}};
}

/** Portable adapter with explicit gesture permission and lifecycle ownership.
 * Constructing it never prompts, installs listeners or imports DOM globals.
 */
export function createWebMotionAdapter({target = globalThis.window, document = target?.document,
  clock = () => globalThis.performance.now() / 1000, onSample = () => {}, onState = () => {},
  onReset = () => {}, calibrationRevision = () => 0} = {}) {
  let active = false, disposed = false, pageActive = true, orientation, orientationAt = null, lastAngle = null, sequence = 0, attempt = 0;
  let wasHidden = Boolean(document?.hidden);
  const screenAngle = () => Number.isFinite(target?.screen?.orientation?.angle) ? target.screen.orientation.angle
    : Number.isFinite(target?.orientation) ? target.orientation : 0;
  const reset = reason => {orientation = undefined; orientationAt = null; lastAngle = null; onReset(reason);};
  const motion = event => {
    if (!active || !pageActive || document?.hidden) return;
    const angle = screenAngle();
    if (lastAngle !== null && angle !== lastAngle) reset('screen-rotation');
    lastAngle = angle;
    const timeSeconds = clock();
    const currentOrientation = orientationAt !== null && timeSeconds - orientationAt >= 0 && timeSeconds - orientationAt <= .25 ? orientation : undefined;
    const sample = normalizeWebMotion(event, {timeSeconds, sequence: sequence++, screenAngle: angle,
      calibrationRevision: calibrationRevision(), orientation: currentOrientation, orientationTimeSeconds: currentOrientation ? orientationAt : undefined});
    if (sample) onSample(sample);
  };
  const rotation = event => {if (active && pageActive && !document?.hidden) {orientation = orientationFromWebEvent(event); orientationAt = clock();}};
  const visibility = () => {
    const hidden = Boolean(document?.hidden);
    if (hidden === wasHidden) return;
    wasHidden = hidden;
    reset(hidden ? 'hidden' : 'visible'); onState(hidden ? 'suspended' : active ? 'listening' : 'stopped');
  };
  const hide = () => {if (pageActive) {pageActive = false; reset('pagehide'); onState('suspended');}};
  const show = () => {if (!pageActive) {pageActive = true; reset('pageshow'); onState(active ? 'listening' : 'stopped');}};
  const stop = () => {
    attempt++;
    if (!active) return;
    active = false;
    target?.removeEventListener('devicemotion', motion);
    target?.removeEventListener('deviceorientation', rotation);
    target?.removeEventListener('pagehide', hide);
    target?.removeEventListener('pageshow', show);
    document?.removeEventListener('visibilitychange', visibility);
    reset('stopped'); onState('stopped');
  };
  return {
    async start({requestPermission = true} = {}) {
      if (disposed) throw new Error('Motion adapter is disposed');
      if (active) return;
      const intent = ++attempt;
      if (!target?.isSecureContext) throw new Error('Motion needs HTTPS. Touch controls remain available.');
      const MotionEvent = target.DeviceMotionEvent;
      if (!MotionEvent) throw new Error('Motion sensors are unavailable. Use touch controls.');
      const policy = document?.permissionsPolicy ?? document?.featurePolicy;
      if (policy?.allowsFeature && ['accelerometer', 'gyroscope'].some(name => !policy.allowsFeature(name))) {
        throw new Error('This page is not permitted to use motion sensors. Use touch controls.');
      }
      if (requestPermission && typeof MotionEvent.requestPermission === 'function') {
        // Invoke directly on the initiating tap. Do not await unrelated work first.
        const motionPermission = MotionEvent.requestPermission();
        const OrientationEvent = target.DeviceOrientationEvent;
        const orientationPermission = typeof OrientationEvent?.requestPermission === 'function'
          ? OrientationEvent.requestPermission().catch(() => 'denied') : Promise.resolve('granted');
        const [permission] = await Promise.all([motionPermission, orientationPermission]);
        if (permission !== 'granted') throw new Error('Motion permission was denied. Touch controls remain available.');
      }
      if (disposed || attempt !== intent) return;
      active = true;
      // A pagehide handler may stop/remove pageshow listeners before BFCache
      // restore. Starting again belongs to the current page lifecycle.
      pageActive = true;
      wasHidden = Boolean(document?.hidden);
      target.addEventListener('devicemotion', motion);
      target.addEventListener('deviceorientation', rotation);
      target.addEventListener('pagehide', hide);
      target.addEventListener('pageshow', show);
      document?.addEventListener('visibilitychange', visibility);
      onState(document?.hidden ? 'suspended' : 'listening');
    },
    stop,
    dispose() {stop(); disposed = true;},
    get active() {return active;},
  };
}
