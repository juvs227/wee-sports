import {focusControllerSection} from './focusSection.js';
import { createSwingStream } from './swingStream.js';
import { createSimpleSwingStream, createBowlingDeliveryGate } from './motionGestures.js';
import { createAutomaticMotionSetup, toLegacyMotionSample } from '../../shared/motion.js';
import { createBowlingAimStream, createBowlingAimController } from './bowlingAim.js';
import { readLegacyWebMotion } from './webMotionAdapter.js';
import { createControllerPreferences } from './preferences.js';
import { tennisPower, tennisStrength } from './tennisPower.js';
import { createStrengthRehearsal } from './strengthRehearsal.js';
import { connectSwings } from '../network/swingConnection.js';
import { createInputId } from '../network/inputId.js';
import { createCalibrationSession } from './calibration.js';
import { createCalibrationMemory, createCalibrationResume } from './calibrationMemory.js';
import { createPhoneFeedback, createScreenAwake } from './phoneExperience.js';
import { isTennisState, isStrokeResult } from '../../shared/protocol.js';
import { createTimingStats } from '../network/timingStats.js';
import {createTennisAim} from '../../shared/tennisAim.js';
import {browserDiagnostics} from '../../shared/diagnostics.js';
import '../theme.js';
import '../../client/src/styles/tokens.css';
import '../play.css';
import './controller.css';

const element = id => document.getElementById(id);
// Polling freshness must not rewrite the same controls/live regions each tick.
const setView = (id, property, value) => {
  const target = element(id);
  if (target[property] !== value) target[property] = value;
};
const embedded = window.parent !== window;
const query = new URLSearchParams(location.search);
const motionDiagnostics = browserDiagnostics('phone.tennis');
let bowling = query.get('sport') === 'bowling';
const room = query.get('room');
if (!/^[a-zA-Z0-9-]{6,40}$/.test(room ?? '')) throw new Error('Open the controller link from the game to join its room.');
const player = Math.max(1, Math.min(8, Math.trunc(Number(query.get('player'))) || 1));
const post = data => { if (embedded) window.parent.postMessage(data, location.origin); };
const lobbyCode = query.get('lobby');
element('room').textContent = lobbyCode && embedded ? `Lobby ${lobbyCode} · P${player}` : `Room: ${room}`;
if (embedded) element('connection-help').textContent = 'Your controller is connected through the homepage lobby.';
if (embedded && window.ResizeObserver) {
  new ResizeObserver(entries => post({ type: 'wee:controller-height',
    height: Math.ceil(entries[0].target.getBoundingClientRect().height) + 2 }))
    .observe(document.querySelector('main'));
}

let connected = !embedded;
let lobbyPaused = embedded;
let manuallyPaused = false;
let gameActive = !embedded;
let enabled = false;
let permissionPending = false;
let permissionIntent = null;
let controllerIntentMode = null;
let setupIntent = 0;
let permissionAt = 0;
let bias = null;
let calibration = null;
let calibrationIsRestore = false;
let verifiedAt = null;
let setupStorage;
let fallbackSetupStorage;
try { setupStorage = window.localStorage; } catch { /* Fall back to this tab. */ }
try { fallbackSetupStorage = window.sessionStorage; } catch { /* Setup still works without storage. */ }
const calibrationMemory = createCalibrationMemory(setupStorage, Date.now, fallbackSetupStorage);
let savedSetup = calibrationMemory.read();
const controllerPreferences = createControllerPreferences(setupStorage ?? fallbackSetupStorage);
let motionSensitivity = controllerPreferences.values.sensitivity;
let automaticSetupPending = true;
let motionAcquired = false;
const automaticMotion = createAutomaticMotionSetup();
element('hand').value = savedSetup?.hand ?? controllerPreferences.values.hand;
let strengthProfile = null;
let rehearsal = null;
let rehearsalStream = null;
let rehearsalStarted = 0;
let stream = null;
let tennisAim = createTennisAim();
let recording = false;
let motionWanted = false;
let userPaused = false;
let started = 0;
let lastReading = null;
let latestRate = null;
let eventsSeen = 0;
let validReadings = 0;
let buttonMode = false;
let lastSetup, lastSetupReason;
let setupRequest = 0, pendingSetup = null, setupSentAt = 0, setupRetryAt = 0;
let wasConnected = false;
let canRoll = false;
let currentPlayer = null;
let bowlingPhase = 'waiting';
let tennisState = null;
let tennisGameId = null;
const bowlingGate = createBowlingDeliveryGate();
let bowlingDetector = null;
let bowlingTurn = 0;
let inputGeneration = null;
let pendingRoll = null;
let sensorUpdatedAt = 0;
let settingsOpen = false;
let playNotice = '';
let setupError = '';
let feedbackUntil = 0;
let liveAim = 0;
const aimMotion = createBowlingAimController();
const aimStream = createBowlingAimStream(event => post({ type: 'wee:player-aim', event }));
let lockedAim = null;
let bowlingReadout = null;
let pageActive = true;
const timingStats = { recognition: createTimingStats(), delivery: createTimingStats(), contact: createTimingStats() };
const pendingTimings = new Map();
let nextRecognitionMs;
let strokeNotice = '';
let strokeNoticeUntil = 0;
function renderTiming() {
  for (const [key, label] of [['recognition', 'Motion confirmation'], ['delivery', 'Delivery acknowledgement round trip'], ['contact', 'TV arrival to contact']]) {
    const sample = timingStats[key].summary();
    if (key === 'contact' && !embedded) {
      setView('timing-contact', 'textContent', 'TV arrival to contact: available when playing through the homepage lobby.');
      continue;
    }
    setView(`timing-${key}`, 'textContent', `${label}: ${sample ? `median ${Math.round(sample.median)} ms · p95 ${Math.round(sample.p95)} ms · ${sample.count} ${sample.count === 1 ? 'sample' : 'samples'}` : 'waiting for samples'}.`);
  }
}
renderTiming();
function renderSport() {
  element('controller-title').textContent = bowling ? 'Your bowling ball' : 'Your racket';
  element('tennis-settings').hidden = bowling;
  element('motion-visual').dataset.sport = bowling ? 'bowling' : 'tennis';
}
renderSport();
const phoneFeedback = createPhoneFeedback({ visual: element('motion-visual'), object: element('motion-object'),
  navigator: globalThis.navigator, document, reducedMotion: window.matchMedia?.('(prefers-reduced-motion: reduce)') });
