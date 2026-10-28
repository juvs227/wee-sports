import { createSwingStream } from './swingStream.js';
import { createSimpleSwingStream, createBowlingMotionDetector, bowlingTiltAim } from './motionGestures.js';
import { connectSwings } from '../network/swingConnection.js';
import { createInputId } from '../network/inputId.js';
import { createCalibrationSession } from './calibration.js';
import '../../client/src/styles/tokens.css';
import '../play.css';
import './controller.css';

const element = id => document.getElementById(id);
const embedded = window.parent !== window;
const query = new URLSearchParams(location.search);
const bowling = query.get('sport') === 'bowling';
const room = query.get('room');
if (!/^[a-zA-Z0-9-]{6,40}$/.test(room ?? '')) throw new Error('Open the controller link from the game to join its room.');
const player = Math.max(1, Math.min(4, Number(query.get('player')) || 1));
const post = data => { if (embedded) window.parent.postMessage(data, location.origin); };
const lobbyCode = query.get('lobby');
element('room').textContent = lobbyCode && embedded ? `Lobby ${lobbyCode} · P${player}` : `Room: ${room}`;
if (embedded) element('connection-help').textContent = 'Your controller is connected through the homepage lobby.';
if (bowling) {
  element('controller-title').textContent = 'Your bowling ball';
  element('tennis-settings').hidden = true;
}
if (embedded && window.ResizeObserver) {
  new ResizeObserver(entries => post({ type: 'wee:controller-height',
    height: Math.ceil(entries[0].target.getBoundingClientRect().height) + 2 }))
    .observe(document.querySelector('main'));
}

let connected = !embedded;
let lobbyPaused = embedded;
let gameActive = !embedded;
let enabled = false;
let permissionPending = false;
let permissionAt = 0;
let bias = null;
let calibration = null;
let stream = null;
let recording = false;
let motionWanted = false;
let started = 0;
let lastReading = null;
let latestRate = null;
let eventsSeen = 0;
let validReadings = 0;
let buttonMode = false;
let lastSetup;
let wasConnected = false;
let canRoll = false;
let currentPlayer = null;
let bowlingPhase = 'waiting';
let bowlingDetector = null;
let armedAt = null;
let pendingRoll = null;
let sensorUpdatedAt = 0;
let settingsOpen = false;
let playNotice = '';
let setupError = '';
let feedbackUntil = 0;
let lastTiltReading = null;
let liveAim = 0;
let bowlingReadout = null;

