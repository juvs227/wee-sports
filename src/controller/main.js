import { createSwingStream } from './swingStream.js';
import { connectSwings } from '../network/swingConnection.js';
import { calibrationBias } from './calibration.js';
import '../../client/src/styles/tokens.css';
import '../play.css';

if (window.parent !== window) {
  new ResizeObserver(entries => window.parent.postMessage({ type: 'wee:controller-height',
    height: Math.ceil(entries[0].target.getBoundingClientRect().height) + 2 }, location.origin))
    .observe(document.querySelector('main'));
}

const element = id => document.getElementById(id);
let lobbyPaused = window.parent !== window;
const room = new URLSearchParams(location.search).get('room');
if (!/^[a-zA-Z0-9-]{6,40}$/.test(room ?? '')) throw new Error('Open the controller link from the game to join its room.');
const lobbyCode = new URLSearchParams(location.search).get('lobby');
const player = new URLSearchParams(location.search).get('player') === '2' ? 2 : 1;
element('room').textContent = lobbyCode && window.parent !== window ? `Lobby ${lobbyCode} · P${player} · ${player === 1 ? 'Blue' : 'Red'}` : `Room: ${room}`;
if (lobbyCode && window.parent !== window) element('connection-help').textContent = 'These buttons control the tennis game on your TV. No second room to join.';
const connection = connectSwings({ room, role: 'phone',
  onStatus: text => { element('connection').textContent = text; },
  onAck: event => { element('delivery').textContent = event.ok === false
    ? (event.error === 'game-loading' ? 'Tennis is still loading. Try again when it appears on the TV.' : 'Game paused or disconnected. Try again after reconnecting.')
    : event.receivers
    ? 'Delivered to game.' : 'No game connected in this room. Open the game first.'; },
});
function send(label) {
  if (lobbyPaused) { element('delivery').textContent = 'Paused — waiting for everyone to reconnect.'; return; }
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
let buttonMode = false;
let lastSetup;
let wasConnected = false;
let gameActive = window.parent === window;

function publishSetup() {
  const setup = buttonMode ? 'buttons' : bias ? 'motion' : null;
  element('setup-status').textContent = setup === 'motion' ? 'Calibrated ✓' : setup === 'buttons' ? 'Button controls selected ✓' : 'Set up your controller';
  if (window.parent !== window && setup !== lastSetup) {
    lastSetup = setup;
    window.parent.postMessage({ type: 'wee:controller-setup', setup }, location.origin);
  }
}


function controls() {
  element('setup-next').textContent = gameActive ? 'Finishing setup resumes the match. Then start swinging or use the buttons below.' : 'Once set up, press Ready above and wait for Play on the TV.';
  element('enable').disabled = enabled;
  element('calibrate').disabled = !enabled || recording || calibrating;
  element('record').disabled = lobbyPaused || !enabled || !bias || recording || calibrating;
  element('stop').disabled = !recording;
  element('hand').disabled = recording || calibrating;
  element('response').disabled = recording;
  element('suppress-returns').disabled = recording;
  element('forehand').disabled = lobbyPaused;
  element('backhand').disabled = lobbyPaused;
  publishSetup();
}
window.addEventListener('message', event => {
  if (event.source !== window.parent || event.origin !== location.origin) return;
  if (event.data?.type === 'wee:setup-ack') {
    if (!event.data.result?.ok) element('setup-status').textContent = 'Setup could not be saved. Reconnect or select your controls again.';
    return;
  }
  if (event.data?.type !== 'wee:lobby-state' || typeof event.data.paused !== 'boolean') return;
  if (event.data.connected && !wasConnected) lastSetup = undefined;
  wasConnected = event.data.connected;
  gameActive = event.data.playing === true;
  lobbyPaused = event.data.paused;
  if (lobbyPaused) stop('Paused. When everyone reconnects, tap Start swings to continue.');
  controls();
});
controls();
element('use-buttons').onclick = () => {
  stop(); buttonMode = true; lastSetup = undefined;
  element('manual-controls').open = true;
  element('motion').textContent = 'Use Forehand and Backhand below once the match starts.';
  controls();
};
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
  buttonMode = false;
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
    bias = calibrationBias(calibrationSamples, performance.now() - lastReading);
    element('motion').textContent = bias ? (gameActive ? 'Calibrated. Tap Start swings to play.' : 'Calibrated. Press Ready above; when the match starts, tap Start swings.') : 'Calibration failed: keep still with the page visible and retry, or use button controls.';
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