function renderPreferences() {
  const preferences = controllerPreferences.values;
  motionSensitivity = preferences.sensitivity;
  element('haptics').checked = preferences.haptics;
  element('motion-sensitivity').value = String(preferences.sensitivity);
  element('motion-sensitivity-value').textContent = `${preferences.sensitivity}×`;
  phoneFeedback.setHaptics(preferences.haptics);
}
renderPreferences();
element('haptics').onchange = () => {
  controllerPreferences.update({haptics: element('haptics').checked}); renderPreferences();
};
element('motion-sensitivity').oninput = () => {
  if (recording || calibration || rehearsal) return;
  controllerPreferences.update({sensitivity: Number(element('motion-sensitivity').value)}); renderPreferences();
};
const screenAwake = createScreenAwake({ navigator: globalThis.navigator, document,
  onState: state => {
    element('wake-status').textContent = state === 'awake' ? 'Screen stays awake while your controller is ready.'
      : state === 'unavailable' || state === 'released' ? 'Your browser could not keep the screen awake. Keep this page visible and check your phone’s screen-lock setting.'
      : 'The screen stays awake during play when your browser allows it.';
  },
});

function recentReadings() { return lastReading !== null && performance.now() - lastReading < 1500; }
function publishSetup() {
  const setup = !pageActive || document.hidden ? null : buttonMode ? 'buttons' : bias && !rehearsal ? 'motion' : null;
  setView('setup-status', 'textContent', setup === 'motion' ? 'Motion ready' : setup === 'buttons' ? 'Touch controls ready' : 'Connecting motion');
  const now = performance.now();
  const reason = !pageActive || document.hidden ? 'background' : undefined;
  if (embedded && (setup !== lastSetup || reason !== lastSetupReason || connected && (pendingSetup !== null && now - setupSentAt > 6000 || setupError && now >= setupRetryAt))) {
    lastSetup = setup; lastSetupReason = reason;
    pendingSetup = ++setupRequest; setupSentAt = now; setupRetryAt = Infinity;
    post({ type: 'wee:controller-setup', setup, requestId: pendingSetup,
      ...(reason ? {reason} : {}) });
  }
}
function turnReady() { return bowling && gameActive && connected && !lobbyPaused && canRoll && currentPlayer === player && !pendingRoll; }
function publishAim() {
  aimStream.publish(lockedAim ?? Number(element('aim').value), lockedAim !== null, performance.now(),
    turnReady() && pageActive && !document.hidden && !settingsOpen && (buttonMode || Boolean(bias)));
}
function cancelArmedRoll() { bowlingGate.suspend(); bowlingDetector = null; lockedAim = null; }
// One calm play screen; setup remains mounted so switching views preserves
// calibration, sensor permission and the lobby connection.
function renderPlayState() {
  const setup = buttonMode || Boolean(bias);
  setView('setup-panel', 'hidden', !settingsOpen);
  setView('controller-options', 'hidden', !settingsOpen);
  setView('play-panel', 'hidden', settingsOpen);
  setView('timing-details', 'hidden', bowling || !settingsOpen);
  setView('strength-panel', 'hidden', bowling || buttonMode || !bias || !settingsOpen);
  setView('tune-strength', 'disabled', !bias || !recentReadings() || Boolean(rehearsal) || Boolean(calibration));
  setView('tune-strength', 'textContent', strengthProfile ? 'Retune power' : 'Tune power');
  setView('skip-strength', 'textContent', rehearsal ? 'Cancel rehearsal' : 'Use default power');
  setView('strength-progress', 'hidden', !rehearsal);
  setView('controller-header', 'hidden', embedded && !settingsOpen);
  setView('toggle-settings', 'hidden', settingsOpen);
  setView('back-to-play', 'hidden', !settingsOpen);
  setView('toggle-settings', 'disabled', Boolean(calibration) || Boolean(rehearsal) || permissionPending);
  setView('toggle-settings', 'textContent', settingsOpen ? 'Back to play' : 'Settings');
  setView('toggle-settings', 'ariaExpanded', String(settingsOpen));
  setView('stop', 'hidden', !setup || buttonMode || !gameActive || !settingsOpen);
  let state = 'ready';
  let status = buttonMode ? 'Touch ready' : 'Motion ready';
  let title = 'You’re in';
  let help = 'Watch the TV. Your game starts here.';
  if (!connected) {
    state = 'paused'; status = 'Connection lost'; title = 'Reconnecting…';
    help = 'Keep this page open. Your controller will reconnect automatically.';
  } else if (!setup) {
    state = 'paused'; status = enabled ? 'Connecting motion' : 'Let’s play';
    title = enabled ? 'Getting your phone ready' : 'Your phone is the controller';
    help = enabled ? 'Waiting for motion readings…' : 'Allow motion, or use touch controls.';
    if (playNotice) help = playNotice;
  } else if (gameActive && lobbyPaused) {
    state = 'paused'; status = 'Match paused'; title = 'Hang tight';
    help = manuallyPaused ? 'Player 1 or the TV can resume the match from game options.'
      : 'Waiting for everyone to reconnect and finish setup.';
  } else if (setupError) {
    state = 'paused'; status = 'Reconnecting'; title = 'Reconnecting your controls…';
    help = 'Keep this page open. We’ll retry automatically.';
  } else if (gameActive && bowling && (bowlingPhase === 'complete' || bowlingPhase === 'finished')) {
    state = 'finished'; status = 'Match complete'; title = 'Nice bowling!'; help = 'See the final scores on the TV.';
  } else if (gameActive && !bowling && tennisState?.phase === 'complete') {
    state = 'finished'; status = 'Match complete';
    title = tennisState.winner === player ? 'You won!' : 'Good match!';
    help = 'See the set scores on the TV. The host can start another match.';
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
    if (!bowling && tennisState?.practice) {
      title = 'Practice your return'; help = 'Watch the feed on the TV. Each return helps you find your timing.';
    } else if (!bowling && tennisState?.phase === 'prepare') {
      title = tennisState.server === player ? 'You serve next' : `P${tennisState.server} serves next`;
      help = 'Point finished. Get ready for the next serve.';
    } else if (!bowling && tennisState?.phase === 'serve') {
      const serving = tennisState.server === player;
      title = serving ? 'Your serve' : `P${tennisState.server} is serving`;
      help = serving ? 'Swing when you’re ready to serve.' : 'Get ready to return. Watch the ball on the TV.';
      if (serving && tennisState.serveAttempt === 2) { title = 'Your second serve'; help = 'Take your time and swing comfortably.'; }
    }
    if (bowling) {
      if (pendingRoll || (currentPlayer === player && !canRoll)) {
        state = 'waiting'; title = 'Watch the lane'; help = 'Your ball is rolling. Let the pins settle.';
      } else if (turnReady()) {
        status = 'Your turn';
        title = buttonMode ? 'Choose your line' : bowlingGate.phase === 'finished' ? 'Watch the lane' : 'Swing forward to bowl';
        help = buttonMode ? 'Aim, then tap Roll.' : bowlingGate.phase === 'finished' ? 'Waiting for the next ball.' : 'Screen up. Tilt to aim, then swing gently forward.';
      } else {
        state = 'waiting'; title = currentPlayer ? `P${currentPlayer} is bowling` : 'Waiting for the lane';
        help = 'Watch the TV. Your turn will appear here.';
      }
    }
  }
  // Avoid repeatedly replacing live-region content on the sensor timer.
  const notice = setupError || playNotice || (performance.now() < strokeNoticeUntil ? strokeNotice : '');
  for (const [id, text] of [['play-status', status], ['play-title', title], ['play-help', help], ['play-notice', notice]]) {
    if (element(id).textContent !== text) element(id).textContent = text;
  }
  if (element('play-panel').dataset.state !== state) element('play-panel').dataset.state = state;
  setView('play-notice', 'hidden', !notice || (!setupError && (!gameActive || lobbyPaused || !connected)));
  setView('record', 'hidden', !setup || buttonMode || !gameActive || lobbyPaused || !connected || recording || settingsOpen || state === 'finished');
  setView('record', 'disabled', !gameActive || lobbyPaused || !connected || !enabled || !bias || recording || Boolean(calibration) || !recentReadings());
  setView('bowling-controls', 'hidden', !bowling || state !== 'playing' || !turnReady());
  setView('shot-adjustments', 'hidden', !buttonMode);
  setView('curve-buttons', 'hidden', !buttonMode);
  setView('aim', 'hidden', false);
  setView('aim-label', 'textContent', 'Aim');
  setView('tilt-help', 'hidden', true);
  setView('bowling-readout', 'hidden', !bowling || buttonMode || !gameActive || state === 'paused' || !(bowlingReadout && performance.now() < feedbackUntil));
  setView('grip-cue', 'hidden', !bowling || buttonMode || !setup || state !== 'playing');
  setView('use-buttons', 'hidden', buttonMode || settingsOpen);
  setView('enable', 'hidden', settingsOpen || (setup && !buttonMode) || enabled && !buttonMode);
  setView('enable', 'textContent', buttonMode ? 'Use motion' : 'Allow motion');
  setView('bowling-buttons', 'hidden', !buttonMode);
  setView('manual-controls', 'hidden', bowling || !buttonMode || state !== 'playing');
  setView('latest', 'hidden', !gameActive || state === 'paused' || performance.now() >= feedbackUntil);
  const activeController = setup && gameActive && connected && !lobbyPaused && !settingsOpen && pageActive && !document.hidden && (state === 'playing' || state === 'waiting');
  const readyInLobby = !gameActive && Boolean(bias) && !buttonMode && connected && !settingsOpen && pageActive && !document.hidden && state === 'ready';
  const rehearsing = Boolean(rehearsal) && connected && pageActive && !document.hidden;
  screenAwake.setActive(activeController || readyInLobby || rehearsing);
  phoneFeedback.setActive(activeController);
}
function controls() {
  element('setup-next').textContent = 'Motion connects automatically. Reset only if your phone drifts.';
  element('enable').disabled = permissionPending;
  element('enable').textContent = enabled ? 'Retry motion access' : 'Enable motion';
  element('calibrate').disabled = permissionPending || Boolean(calibration);
  element('calibrate').textContent = calibration ? calibrationIsRestore ? 'Checking motion…' : 'Calibrating…'
    : bias ? 'Reset motion setup' : savedSetup ? 'Resume motion' : 'Enable motion';
  element('stop').disabled = !gameActive || !motionWanted;
  for (const id of ['hand', 'response', 'stroke-mode', 'suppress-returns']) element(id).disabled = recording || Boolean(calibration) || Boolean(rehearsal);
  element('motion-sensitivity').disabled = recording || Boolean(calibration) || Boolean(rehearsal);
  for (const id of ['forehand', 'backhand']) element(id).disabled = !gameActive || lobbyPaused || !connected || tennisState?.phase === 'complete';
  element('roll').disabled = !turnReady() || (!buttonMode && !bias);
  publishSetup();
  renderPlayState();
}
function deliveryResult(event, kind = 'swing') {
  element('delivery').textContent = event.ok === false
    ? kind === 'roll' && ['timeout', 'outcome-unknown'].includes(event.error)
      ? 'Roll confirmation is delayed. Watch the TV; do not release again until the lane is ready.'
      : event.error === 'network-busy' ? `Connection busy. This ${kind} was not sent; try when it clears.`
      : event.error === 'game-loading' ? 'The game is loading. Try again when it appears on the TV.'
      : event.error === 'not-your-turn' || event.error === 'roll-rejected' ? 'Wait until the TV and your controller show your turn.'
      : event.error === 'duplicate-roll' ? 'This roll was already received. Watch the lane for its result.'
      : ['stale-input', 'wrong-generation', 'wrong-epoch'].includes(event.error) ? 'That input belonged to an earlier turn. Wait for your controller to reconnect.'
      : `The ${kind} was not accepted. Wait for the game to reconnect, then try again.`
    : event.receivers ? Number.isFinite(event.roundTripMs)
      ? `Delivered · ${event.roundTripMs} ms ${event.timingScope === 'server' ? 'server' : 'game delivery'} round trip.`
      : 'Delivered to game.' : 'No game connected. Check the TV.';
  playNotice = event.ok === false || !event.receivers ? element('delivery').textContent : '';
  if (event.ok !== false && event.receivers > 0) phoneFeedback.delivered(kind);
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
  onSent: event => {
    pendingTimings.set(event.id, { at: performance.now(), acknowledged: false });
    if (pendingTimings.size > 40) pendingTimings.delete(pendingTimings.keys().next().value);
    timingStats.recognition.add(nextRecognitionMs); renderTiming();
  },
  onAck: event => {
    const pending = pendingTimings.get(event.id);
    if (!pending || pending.acknowledged || !connected || !gameActive || lobbyPaused || performance.now() - pending.at > 5000) return;
    if (event.ok !== false) {
      timingStats.delivery.add(event.roundTripMs); pending.acknowledged = true; renderTiming();
    }
    pending.acknowledged = true;
    deliveryResult(event);
  },
});
function send(label, power = 0.5, recognitionMs, placement) {
  if (bowling || lobbyPaused || !gameActive || !connected || settingsOpen || rehearsal || document.hidden || tennisState?.phase === 'complete') return;
  strokeNoticeUntil = 0;
  nextRecognitionMs = recognitionMs;
  const sent = connection.sendSwing(label, element('hand').value, power, placement);
  nextRecognitionMs = undefined;
  if (sent) phoneFeedback.swing(label);
  element('delivery').textContent = sent ? 'Sending stroke…' : 'Disconnected: the stroke was not sent.';
  playNotice = sent ? '' : element('delivery').textContent;
  renderPlayState();
}
element('forehand').onclick = () => send('Forehand');
element('backhand').onclick = () => send('Backhand');
function roll(power, measuredSpin = null) {
  if (!turnReady() || document.hidden) return;
  const aim = lockedAim ?? Number(element('aim').value);
  cancelArmedRoll();
  const event = { type: 'roll', id: createInputId(), power,
    aim, spin: measuredSpin ?? Number(element('spin').value) };
  pendingRoll = { id: event.id, turnKey: bowlingTurn, at: performance.now() };
  post({ type: 'wee:player-roll', event });
  element('delivery').textContent = 'Sending your roll…';
  element('latest').textContent = measuredSpin === null ? `${Math.round(power * 100)}% power` : 'Roll sent';
  feedbackUntil = performance.now() + 3500;
  playNotice = '';
  controls();
}
element('roll').onclick = () => roll(Number(element('power').value));
function showBowlingReadout(readout) {
  element('motion-power').value = readout.power;
  element('motion-power-value').textContent = `${Math.round(readout.power * 100)}%`;
  element('motion-curve').textContent = Math.abs(readout.spin) < .005 ? 'Straight'
    : `${readout.spin < 0 ? 'Left' : 'Right'} ${Math.round(Math.abs(readout.spin) / .55 * 100)}%`;
}
for (const id of ['aim', 'spin', 'power']) {
  element(id).oninput = () => {
    const value = Number(element(id).value);
    element(`${id}-value`).textContent = id === 'power' ? `${Math.round(value * 100)}%`
      : value === 0 ? id === 'aim' ? 'Center' : 'Straight'
      : `${value < 0 ? 'Left' : 'Right'} ${Math.round(Math.abs(value) * 100)}%`;
    if (id === 'aim') publishAim();
  };
}
function analyze() {
  if (!recording || bowling) return;
  for (const swing of stream?.analyze() ?? []) {
    const power = Math.min(1, tennisPower(swing.peakRotation, strengthProfile, swing.label) * motionSensitivity);
    element('latest').textContent = swing.label === 'Unknown' ? 'Try a clearer swing' : `${swing.label} · ${tennisStrength(power)}`;
    feedbackUntil = performance.now() + 1500;
    element('timing').textContent = swing.simple ? 'Simple motion mapping · your selected shot.' : swing.early || swing.fast
      ? `Recognized in ${Math.round(swing.detectionDelayMs)} ms, before network and game response.`
      : 'Stroke classified after completion.';
    const recognitionMs = Number.isFinite(swing.detectionDelayMs) ? swing.detectionDelayMs
      : Number.isFinite(swing.startMs) ? performance.now() - started - swing.startMs : undefined;
    if (swing.label !== 'Unknown') {motionDiagnostics.count('swing.recognized'); motionDiagnostics.observe('swing.recognitionMs',recognitionMs);}
    if ((swing.complete || swing.early || swing.fast) && swing.label !== 'Unknown') {
      // The stream uses time relative to recording start; aim history uses
      // the canonical absolute phone sample clock. Never mix those epochs.
      send(swing.label, power, recognitionMs, tennisAim.capture(started + swing.startMs));
    }
  }
}
function stop(message = 'Motion paused. Tap Resume motion when you are ready.', user = false) {
  if (user) { motionWanted = false; userPaused = true; }
  const wasRecording = recording;
  recording = false;
  stream = null; // Never flush an unfinished gesture when stopping or disconnecting.
  tennisAim.reset();
  cancelArmedRoll();
  if (wasRecording || user) element('motion').textContent = message;
  controls();
}
function startMotion() {
  if (!bowling && tennisState?.phase === 'complete') return;
  if (recording || settingsOpen || rehearsal || !motionWanted || !bias || buttonMode || calibration || !enabled || !gameActive || lobbyPaused || !connected || !pageActive || document.hidden || !recentReadings()) return;
  const mode = element('stroke-mode').value;
  stream = bowling ? null : mode === 'auto' ? createSwingStream(element('hand').value, {
    early: element('response').value === 'early', fast: element('response').value === 'fast', suppressReturns: element('suppress-returns').checked,
  }) : createSimpleSwingStream(mode);
  tennisAim = createTennisAim({sensitivity:motionSensitivity});
  started = performance.now();
  recording = true;
  element('latest').textContent = '';
  playNotice = '';
  element('motion').textContent = bowling ? 'Swing forward to bowl. Turn your wrist to curve.' : 'Motion is live. Swing to play; use Stop motion to pause your detector.';
  controls();
}
function finishRehearsal(message, profile = null) {
  rehearsal = null;
  rehearsalStream = null;
  if (profile) { strengthProfile = profile; rememberCalibration(); }
  element('strength-status').textContent = message;
  controls();
}
function updateRehearsal(result) {
  element('strength-progress').value = result.count;
  if (element('strength-status').textContent !== result.message) element('strength-status').textContent = result.message;
  if (result.state !== 'collecting') finishRehearsal(result.message, result.profile);
}
element('tune-strength').onclick = () => {
  if (bowling || !bias || buttonMode || calibration || !recentReadings() || document.hidden || rehearsal) return;
  stop('Motion pauses while you rehearse comfortable swings.');
  settingsOpen = true;
  rehearsalStarted = performance.now();
  rehearsal = createStrengthRehearsal(element('hand').value, rehearsalStarted);
  // Use complete real classifications regardless of the selected gameplay mode.
  rehearsalStream = createSwingStream(element('hand').value, { suppressReturns: true });
  updateRehearsal(rehearsal.read(rehearsalStarted));
  controls();
};
element('skip-strength').onclick = () => {
  if (rehearsal) finishRehearsal(strengthProfile ? 'Rehearsal cancelled. Your previous comfortable strength is kept.' : 'Rehearsal cancelled. Default strength is ready.');
  else {
    strengthProfile = null;
    rememberCalibration();
    element('strength-status').textContent = 'Default strength is ready. Tune again whenever you want.';
  }
  controls();
};
element('hand').onchange = () => {
  setupIntent++;
  controllerPreferences.update({hand: element('hand').value});
  strengthProfile = null;
  // Gyro bias is hand-independent once verified, but an unverified stored
  // setup must never restore another hand's power profile or selection.
  savedSetup = null;
  calibrationMemory.clear();
  rememberCalibration();
  finishRehearsal('Playing hand changed. Default power is ready.');
};
window.addEventListener('message', event => {
  if (!embedded || event.source !== window.parent || event.origin !== location.origin) return;
  const data = event.data;
  if (data?.type === 'wee:controller-intent') {
    const selected = data.mode === 'touch' || data.permission === 'denied' || data.permission === 'unavailable' ? 'touch' : data.mode;
    if (!['motion', 'touch'].includes(selected) || selected === controllerIntentMode) return;
    controllerIntentMode = selected;
    if (data.mode === 'touch' || data.permission === 'denied' || data.permission === 'unavailable') element('use-buttons').onclick();
    else if (data.mode === 'motion' && data.permission === 'granted') void activateMotion(true);
    return;
  }
  if (data?.type === 'wee:profile-preferences') {
    const active = setupIntent > 0 || Boolean(bias || calibration || recording || rehearsal || buttonMode || pendingRoll);
    if (controllerPreferences.applyProfile(data.preferences, {active, protectedKeys: savedSetup ? ['hand', 'touchControls', 'sensitivity'] : []})) {
      if (!savedSetup) element('hand').value = controllerPreferences.values.hand;
      renderPreferences();
      if (controllerPreferences.values.touchControls) element('use-buttons').onclick();
    }
    return;
  }
  if (data?.type === 'wee:stroke-result' && !bowling && isStrokeResult(data) &&
      data.gameId === tennisGameId && data.player === player && connected && gameActive && !lobbyPaused) {
    const pending = pendingTimings.get(data.id);
    if (!pending || pending.result || performance.now() - pending.at > 5000) return;
    pending.result = true;
    if (data.result === 'hit') timingStats.contact.add(data.receivedToContactMs);
    element('timing-result').textContent = `Last stroke: ${data.result} · ${data.reason}`;
    if (!settingsOpen && data.result !== 'hit') { strokeNotice = data.reason; strokeNoticeUntil = performance.now() + 1800; }
    renderTiming(); renderPlayState(); return;
  }
  if (data?.type === 'wee:game-hit' && data.kind === (bowling ? 'bowling' : 'tennis') && data.player === player) {
    if (gameActive && connected && !lobbyPaused && !settingsOpen) phoneFeedback.hit(performance.now(), data.kind);
    return;
  }
  if (data?.type === 'wee:setup-ack') {
    if (data.requestId !== pendingSetup) return;
    pendingSetup = null;
    setupError = data.result?.ok ? '' : 'Reconnecting your controls…';
    if (setupError) setupRetryAt = performance.now() + 1000;
    if (setupError) element('setup-status').textContent = setupError;
    renderPlayState();
    return;
  }
  if (data?.type === 'wee:bowling-state' && bowling) {
    // Readiness also changes on pause/reconnect. Only an actual lane/player
    // transition can grant a new delivery while an earlier outcome is unknown.
    if (data.phase === 'ready' && (bowlingPhase !== 'ready' || currentPlayer !== data.currentPlayer)) bowlingTurn++;
    canRoll = data.canRoll === true;
    currentPlayer = data.currentPlayer;
    bowlingPhase = data.phase;
    if (!canRoll || currentPlayer !== player) cancelArmedRoll();
    controls(); return;
  }
  if (data?.type === 'wee:tennis-state' && !bowling && isTennisState(data)) {
    tennisState = { phase: data.phase, server: data.server, winner: data.winner, practice: data.practice, serveAttempt: data.serveAttempt };
    if (data.phase === 'complete') stop('Match complete. See the TV for results.');
    else startMotion();
    controls(); return;
  }
  if (data?.type === 'wee:roll-ack' && bowling) {
    if (!pendingRoll || data.result?.id !== pendingRoll.id) return;
    bowlingGate.rejectRelease(pendingRoll.turnKey, data.result);
    pendingRoll = null;
    deliveryResult(data.result ?? { ok: false }, 'roll');
    controls(); return;
  }
  if (data?.type !== 'wee:lobby-state' || typeof data.paused !== 'boolean') return;
  const generation = data.generation ?? data.inputGeneration;
  if (generation !== undefined && generation !== inputGeneration || data.gameId !== tennisGameId) {
    inputGeneration = generation;
    if (data.gameId !== tennisGameId) bowlingTurn++;
    cancelArmedRoll();
  }
  if (['tennis', 'bowling'].includes(data.sport) && bowling !== (data.sport === 'bowling')) {
    // The same controller document owns permission and gyro zero across sports.
    // Drop sport-specific input, but never require another calibration to switch.
    stop('Switching games…');
    if (rehearsal) finishRehearsal('Power tuning stopped. Your saved power is kept.');
    bowling = data.sport === 'bowling';
    canRoll = false; currentPlayer = null; bowlingPhase = 'waiting';
    pendingRoll = null; bowlingReadout = null; liveAim = 0;
    aimStream.reset(); aimMotion.reset(0);
    element('aim').value = '0'; element('aim').oninput();
    element('strength-panel').open = false;
    settingsOpen = false; playNotice = ''; feedbackUntil = 0;
    tennisState = null; pendingTimings.clear(); strokeNoticeUntil = 0;
    renderSport();
    // The lobby may have reset readiness for its new sport. Re-publish the
    // already verified controller mode without dropping it to an unset state.
    lastSetup = undefined;
  }
  if (data.gameId !== tennisGameId || gameActive && !data.playing) {
    // A returned match cannot keep a pending roll or an open tuning panel
    // attached to the next game. Verified controller setup stays available.
    pendingRoll = null; canRoll = false; currentPlayer = null; bowlingPhase = 'waiting';
    bowlingReadout = null; settingsOpen = false; playNotice = ''; feedbackUntil = 0;
    if (rehearsal) finishRehearsal('Your controller is ready for the next game.');
  }
  if (data.gameId !== tennisGameId || !data.playing) {
    tennisState = null; tennisGameId = data.gameId; pendingTimings.clear(); strokeNoticeUntil = 0;
    for (const stats of Object.values(timingStats)) stats.clear();
    element('timing-result').textContent = ''; renderTiming();
  }
  if (data.connected && !wasConnected) lastSetup = undefined;
  connected = data.connected === true;
  if (!connected && rehearsal) finishRehearsal('Rehearsal stopped while reconnecting. Try again when connected, or keep the default strength.');
  wasConnected = connected;
  gameActive = data.playing === true;
  lobbyPaused = data.paused;
  manuallyPaused = data.manuallyPaused === true;
  if (lobbyPaused || !connected) { pendingTimings.clear(); strokeNoticeUntil = 0; }
  if (lobbyPaused || !connected || !gameActive) stop('Paused. Motion will resume when the match is ready.');
  startMotion();
  controls();
});