function recentReadings() { return lastReading !== null && performance.now() - lastReading < 1500; }
function publishSetup() {
  const setup = buttonMode ? 'buttons' : bias ? 'motion' : null;
  element('setup-status').textContent = setup === 'motion' ? 'Calibrated ✓' : setup === 'buttons' ? 'Button controls selected ✓' : 'Set up your controller';
  if (embedded && setup !== lastSetup) {
    lastSetup = setup;
    post({ type: 'wee:controller-setup', setup });
  }
}
function turnReady() { return bowling && gameActive && connected && !lobbyPaused && canRoll && currentPlayer === player && !pendingRoll; }
function cancelArmedRoll() { bowlingDetector = null; armedAt = null; }
// One calm play screen; setup remains mounted so switching views preserves
// calibration, sensor permission and the lobby connection.
function renderPlayState() {
  const tiltAvailable = lastTiltReading !== null && performance.now() - lastTiltReading < 500;
  const setup = buttonMode || Boolean(bias);
  element('setup-panel').hidden = setup && !settingsOpen;
  element('controller-options').hidden = setup && !settingsOpen;
  element('play-panel').hidden = !setup || settingsOpen;
  element('controller-header').hidden = embedded && setup && !settingsOpen;
  element('toggle-settings').hidden = !setup;
  element('toggle-settings').disabled = Boolean(calibration) || permissionPending;
  element('toggle-settings').textContent = settingsOpen ? 'Back to controller' : 'Controller settings';
  element('toggle-settings').ariaExpanded = String(settingsOpen);
  element('stop').hidden = !setup || buttonMode || !gameActive || !settingsOpen;
  let state = 'ready';
  let status = buttonMode ? 'Buttons ready' : 'Calibrated';
  let title = 'You’re ready';
  let help = 'Press Ready above, then watch the TV.';
  if (!connected) {
    state = 'paused'; status = 'Connection lost'; title = 'Reconnecting…';
    help = 'Keep this page open. Your controller will reconnect automatically.';
  } else if (gameActive && lobbyPaused) {
    state = 'paused'; status = 'Match paused'; title = 'Hang tight';
    help = 'Waiting for everyone to reconnect and finish setup.';
  } else if (setupError) {
    state = 'paused'; status = 'Setup needed'; title = 'Setup not saved';
    help = 'Open Controller settings and calibrate again, or reconnect.';
  } else if (gameActive && bowling && (bowlingPhase === 'complete' || bowlingPhase === 'finished')) {
    state = 'finished'; status = 'Match complete'; title = 'Nice bowling!'; help = 'See the final scores on the TV.';
  } else if (gameActive && !buttonMode && !recentReadings()) {
    state = 'paused'; status = 'Motion interrupted'; title = 'Waiting for sensors';
    help = 'Keep this screen open. Motion resumes when readings return.';
  } else if (gameActive && !buttonMode && !recording) {
    state = 'paused'; status = 'Motion paused'; title = 'Ready when you are';
    help = 'Tap Resume motion to keep playing.';
  } else if (gameActive) {
    state = 'playing'; status = buttonMode ? 'Button controls' : 'Motion on';
    title = buttonMode ? 'Tap to swing' : 'Swing to play';
    help = 'Watch the TV.';
    if (buttonMode) help = 'Watch the TV and choose your shot.';
    if (bowling) {
      if (pendingRoll || (currentPlayer === player && !canRoll)) {
        state = 'waiting'; title = 'Watch the lane'; help = 'Your ball is rolling. Let the pins settle.';
      } else if (turnReady()) {
        title = bowlingDetector ? 'Swing forward' : 'Your turn';
        help = bowlingDetector ? 'Screen up, top toward the TV. Swing underhand and gently turn your wrist for curve. Keep holding your phone.'
          : buttonMode ? 'Choose your line, then tap Roll ball.' : 'Hold the phone screen up, top toward the TV. Aim, arm, then swing. Your motion sets power and curve.';
      } else {
        state = 'waiting'; title = currentPlayer ? `P${currentPlayer} is bowling` : 'Waiting for the lane';
        help = 'Watch the TV. Your turn will appear here.';
      }
    }
  }
  // Avoid repeatedly replacing live-region content on the sensor timer.
  const notice = setupError || playNotice;
  for (const [id, text] of [['play-status', status], ['play-title', title], ['play-help', help], ['play-notice', notice]]) {
    if (element(id).textContent !== text) element(id).textContent = text;
  }
  element('play-panel').dataset.state = state;
  element('play-notice').hidden = !notice || (!setupError && (!gameActive || lobbyPaused || !connected));
  element('record').hidden = !setup || buttonMode || !gameActive || lobbyPaused || !connected || recording || settingsOpen || state === 'finished';
  element('record').disabled = !gameActive || lobbyPaused || !connected || !enabled || !bias || recording || Boolean(calibration) || !recentReadings();
  element('bowling-controls').hidden = !bowling || state !== 'playing' || !turnReady();
  element('shot-adjustments').hidden = Boolean(bowlingDetector);
  element('arm-roll').hidden = buttonMode || Boolean(bowlingDetector);
  element('cancel-roll').hidden = !bowlingDetector;
  element('curve-buttons').hidden = !buttonMode;
  element('aim').hidden = !buttonMode && tiltAvailable;
  element('aim-label').textContent = !buttonMode && tiltAvailable ? 'Tilt to aim' : 'Aim';
  element('tilt-help').hidden = buttonMode || !tiltAvailable;
  element('bowling-readout').hidden = !bowling || buttonMode || !gameActive || state === 'paused' || !(bowlingDetector || (bowlingReadout && performance.now() < feedbackUntil));
  element('bowling-buttons').hidden = !buttonMode;
  element('manual-controls').hidden = bowling || !buttonMode || state !== 'playing';
  element('latest').hidden = !gameActive || state === 'paused' || performance.now() >= feedbackUntil;
}
function controls() {
  element('setup-next').textContent = settingsOpen ? 'Return to the controller when you’re ready.' : gameActive
    ? 'Motion starts automatically once setup is complete and everyone is connected.'
    : 'After calibration, press Ready above.';
  element('enable').disabled = permissionPending || (enabled && recentReadings());
  element('enable').textContent = enabled ? 'Retry motion access' : 'Enable motion';
  element('calibrate').disabled = permissionPending || Boolean(calibration);
  element('calibrate').textContent = calibration ? 'Calibrating…' : bias ? 'Calibrate again' : 'Calibrate';
  element('stop').disabled = !gameActive || !motionWanted;
  for (const id of ['hand', 'response', 'stroke-mode', 'suppress-returns']) element(id).disabled = recording || Boolean(calibration);
  for (const id of ['forehand', 'backhand']) element(id).disabled = !gameActive || lobbyPaused || !connected;
  element('roll').disabled = !turnReady() || (!buttonMode && !bias);
  element('arm-roll').disabled = !turnReady() || !recording || Boolean(bowlingDetector);
  element('arm-roll').textContent = bowlingDetector ? 'Armed · swing forward' : 'Arm motion roll';
  publishSetup();
  renderPlayState();
}
function deliveryResult(event, kind = 'swing') {
  element('delivery').textContent = event.ok === false
    ? event.error === 'game-loading' ? 'The game is loading. Try again when it appears on the TV.'
      : event.error === 'not-your-turn' || event.error === 'roll-rejected' ? 'Wait until the TV and your controller show your turn.'
      : `The ${kind} was not accepted. Wait for the game to reconnect, then try again.`
    : event.receivers ? 'Delivered to game.' : 'No game connected. Check the TV.';
  playNotice = event.ok === false || !event.receivers ? element('delivery').textContent : '';
  renderPlayState();
}
const connection = connectSwings({ room, role: 'phone',
  onStatus: text => {
    element('connection').textContent = text;
    if (!embedded) {
      connected = text === 'Connected';
      if (!connected) stop();
      controls();
    }
  },
  onAck: event => deliveryResult(event),
});
function send(label) {
  if (bowling || lobbyPaused || !gameActive || !connected || document.hidden) return;
  const sent = connection.sendSwing(label, element('hand').value);
  element('delivery').textContent = sent ? 'Sending stroke…' : 'Disconnected: the stroke was not sent.';
  playNotice = sent ? '' : element('delivery').textContent;
  renderPlayState();
}
element('forehand').onclick = () => send('Forehand');
element('backhand').onclick = () => send('Backhand');
function roll(power, measuredSpin = null) {
  if (!turnReady() || document.hidden) return;
  cancelArmedRoll();
  const event = { type: 'roll', id: createInputId(), power,
    aim: Number(element('aim').value), spin: measuredSpin ?? Number(element('spin').value) };
  pendingRoll = { id: event.id, at: performance.now() };
  post({ type: 'wee:player-roll', event });
  element('delivery').textContent = 'Sending your roll…';
  element('latest').textContent = measuredSpin === null ? `${Math.round(power * 100)}% power` : 'Roll sent';
  feedbackUntil = performance.now() + 3500;
  playNotice = '';
  controls();
}
element('roll').onclick = () => roll(Number(element('power').value));
element('arm-roll').onclick = () => {
  if (!turnReady() || !recording || !recentReadings()) return;
  bowlingDetector = createBowlingMotionDetector();
  bowlingReadout = { power: 0, spin: 0 };
  showBowlingReadout(bowlingReadout);
  armedAt = performance.now();
  playNotice = '';
  element('motion').textContent = 'Armed. Screen up, swing gently forward underhand and slow down. Keep holding the phone.';
  controls();
  element('cancel-roll').focus?.();
};
element('cancel-roll').onclick = () => {
  cancelArmedRoll();
  bowlingReadout = null;
  controls();
  element('arm-roll').focus?.();
};
function showBowlingReadout(readout) {
  element('motion-power').value = readout.power;
  element('motion-power-value').textContent = `${Math.round(readout.power * 100)}%`;
  element('motion-curve').textContent = Math.abs(readout.spin) < .04 ? 'Straight'
    : `${readout.spin < 0 ? 'Left' : 'Right'} ${Math.round(Math.abs(readout.spin) * 100)}%`;
}
for (const id of ['aim', 'spin', 'power']) {
  element(id).oninput = () => {
    const value = Number(element(id).value);
    element(`${id}-value`).textContent = id === 'power' ? `${Math.round(value * 100)}%`
      : value === 0 ? id === 'aim' ? 'Center' : 'Straight'
      : `${value < 0 ? 'Left' : 'Right'} ${Math.round(Math.abs(value) * 100)}%`;
  };
}
function analyze() {
  if (!recording || bowling) return;
  for (const swing of stream?.analyze() ?? []) {
    element('latest').textContent = swing.label === 'Unknown' ? 'Try a clearer swing' : swing.label;
    feedbackUntil = performance.now() + 1500;
    element('timing').textContent = swing.simple ? 'Simple motion mapping · your selected shot.' : swing.early || swing.fast
      ? `Recognized in ${Math.round(swing.detectionDelayMs)} ms, before network and game response.`
      : 'Stroke classified after completion.';
    if ((swing.complete || swing.early || swing.fast) && swing.label !== 'Unknown') send(swing.label);
  }
}
function stop(message = 'Motion paused. Tap Resume motion when you are ready.', user = false) {
  if (user) motionWanted = false;
  const wasRecording = recording;
  recording = false;
  lastTiltReading = null;
  stream = null; // Never flush an unfinished gesture when stopping or disconnecting.
  cancelArmedRoll();
  if (wasRecording || user) element('motion').textContent = message;
  controls();
}
function startMotion() {
  if (recording || settingsOpen || !motionWanted || !bias || buttonMode || calibration || !enabled || !gameActive || lobbyPaused || !connected || document.hidden || !recentReadings()) return;
  const mode = element('stroke-mode').value;
  stream = bowling ? null : mode === 'auto' ? createSwingStream(element('hand').value, {
    early: element('response').value === 'early', fast: element('response').value === 'fast', suppressReturns: element('suppress-returns').checked,
  }) : createSimpleSwingStream(mode);
  started = performance.now();
  recording = true;
  element('latest').textContent = '';
  playNotice = '';
  element('motion').textContent = bowling ? 'Motion is live. Arm a roll when it is your turn.' : 'Motion is live. Swing to play; use Stop motion to pause your detector.';
  controls();
}
window.addEventListener('message', event => {
  if (!embedded || event.source !== window.parent || event.origin !== location.origin) return;
  const data = event.data;
  if (data?.type === 'wee:setup-ack') {
    setupError = data.result?.ok ? '' : 'Setup could not be saved. Reconnect or select your controls again.';
    if (setupError) element('setup-status').textContent = setupError;
    renderPlayState();
    return;
  }
  if (data?.type === 'wee:bowling-state' && bowling) {
    canRoll = data.canRoll === true;
    currentPlayer = data.currentPlayer;
    bowlingPhase = data.phase;
    if (!canRoll || currentPlayer !== player) cancelArmedRoll();
    controls(); return;
  }
  if (data?.type === 'wee:roll-ack' && bowling) {
    if (!pendingRoll || (data.result?.id && data.result.id !== pendingRoll.id)) return;
    pendingRoll = null;
    deliveryResult(data.result ?? { ok: false }, 'roll');
    controls(); return;
  }
  if (data?.type !== 'wee:lobby-state' || typeof data.paused !== 'boolean') return;
  if (data.connected && !wasConnected) lastSetup = undefined;
  connected = data.connected === true;
  wasConnected = connected;
  gameActive = data.playing === true;
  lobbyPaused = data.paused;
  if (lobbyPaused || !connected || !gameActive) stop('Paused. Motion will resume when the match is ready.');
  startMotion();
  controls();
});

