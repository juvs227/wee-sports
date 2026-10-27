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
function send(label) {
  const sent = connection.sendSwing(label, element('hand').value);
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


function controls() {
  element('enable').disabled = enabled;
  element('calibrate').disabled = !enabled || recording || calibrating;
  element('record').disabled = !enabled || !bias || recording || calibrating;
  element('stop').disabled = !recording;
  element('hand').disabled = recording || calibrating;
  element('response').disabled = recording;
  element('suppress-returns').disabled = recording;
}
function analyze(final = false) {
  for (const swing of stream?.analyze(final) ?? []) {
    element('latest').textContent = `${swing.label}${swing.early ? ' · early' : ''}`;
    element('timing').textContent = swing.early
      ? `Prediction ${Math.round(swing.detectionDelayMs)} ms after motion threshold; excludes network and rendering.`
      : 'Stroke classified after completion.';
    if ((swing.complete || swing.early) && swing.label !== 'Unknown') send(swing.label);
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
    const permission = typeof DeviceMotionEvent.requestPermission === 'function'
      ? await DeviceMotionEvent.requestPermission() : 'granted';
    if (permission !== 'granted') throw new Error('Motion access denied.');
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
