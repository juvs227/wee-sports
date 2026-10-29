import { aimAtTime, AIM_MAX_AGE_MS } from './phoneAim.js';
import { createSwingStream } from './swingStream.js';
import { connectSwings } from '../network/swingConnection.js';

const element = id => document.getElementById(id);
const room = new URLSearchParams(location.search).get('room');
if (!/^[a-zA-Z0-9-]{6,40}$/.test(room ?? '')) throw new Error('Open the controller link from the game to join its room.');
element('room').textContent = `Room: ${room}`;
const connection = connectSwings({ room, role: 'phone',
  onStatus: text => { element('connection').textContent = text; },
  onAck: event => { element('delivery').textContent = event.receivers
    ? 'Delivered to game.' : 'No game connected in this room. Open the game first.'; },
});
function send(label, peakTimeMs, peakRotation) {
  const time = peakTimeMs === undefined ? performance.now() : started + peakTimeMs;
  const aim = element('angle-aim').checked ? aimAtTime(orientationHistory, neutralAim, time, element('invert-aim').checked) : null;
  const sent = connection.sendSwing(label, element('hand').value, aim?.aimX, aim?.aimDepth, Number.isFinite(peakRotation) ? Math.max(0, Math.min(1, (peakRotation - 280) / 1120)) : undefined);
  element('shot-aim').textContent = aim
    ? `Last swing: ${aim.tiltDegrees.toFixed(1)}° tilt · aim ${Math.round(aim.aimX * 100)}% · depth ${Math.round((aim.aimDepth ?? 0) * 100)}% (left − / right +)`
    : 'Last swing: standard placement (angle aiming off or no fresh calibrated angle).';
  if (Number.isFinite(peakRotation)) element('shot-aim').textContent += ` · power ${Math.round(Math.max(0, Math.min(1, (peakRotation - 280) / 1120)) * 100)}% (${Math.round(peakRotation)}°/s)`;
  element('delivery').textContent = sent ? 'Sent; waiting for relay…' : 'Disconnected: swing was not sent. Try again after reconnecting.';
}
element('forehand').onclick = () => send('Forehand');
element('backhand').onclick = () => send('Backhand');

let enabled = false;
let bias = null;
let calibrating = false;
let calibrationSamples = [];
let stream = null;
let recording = false;
let started = 0;
let lastReading = 0;
let calibrationStarted = 0;
let neutralAim = null;
const orientationHistory = [];
let orientationStatus = 'Enable motion to request orientation access.';

function orientation(event) {
  if (!Number.isFinite(event.gamma)) return;
  const timeMs = performance.now();
  orientationHistory.push({ gamma: event.gamma, beta: event.beta, timeMs,
    screenAngle: window.screen?.orientation?.angle ?? window.orientation ?? 0 });
  while (orientationHistory.length > 400 || orientationHistory[0].timeMs < timeMs - 3000) orientationHistory.shift();
}
function updateAimView() {
  const now = performance.now();
  const latest = orientationHistory.at(-1);
  element('neutral-aim').disabled = recording || !latest || now - latest.timeMs > AIM_MAX_AGE_MS;
  const aim = aimAtTime(orientationHistory, neutralAim, now, element('invert-aim').checked);
  element('aim-status').textContent = !element('angle-aim').checked ? 'Angle aiming off.'
    : aim ? `Live aim: ${Math.round(aim.aimX * 100)}% · relative tilt ${aim.tiltDegrees.toFixed(1)}°`
    : neutralAim ? 'Angle is stale or screen orientation changed. Standard placement will be used; reset ready pose if needed.'
    : `${orientationStatus} Hold the phone in your ready pose, then tap Set neutral aim.`;
}
element('neutral-aim').onclick = () => {
  const latest = orientationHistory.at(-1);
  if (!latest || performance.now() - latest.timeMs > AIM_MAX_AGE_MS) return;
  neutralAim = { ...latest };
  updateAimView();
};


