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
let currentRates = null;
let trace = null;
let lastTracedPhase = null;

function traceEvent(event) {
  if (!trace) return;
  trace.events.push({ timeMs: performance.now() - started, ...event });
  if (trace.events.length > 200) trace.events.shift();
}


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
    element('latest').textContent = `${swing.label}${swing.early ? ' · early' : swing.fast ? ' · fast' : ''}`;
    element('reason').textContent = swing.reason;
    traceEvent({ type: 'prediction', ...swing });
    element('timing').textContent = swing.early || swing.fast
      ? `Prediction ${Math.round(swing.detectionDelayMs)} ms after motion threshold; excludes network and rendering.`
      : 'Stroke classified after completion.';
    if ((swing.complete || swing.early || swing.fast) && swing.label !== 'Unknown') send(swing.label);
  }
  element('detector-state').textContent = !recording ? 'Detector idle' : stream?.phase === 'recovering'
    ? 'Recovering · return to rest before the next stroke'
    : stream?.phase === 'waiting-for-rest' ? 'Long movement · hold still to reset detection'
    : stream?.phase === 'tracking' ? 'Tracking motion…' : 'Ready for a swing';
  if (recording && stream?.phase !== lastTracedPhase) {
    lastTracedPhase = stream.phase;
    traceEvent({ type: 'state', phase: lastTracedPhase });
  }
}
function stop(message = 'Recording stopped. Ready for another session.') {
  if (!recording) return;
  recording = false;
  analyze(true);
  traceEvent({ type: 'stopped', message });
  element('motion').textContent = message;
  controls();
}
function motion(event) {
  const rate = event.rotationRate;
  const axes = ['alpha', 'beta', 'gamma'];
  if (!rate || !axes.every(axis => Number.isFinite(rate[axis]))) return;
  lastReading = performance.now();
  currentRates = { alpha: rate.alpha - (bias?.alpha ?? 0), beta: rate.beta - (bias?.beta ?? 0), gamma: rate.gamma - (bias?.gamma ?? 0) };
  if (calibrating && calibrationSamples.length < 1000) calibrationSamples.push(Object.fromEntries(axes.map(axis => [axis, rate[axis]])));
  if (!recording) return;
  const timeMs = performance.now() - started;
  const sample = { timeMs, rotationAlpha: currentRates.alpha,
    rotationBeta: currentRates.beta, rotationGamma: currentRates.gamma };
  trace.samples.push({ ...sample, phase: stream.phase });
  if (trace.samples.length > 3000) trace.samples.shift();
  element('download-trace').disabled = false;
  stream.push(sample);
  if (element('response').value !== 'complete') analyze();
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
    fast: element('response').value === 'fast',
    suppressReturns: element('suppress-returns').checked,
  });
  started = performance.now();
  trace = { version: 1, recordedAt: new Date().toISOString(), hand: element('hand').value,
    response: element('response').value, suppressReturns: element('suppress-returns').checked,
    calibration: { ...bias }, units: { timeMs: 'ms', rotationRates: 'degrees/second, bias corrected' },
    samples: [], events: [] };
  lastTracedPhase = null;
  element('download-trace').disabled = true;
  element('reason').textContent = '';
  recording = true;
  element('latest').textContent = 'Listening…';
  element('motion').textContent = 'Listening continuously. Swing now; tap Stop when finished.';
  controls();
};
element('stop').onclick = () => stop();
element('download-trace').onclick = () => {
  if (!trace?.samples.length) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify(trace, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `swing-diagnostic-${Date.now()}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
setInterval(() => {
  if (currentRates) {
    element('gyro').textContent = performance.now() - lastReading > 1500 ? 'Gyro readings are stale'
      : `Gyro · α ${Math.round(currentRates.alpha)} · β ${Math.round(currentRates.beta)} · γ ${Math.round(currentRates.gamma)} °/s`;
  }
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