function motion(event) {
  eventsSeen++;
  const now = performance.now();
  const reading = readLegacyWebMotion(event, { timeMs: now,
    timeOriginMs: rehearsal ? rehearsalStarted : started, sequence: eventsSeen, bias,
    screenAngle: window.screen?.orientation?.angle ?? window.orientation ?? 0 });
  if (!reading) return;
  const rate = reading.rate;
  if (!bowling) {
    motionDiagnostics.count('sensor.received');
    if (lastReading !== null) motionDiagnostics.observe('sensor.intervalMs',now-lastReading);
  }
  validReadings++;
  lastReading = now;
  latestRate = { alpha: rate.alpha, beta: rate.beta, gamma: rate.gamma };
  let sample = reading.legacy;
  let canonical = reading.sample;
  if (automaticSetupPending && !calibration && !buttonMode && !document.hidden && pageActive) {
    enabled = true;
    const setup = automaticMotion.push(reading.sample, {safeBoundary: !recording || (bowling
      ? bowlingGate.phase === 'rest' || bowlingGate.phase === 'ready'
      : false)});
    if (!setup.ready) {
      if (bias) { bias = null; stop('Reconnecting motion…'); }
      return;
    }
    const degrees = 180 / Math.PI;
    canonical = setup.sample;
    bias = {alpha: setup.calibration.bias.x * degrees, beta: setup.calibration.bias.y * degrees, gamma: setup.calibration.bias.z * degrees};
    sample = toLegacyMotionSample(setup.sample, {timeOriginSeconds: (rehearsal ? rehearsalStarted : started) / 1000});
    if (setup.justReady) {
      motionAcquired = true;
      if (!userPaused) motionWanted = true;
      element('motion').textContent = 'Motion ready. Watch the TV.';
      controls(); startMotion();
      // Starting a recognizer establishes a new time origin.
      sample = toLegacyMotionSample(setup.sample, {timeOriginSeconds: (rehearsal ? rehearsalStarted : started) / 1000});
    }
  }
  calibration?.push(rate, now);
  if ((!recording && !rehearsal) || !bias || !pageActive || document.hidden) return;
  if (rehearsal) {
    rehearsalStream.push(sample);
    for (const swing of rehearsalStream.analyze()) {
      if (rehearsal) updateRehearsal(rehearsal.accept(swing, now));
    }
    return;
  }
  phoneFeedback.motion(sample, now);
  if (bowling) {
    // Capture the last positioning line before the first forward-pitch sample
    // can move its gravity vector. Delivery recognition owns the aim lock.
    const result = bowlingGate.push(sample, {active: turnReady(), turnKey: bowlingTurn, aim: Number(element('aim').value)});
    if (bowlingGate.lockedAim === null && turnReady()) {
      const degrees = Math.PI / 180;
      const tilt = aimMotion.push({...reading.sample, angularVelocity: {
        x: sample.rotationAlpha * degrees, y: sample.rotationBeta * degrees, z: sample.rotationGamma * degrees,
      }}, {sensitivity: motionSensitivity});
      if (tilt !== null) {
        liveAim = tilt;
        element('aim').value = String(Math.round(liveAim * 100) / 100);
        element('aim').oninput();
      }
    }
    bowlingDetector = bowlingGate.phase === 'forward' ? bowlingGate : null;
    const previousAim = lockedAim;
    lockedAim = bowlingGate.lockedAim;
    if (previousAim !== lockedAim) publishAim();
    if (bowlingDetector || result) {
      const detected = result ?? bowlingGate.preview;
      bowlingReadout = {...detected, power: Math.min(1, detected.power * motionSensitivity)};
      showBowlingReadout(bowlingReadout);
    }
    if (result) roll(Math.min(1, result.power * motionSensitivity), result.spin);
  } else {
    const radians = Math.PI / 180;
    tennisAim.push({...canonical, angularVelocity:{x:sample.rotationAlpha * radians,y:sample.rotationBeta * radians,z:sample.rotationGamma * radians}});
    stream.push(sample); if (element('response').value !== 'complete') analyze();
  }
}
function currentSetupIntent(intent) { return intent === setupIntent && pageActive && !document.hidden; }
async function requestMotion(intent, reusePermission = false) {
  if (!window.isSecureContext) throw new Error('Motion needs HTTPS. The lobby can open over HTTP, but phone sensors cannot. Ask the TV host for the secure HTTPS link, or use buttons.');
  if (!window.DeviceMotionEvent) throw new Error('This browser does not expose phone motion. Open the link in Safari or Chrome on a phone, or use buttons.');
  const policy = document.permissionsPolicy ?? document.featurePolicy;
  if (policy?.allowsFeature && ['accelerometer', 'gyroscope'].some(feature => !policy.allowsFeature(feature))) {
    throw new Error('This page is blocked from using motion sensors by its permissions policy. Open the original game link directly in your phone browser, or use buttons.');
  }
  permissionPending = true;
  permissionIntent = intent;
  controls();
  try {
    // Called directly from the tap handler: iOS requires transient activation.
    const permission = !reusePermission && typeof DeviceMotionEvent.requestPermission === 'function'
      ? await DeviceMotionEvent.requestPermission() : 'granted';
    if (!currentSetupIntent(intent)) return;
    if (permission !== 'granted') throw new Error('Motion access was denied. Allow Motion & Orientation in this site’s browser permissions, then reload and try again. Button controls are available now.');
    window.addEventListener('devicemotion', motion);
    enabled = true;
    permissionAt = performance.now();
    element('motion').textContent = recentReadings() ? 'Motion is connecting…' : 'Permission allowed. Waiting for actual sensor readings…';
  } finally {
    if (permissionIntent === intent) { permissionPending = false; permissionIntent = null; controls(); }
  }
}
function showMotionError(error) {
  playNotice = error.name === 'NotAllowedError' ? 'Tap Allow motion to continue, or use touch controls.'
    : /denied/i.test(error.message) ? 'Motion access was denied. Touch controls are ready to use.'
    : /HTTPS/i.test(error.message) ? 'Motion needs a secure HTTPS link. You can use touch controls here.'
    : 'Motion is unavailable here. Use touch controls to play.';
  element('motion').textContent = error.name === 'NotAllowedError'
    ? 'Motion permission needs a direct tap. Open this page in Safari or Chrome, tap Enable motion and allow access.' : error.message;
  element('sensor-status').dataset.state = 'error';
  renderPlayState();
}
function rememberCalibration() {
  if (bias && Number.isFinite(verifiedAt)) calibrationMemory.save({
    hand: element('hand').value, bias, strength: strengthProfile, verifiedAt,
  });
}
function beginCalibration(restore = false) {
  stop();
  buttonMode = false;
  bias = null;
  if (restore) savedSetup = calibrationMemory.read();
  calibrationIsRestore = restore && savedSetup?.hand === element('hand').value;
  automaticSetupPending = false;
  if (!calibrationIsRestore) {
    savedSetup = null;
    calibrationMemory.clear();
    strengthProfile = null;
    element('strength-status').textContent = 'Default power works for normal play. Tuning is optional.';
  }
  calibration = calibrationIsRestore
    ? createCalibrationResume(performance.now(), savedSetup.bias)
    : createCalibrationSession(performance.now());
  element('calibration-progress').hidden = false;
  element('calibration-progress').value = 0;
  element('motion').textContent = calibrationIsRestore ? 'Reconnecting your motion sensors…'
    : 'Hold your phone still for a moment…';
  controls();
}
async function activateMotion(reusePermission = false) {
  userPaused = false;
  controllerIntentMode = 'motion';
  post({type: 'wee:controller-mode', mode: 'motion'});
  const intent = ++setupIntent;
  controllerPreferences.update({touchControls: false});
  buttonMode = false;
  automaticSetupPending = true;
  motionAcquired = false;
  automaticMotion.reset();
  calibration = null; bias = null;
  element('calibration-progress').hidden = true;
  stop();
  try {
    await requestMotion(intent, reusePermission);
    if (!currentSetupIntent(intent)) return;
    motionWanted = true;
    controls();
  } catch (error) {
    if (currentSetupIntent(intent)) { element('use-buttons').onclick(); showMotionError(error); }
  }
}
element('enable').onclick = () => activateMotion();
element('calibrate').onclick = async () => {
  const intent = ++setupIntent;
  controllerPreferences.update({touchControls: false});
  if (rehearsal) finishRehearsal('Rehearsal stopped for recalibration.');
  stop();
  try {
    // One tap also requests permission; disabled Calibrate used to hide this step.
    if (!enabled || !recentReadings()) await requestMotion(intent);
    if (!currentSetupIntent(intent)) return;
    beginCalibration(Boolean(savedSetup) && !bias);
  } catch (error) { if (currentSetupIntent(intent)) showMotionError(error); }
};
element('record').onclick = () => { userPaused = false; motionWanted = true; startMotion(); };
element('stop').onclick = () => stop(undefined, true);
element('toggle-settings').onclick = () => {
  if (rehearsal) return;
  settingsOpen = !settingsOpen;
  if (settingsOpen) stop('Motion pauses while controller settings are open.');
  else startMotion();
  controls();
  focusControllerSection(element(settingsOpen ? 'back-to-play' : 'play-panel'));
};
element('back-to-play').onclick = () => {
  if (rehearsal) finishRehearsal('Your controller is ready.');
  settingsOpen = false;
  startMotion(); controls();
  focusControllerSection(element('play-panel'));
};
element('use-buttons').onclick = () => {
  controllerIntentMode = 'touch';
  post({type: 'wee:controller-mode', mode: 'touch'});
  setupIntent++;
  controllerPreferences.update({touchControls: true});
  if (rehearsal) finishRehearsal('Rehearsal stopped. Button controls use default strength.');
  stop(undefined, true);
  calibration = null;
  calibrationIsRestore = false; automaticSetupPending = false;
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
  // Readiness and notices still refresh during play. Live gyro counters belong
  // to Settings, so do not rebuild their hidden text on every sensor poll.
  if (gameActive && !settingsOpen && (buttonMode || recentReadings())) {
    renderPlayState(); return;
  }
  const status = element('sensor-status');
  let sensorState = 'ready';
  if (!window.isSecureContext) {
    setView('sensor-status', 'textContent', 'HTTP connection: phone motion is unavailable. Use an HTTPS link or button controls.');
    sensorState = 'error';
  } else if (!window.DeviceMotionEvent) {
    setView('sensor-status', 'textContent', 'No motion API on this device. Button controls are available.');
    sensorState = 'error';
  } else if (recentReadings()) setView('sensor-status', 'textContent', `Gyroscope connected · ${validReadings} readings received`);
  else if (enabled && now - permissionAt > 2500) {
    setView('sensor-status', 'textContent', eventsSeen ? 'Motion events arrived without gyroscope data. Check browser permissions or use buttons.' : 'Permission allowed, but no readings arrived. Keep this page visible and check browser motion permissions.');
    sensorState = 'error';
  } else setView('sensor-status', 'textContent', enabled ? 'Waiting for sensor readings…' : 'Allow motion or choose touch controls.');
  setView('sensor-detail', 'textContent', `${window.isSecureContext ? 'Secure context' : 'Insecure context'} · ${eventsSeen} events · ${validReadings} valid gyro readings${latestRate ? ` · ${Math.round(Math.hypot(...Object.values(latestRate)))}°/s · last reading ${Math.round(now - lastReading)} ms ago` : ''}`);
  setView('detector-state', 'textContent', !recording ? 'Motion idle' : bowling ? bowlingDetector ? 'Forward swing · aim locked' : 'Motion live · waiting for your turn and a brief rest'
    : stream?.phase === 'recovering' ? 'Return to rest for the next stroke' : 'Motion live · ready for a swing');
  if (status.dataset.state !== sensorState) status.dataset.state = sensorState;
  renderPlayState();
}
setInterval(() => {
  const now = performance.now();
  publishSetup();
  if (automaticSetupPending && enabled && !buttonMode && !motionAcquired && !permissionPending &&
      pageActive && !document.hidden && now - permissionAt >= 3000) {
    element('use-buttons').onclick();
    playNotice = 'Motion isn’t available here. Touch controls are ready.';
  }
  if (automaticSetupPending && !buttonMode && bias && !automaticMotion.read(now / 1000).ready) {
    bias = null; stop('Waiting for fresh motion readings…');
  }
  publishAim();
  sensorStatus(now);
  if (calibration) {
    const result = calibration.read(now);
    element('calibration-progress').value = result.progress;
    if (result.state === 'done' || result.state === 'failed') {
      const restored = calibrationIsRestore;
      bias = result.bias ?? null;
      calibration = null;
      calibrationIsRestore = false;
      element('calibration-progress').hidden = true;
      if (bias) {
        if (restored) strengthProfile = savedSetup?.strength ?? null;
        // Reusing a stored bias is not a new stationary verification. Keep its
        // original expiry so repeated reloads cannot extend stale calibration.
        verifiedAt = restored ? savedSetup.verifiedAt : Date.now();
        savedSetup = null;
        rememberCalibration();
        motionWanted = true;
        settingsOpen = false;
        element('motion').textContent = restored ? 'Your setup is ready again. Motion starts with the match.'
          : gameActive ? 'Motion ready. Watch the TV.' : 'Motion ready. Your game starts here.';
        if (restored && strengthProfile) element('strength-status').textContent = 'Your comfortable strength was restored for this playing hand.';
      } else element('motion').textContent = restored ? 'Waiting for your phone sensors. Tap Resume motion to allow access.'
        : result.reason === 'no-readings' || result.reason === 'stale'
        ? 'Calibration could not get live gyroscope readings. Open Controller help, then retry or use button controls.'
        : 'The phone kept moving. Hold it still and tap Enable motion to retry.';
      controls();
    } else element('motion').textContent = result.state === 'settling' ? 'Hold your phone still for a moment…'
      : result.state === 'moving' ? 'Movement detected. Hold still briefly; setup will continue automatically.'
      : result.state === 'no-readings' || result.state === 'stale' ? 'Waiting for live gyroscope readings…'
      : `${calibrationIsRestore ? 'Checking saved setup' : 'Keep still'}… ${Math.round(result.progress * 100)}%`;
  }
  if (recording && !recentReadings()) stop('Sensor readings paused. Keep the page visible; motion resumes when readings return.');
  if (rehearsal) {
    if (!recentReadings()) finishRehearsal('Rehearsal stopped because sensor readings paused. Keep the screen open and try again.');
    else updateRehearsal(rehearsal.read(now));
  }
  if (pendingRoll && now - pendingRoll.at > 4000) {
    pendingRoll = null; playNotice = 'No roll confirmation yet. Watch the TV before trying again.'; element('delivery').textContent = playNotice; controls();
  }
  startMotion();
  analyze();
}, 30);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    if (savedSetup && !bias && !buttonMode) automaticSetupPending = true;
    startMotion(); controls(); screenAwake.retry(); return;
  }
  setupIntent++;
  automaticMotion.reset();
  if (automaticSetupPending && !buttonMode) bias = null;
  stop('Motion paused while the page is hidden. Return to this page to continue.');
  if (rehearsal) finishRehearsal('Rehearsal stopped because the page was hidden. Keep it open and try again.');
  if (calibration) {
    calibration = null; bias = null; strengthProfile = null;
    calibrationIsRestore = false;
    element('calibration-progress').hidden = true;
    element('motion').textContent = 'Calibration stopped because the page was hidden. Keep it visible and try again.';
    controls();
  }
});
document.addEventListener('pointerdown', () => screenAwake.retry());
window.addEventListener('pagehide', () => {
  setupIntent++;
  pageActive = false;
  automaticMotion.reset();
  if (automaticSetupPending && !buttonMode) bias = null;
  stop('Motion paused.');
  if (rehearsal) finishRehearsal('Rehearsal stopped. Start again when you return.');
  screenAwake.setActive(false); phoneFeedback.setActive(false);
});
window.addEventListener('pageshow', () => { pageActive = true; controls(); screenAwake.retry(); });
if (controllerPreferences.values.touchControls) element('use-buttons').onclick();
{
  if (!buttonMode) element('motion').textContent = savedSetup
    ? 'Your setup is saved. Motion reconnects automatically; tap Resume motion only if your browser asks.'
    : 'Allow motion or use touch controls. Your phone connects automatically.';
  const policy = document.permissionsPolicy ?? document.featurePolicy;
  const allowed = !policy?.allowsFeature || ['accelerometer', 'gyroscope'].every(feature => policy.allowsFeature(feature));
  if (window.isSecureContext && window.DeviceMotionEvent && allowed) {
    // Listening can reuse an existing browser grant. A new grant is requested
    // only by the explicit Resume motion / Enable motion tap handlers.
    window.addEventListener('devicemotion', motion);
  }
}
controls();
sensorStatus(performance.now() + 250);