function motion(event) {
  eventsSeen++;
  const rate = event.rotationRate;
  if (!rate || !['alpha', 'beta', 'gamma'].every(axis => Number.isFinite(rate[axis]))) return;
  const now = performance.now();
  validReadings++;
  lastReading = now;
  latestRate = { alpha: rate.alpha, beta: rate.beta, gamma: rate.gamma };
  calibration?.push(rate, now);
  if (!recording) return;
  const sample = { timeMs: now - started, rotationAlpha: rate.alpha - bias.alpha,
    rotationBeta: rate.beta - bias.beta, rotationGamma: rate.gamma - bias.gamma,
    acceleration: event.acceleration };
  if (bowling) {
    if (!bowlingDetector && turnReady()) {
      const tilt = bowlingTiltAim(event.accelerationIncludingGravity, Math.hypot(sample.rotationAlpha, sample.rotationBeta, sample.rotationGamma));
      if (tilt !== null) {
        if (lastTiltReading === null || now - lastTiltReading >= 500) liveAim = Number(element('aim').value);
        lastTiltReading = now;
        liveAim += (tilt - liveAim) * .18;
        element('aim').value = String(Math.round(liveAim * 100) / 100);
        element('aim').oninput();
      }
    }
    const result = bowlingDetector?.push(sample);
    if (bowlingDetector) {
      bowlingReadout = result ?? bowlingDetector.preview;
      showBowlingReadout(bowlingReadout);
    }
    if (result) roll(result.power, result.spin);
  } else { stream.push(sample); if (element('response').value !== 'complete') analyze(); }
}
async function requestMotion() {
  if (!window.isSecureContext) throw new Error('Motion needs HTTPS. The lobby can open over HTTP, but phone sensors cannot. Ask the TV host for the secure HTTPS link, or use buttons.');
  if (!window.DeviceMotionEvent) throw new Error('This browser does not expose phone motion. Open the link in Safari or Chrome on a phone, or use buttons.');
  const policy = document.permissionsPolicy ?? document.featurePolicy;
  if (policy?.allowsFeature && ['accelerometer', 'gyroscope'].some(feature => !policy.allowsFeature(feature))) {
    throw new Error('This page is blocked from using motion sensors by its permissions policy. Open the original game link directly in your phone browser, or use buttons.');
  }
  permissionPending = true;
  controls();
  try {
    // Called directly from the tap handler: iOS requires transient activation.
    const permission = typeof DeviceMotionEvent.requestPermission === 'function'
      ? await DeviceMotionEvent.requestPermission() : 'granted';
    if (permission !== 'granted') throw new Error('Motion access was denied. Allow Motion & Orientation in this site’s browser permissions, then reload and try again. Button controls are available now.');
    window.addEventListener('devicemotion', motion);
    enabled = true;
    permissionAt = performance.now();
    element('motion').textContent = recentReadings() ? 'Sensor readings received. Tap Calibrate and put the phone down.' : 'Permission allowed. Waiting for actual sensor readings…';
  } finally { permissionPending = false; controls(); }
}
function showMotionError(error) {
  element('motion').textContent = error.name === 'NotAllowedError'
    ? 'Motion permission needs a direct tap. Open this page in Safari or Chrome, tap Enable motion and allow access.' : error.message;
  element('sensor-status').dataset.state = 'error';
}
element('enable').onclick = () => requestMotion().catch(showMotionError);
element('calibrate').onclick = async () => {
  stop();
  try {
    // One tap also requests permission; disabled Calibrate used to hide this step.
    if (!enabled || !recentReadings()) await requestMotion();
    buttonMode = false;
    bias = null;
    calibration = createCalibrationSession(performance.now());
    element('calibration-progress').hidden = false;
    element('calibration-progress').value = 0;
    element('motion').textContent = 'Put the phone down. Waiting for it to settle…';
    controls();
  } catch (error) { showMotionError(error); }
};
element('record').onclick = () => { motionWanted = true; startMotion(); };
element('stop').onclick = () => stop(undefined, true);
element('toggle-settings').onclick = () => {
  settingsOpen = !settingsOpen;
  if (settingsOpen) stop('Motion pauses while controller settings are open.');
  else startMotion();
  controls();
};
element('use-buttons').onclick = () => {
  stop(undefined, true);
  calibration = null;
  element('calibration-progress').hidden = true;
  buttonMode = true;
  settingsOpen = false;
  lastSetup = undefined;
  element('bowling-buttons').open = true;
  element('motion').textContent = bowling ? 'Button controls ready. Set aim, curve and power, then Roll ball on your turn.' : 'Button controls ready. Use Forehand and Backhand when the match starts.';
  controls();
};
function sensorStatus(now) {
  if (now - sensorUpdatedAt < 250) return;
  sensorUpdatedAt = now;
  const status = element('sensor-status');
  status.dataset.state = 'ready';
  if (!window.isSecureContext) {
    status.textContent = 'HTTP connection: phone motion is unavailable. Use an HTTPS link or button controls.';
    status.dataset.state = 'error';
  } else if (!window.DeviceMotionEvent) {
    status.textContent = 'No motion API on this device. Button controls are available.';
    status.dataset.state = 'error';
  } else if (recentReadings()) status.textContent = `Gyroscope connected · ${validReadings} readings received`;
  else if (enabled && now - permissionAt > 2500) {
    status.textContent = eventsSeen ? 'Motion events arrived without gyroscope data. Check browser permissions or use buttons.' : 'Permission allowed, but no readings arrived. Keep this page visible and check browser motion permissions.';
    status.dataset.state = 'error';
  } else status.textContent = enabled ? 'Waiting for sensor readings…' : 'Motion requires permission. Tap Calibrate or Enable motion.';
  element('sensor-detail').textContent = `${window.isSecureContext ? 'Secure context' : 'Insecure context'} · ${eventsSeen} events · ${validReadings} valid gyro readings${latestRate ? ` · ${Math.round(Math.hypot(...Object.values(latestRate)))}°/s · last reading ${Math.round(now - lastReading)} ms ago` : ''}`;
  element('detector-state').textContent = !recording ? 'Motion idle' : bowling ? bowlingDetector ? 'Armed for one underhand delivery' : 'Motion live · arm your roll on your turn'
    : stream?.phase === 'recovering' ? 'Return to rest for the next stroke' : 'Motion live · ready for a swing';
  renderPlayState();
}
setInterval(() => {
  const now = performance.now();
  sensorStatus(now);
  if (calibration) {
    const result = calibration.read(now);
    element('calibration-progress').value = result.progress;
    if (result.state === 'done' || result.state === 'failed') {
      bias = result.bias ?? null;
      calibration = null;
      element('calibration-progress').hidden = true;
      if (bias) {
        motionWanted = true;
        settingsOpen = false;
        element('motion').textContent = gameActive ? 'Calibrated. Motion starts when the match is ready.' : 'Calibrated. Press Ready above; motion will start with the match.';
      } else element('motion').textContent = result.reason === 'no-readings' || result.reason === 'stale'
        ? 'Calibration could not get live gyroscope readings. Open Controller help, then retry or use button controls.'
        : 'The phone kept moving. Place it on a stable table and tap Calibrate again.';
      controls();
    } else element('motion').textContent = result.state === 'settling' ? 'Put the phone down. Waiting for it to settle…'
      : result.state === 'moving' ? 'Movement detected. Keep the phone on the table; calibration will continue automatically.'
      : result.state === 'no-readings' || result.state === 'stale' ? 'Waiting for live gyroscope readings…'
      : `Keep still… ${Math.round(result.progress * 100)}%`;
  }
  if (recording && !recentReadings()) stop('Sensor readings paused. Keep the page visible; motion resumes when readings return.');
  if (armedAt !== null && now - armedAt > 6000) {
    cancelArmedRoll(); playNotice = 'Roll timed out. Arm again when you are ready.'; element('motion').textContent = playNotice; controls();
  }
  if (pendingRoll && now - pendingRoll.at > 4000) {
    pendingRoll = null; playNotice = 'No roll confirmation yet. Watch the TV before trying again.'; element('delivery').textContent = playNotice; controls();
  }
  startMotion();
  analyze();
}, 30);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) { startMotion(); return; }
  stop('Motion paused while the page is hidden. Return to this page to continue.');
  if (calibration) {
    calibration = null; bias = null;
    element('calibration-progress').hidden = true;
    element('motion').textContent = 'Calibration stopped because the page was hidden. Keep it visible and try again.';
    controls();
  }
});
controls();
sensorStatus(performance.now() + 250);