function controls() {
  element('enable').disabled = enabled;
  element('calibrate').disabled = !enabled || recording || calibrating;
  element('record').disabled = !enabled || !bias || recording || calibrating;
  element('stop').disabled = !recording;
  element('hand').disabled = recording || calibrating;
  element('response').disabled = recording;
  element('suppress-returns').disabled = recording;
  element('angle-aim').disabled = recording;
  element('invert-aim').disabled = recording;
  updateAimView();
}
function analyze(final = false) {
  for (const swing of stream?.analyze(final) ?? []) {
    element('latest').textContent = `${swing.label}${swing.early ? ' · early' : ''}`;
    element('timing').textContent = swing.early
      ? `Prediction ${Math.round(swing.detectionDelayMs)} ms after motion threshold; excludes network and rendering.`
      : 'Stroke classified after completion.';
    if ((swing.complete || swing.early) && swing.label !== 'Unknown') send(swing.label, swing.peakTimeMs, swing.peakRotation);
  }
  element('detector-state').textContent = !recording ? 'Detector idle' : stream?.phase === 'recovering'
    ? 'Recovering · return to rest before the next stroke' : 'Ready for a swing';
}
function stop(message = 'Recording stopped. Ready for another session.') {
  if (!recording) return;
  recording = false;
  analyze(true);
  element('motion').textContent = message;
  controls();
}
function motion(event) {
  const rate = event.rotationRate;
  const axes = ['alpha', 'beta', 'gamma'];
  if (!rate || !axes.every(axis => Number.isFinite(rate[axis]))) return;
  lastReading = performance.now();
  if (calibrating && calibrationSamples.length < 1000) calibrationSamples.push(Object.fromEntries(axes.map(axis => [axis, rate[axis]])));
  if (!recording) return;
  const timeMs = performance.now() - started;
  stream.push({ timeMs, rotationAlpha: rate.alpha - bias.alpha,
    rotationBeta: rate.beta - bias.beta, rotationGamma: rate.gamma - bias.gamma });
  if (element('response').value === 'early') analyze();
}
element('enable').onclick = async () => {
  try {
    if (!window.isSecureContext || !window.DeviceMotionEvent) throw new Error('Use the HTTPS tunnel on your phone.');
    // Start both requests synchronously inside the tap for iOS user activation.
    const motionPermission = typeof DeviceMotionEvent.requestPermission === 'function'
      ? DeviceMotionEvent.requestPermission() : Promise.resolve('granted');
    const orientationPermission = !window.DeviceOrientationEvent ? Promise.resolve('unavailable')
      : typeof DeviceOrientationEvent.requestPermission === 'function'
        ? DeviceOrientationEvent.requestPermission() : Promise.resolve('granted');
    const [motionResult, angleResult] = await Promise.allSettled([motionPermission, orientationPermission]);
    if (motionResult.status !== 'fulfilled' || motionResult.value !== 'granted') throw new Error('Motion access denied.');
    orientationStatus = angleResult.status === 'fulfilled' && angleResult.value === 'granted'
      ? 'Orientation enabled; waiting for a fresh reading.' : 'Orientation unavailable/denied. Standard placement still works.';
    window.addEventListener('deviceorientation', orientation);
    window.addEventListener('devicemotion', motion);
    enabled = true;
    element('motion').textContent = 'Motion enabled. Set phone down, then calibrate.';
    controls();
  } catch (error) { element('motion').textContent = error.message; }
};
element('calibrate').onclick = () => {
  calibrating = true;
  calibrationStarted = performance.now();
  calibrationSamples = [];
  bias = null;
  element('motion').textContent = 'Keep still for two seconds…';
  controls();
};
element('record').onclick = () => {
  if (performance.now() - lastReading > 1500 || !lastReading) {
    element('motion').textContent = 'No recent gyro readings. Keep the page visible and try again.';
    return;
  }
  stream = createSwingStream(element('hand').value, {
    early: element('response').value === 'early',
    suppressReturns: element('suppress-returns').checked,
  });
  started = performance.now();
  recording = true;
  element('latest').textContent = 'Listening…';
  element('motion').textContent = 'Listening continuously. Swing now; tap Stop when finished.';
  controls();
};
element('stop').onclick = () => stop();
setInterval(() => {
  updateAimView();
  if (calibrating && performance.now() - calibrationStarted >= 2000) {
    calibrating = false;
    const axes = ['alpha', 'beta', 'gamma'];
    if (calibrationSamples.length >= 10 && performance.now() - lastReading < 500) {
      const means = Object.fromEntries(axes.map(axis => [axis,
        calibrationSamples.reduce((sum, sample) => sum + sample[axis], 0) / calibrationSamples.length]));
      const variation = Math.sqrt(calibrationSamples.reduce((sum, sample) => sum + axes.reduce((v, axis) => v + (sample[axis] - means[axis]) ** 2, 0), 0) / calibrationSamples.length);
      if (Math.hypot(...Object.values(means)) <= 5 && variation <= 3) bias = means;
    }
    element('motion').textContent = bias ? 'Calibrated. Pick up the phone and record.' : 'Calibration failed: keep still with the page visible and retry.';
    controls();
  }
  if (!recording) return;
  if (performance.now() - lastReading > 1500) {
    stop('Sensor readings stopped. Keep the page visible, then tap Start swings.');
  } else analyze();
}, 30);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) return;
  stop('Stopped because the page became hidden.');
  if (calibrating) { calibrating = false; bias = null; controls(); }
});
