import { createSwingDetector } from './classifySwing.js';
import { createBowlingMotionDetector, bowlingTiltAim } from './motionGestures.js';
import { tennisPower, tennisStrength } from './tennisPower.js';
import { createStrengthRehearsal } from './strengthRehearsal.js';
import { connectSwings } from '../network/swingConnection.js';
import { createInputId } from '../network/inputId.js';
import { createCalibrationSession } from './calibration.js';
import { createCalibrationMemory, createCalibrationResume } from './calibrationMemory.js';
import { createPhoneFeedback, createScreenAwake } from './phoneExperience.js';
import { isTennisState, isStrokeResult, PHASES } from '../../shared/protocol.js';
import { createOrientationCalibration, createOrientationSource } from './orientationCalibration.js';
import { createTimingStats } from '../network/timingStats.js';
import '../theme.js';
import '../../client/src/styles/tokens.css';
import '../play.css';
import './controller.css';

const element = id => document.getElementById(id);
const embedded = window.parent !== window;
const query = new URLSearchParams(location.search);
let bowling = query.get('sport') === 'bowling';
const room = query.get('room');
if (!/^[a-zA-Z0-9-]{6,40}$/.test(room ?? '')) throw new Error('Open the controller link from the game to join its room.');
const player = Math.max(1, Math.min(4, Number(query.get('player')) || 1));
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
let automaticSetupPending = true;
if (savedSetup) element('hand').value = savedSetup.hand;
let strengthProfile = null;
let rehearsal = null;
let rehearsalStream = null;
let rehearsalStarted = 0;
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
let tennisState = null;
let tennisGameId = null;
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
let pageActive = true;
let orientationCalibration = null;
let orientationSource = null;
let netOrientation = null;
let currentNormal = null;
const timingStats = { recognition: createTimingStats(), delivery: createTimingStats(), contact: createTimingStats() };
const pendingTimings = new Map();
let nextRecognitionMs;
let strokeNotice = '';
let strokeNoticeUntil = 0;
function renderTiming() {
  for (const [key, label] of [['recognition', 'Motion confirmation'], ['delivery', 'Delivery acknowledgement round trip'], ['contact', 'TV arrival to contact']]) {
    const sample = timingStats[key].summary();
    if (key === 'contact' && !embedded) {
      element('timing-contact').textContent = 'TV arrival to contact: available when playing through the homepage lobby.';
      continue;
    }
    element(`timing-${key}`).textContent = `${label}: ${sample ? `median ${Math.round(sample.median)} ms · p95 ${Math.round(sample.p95)} ms · ${sample.count} ${sample.count === 1 ? 'sample' : 'samples'}` : 'waiting for samples'}.`;
  }
}
renderTiming();
function renderSport() {
  element('controller-title').textContent = bowling ? 'Your bowling ball' : 'Your racket';
  element('tennis-settings').hidden = bowling;
  element('motion-visual').dataset.sport = bowling ? 'bowling' : 'tennis';
}
renderSport();
function startOrientationCalibration() {
  if (orientationCalibration || !orientationSource) return;
  element('motion').textContent = 'Hold your phone with the screen facing the net and keep still.';
  orientationCalibration = createOrientationCalibration({
    source: orientationSource,
    onProgress(progress, state) {
      post({ type: 'wee:calibration-progress', slot: player - 1, progress, state });
      if (state === 'moving') {
        element('motion').textContent = 'Movement detected — keep still.';
      } else if (state === 'settling') {
        element('motion').textContent = 'Hold still…';
      } else if (state === 'calibrating') {
        element('motion').textContent = `Calibrating… ${Math.round(progress * 100)}%`;
      }
    },
    onDone(normal, quat) {
      orientationCalibration = null;
      // Restore live currentNormal updates now that calibration is done
      if (orientationSource) orientationSource.onReading = (_, n) => { currentNormal = n; };
      netOrientation = { normal };
      post({ type: 'wee:calibration-done', slot: player - 1, netOrientation: { normal, quat } });
      element('motion').textContent = 'Calibrated ✓ Net direction saved.';
    },
  });
  orientationCalibration.start();
}
const phoneFeedback = createPhoneFeedback({ visual: element('motion-visual'), object: element('motion-object'),
  navigator: globalThis.navigator, document, reducedMotion: window.matchMedia?.('(prefers-reduced-motion: reduce)') });
const screenAwake = createScreenAwake({ navigator: globalThis.navigator, document,
  onState: state => {
    element('wake-status').textContent = state === 'awake' ? 'Screen stays awake while your controller is ready.'
      : state === 'unavailable' || state === 'released' ? 'Your browser could not keep the screen awake. Keep this page visible and check your phone’s screen-lock setting.'
      : 'The screen stays awake during play when your browser allows it.';
  },
});

function recentReadings() { return lastReading !== null && performance.now() - lastReading < 1500; }
function publishSetup() {
  const setup = buttonMode ? 'buttons' : bias && !rehearsal ? 'motion' : null;
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
  element('timing-details').hidden = bowling || !settingsOpen;
  element('strength-panel').hidden = bowling || buttonMode || !bias || !settingsOpen;
  element('tune-strength').disabled = !bias || !recentReadings() || Boolean(rehearsal) || Boolean(calibration);
  element('tune-strength').textContent = strengthProfile ? 'Retune power' : 'Tune power';
  element('skip-strength').textContent = rehearsal ? 'Cancel rehearsal' : 'Use default power';
  element('strength-progress').hidden = !rehearsal;
  element('controller-header').hidden = embedded && setup && !settingsOpen;
  element('toggle-settings').hidden = !setup;
  element('toggle-settings').disabled = Boolean(calibration) || Boolean(rehearsal) || permissionPending;
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
    help = manuallyPaused ? 'Player 1 or the TV can resume the match from game options.'
      : 'Waiting for everyone to reconnect and finish setup.';
  } else if (setupError) {
    state = 'paused'; status = 'Setup needed'; title = 'Setup not saved';
    help = 'Open Controller settings and calibrate again, or reconnect.';
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
  const notice = setupError || playNotice || (performance.now() < strokeNoticeUntil ? strokeNotice : '');
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
  const activeController = setup && gameActive && connected && !lobbyPaused && !settingsOpen && pageActive && !document.hidden && (state === 'playing' || state === 'waiting');
  const readyInLobby = !gameActive && Boolean(bias) && !buttonMode && connected && !settingsOpen && pageActive && !document.hidden && state === 'ready';
  const rehearsing = Boolean(rehearsal) && connected && pageActive && !document.hidden;
  screenAwake.setActive(activeController || readyInLobby || rehearsing);
  phoneFeedback.setActive(activeController);
}
function controls() {
  element('setup-next').textContent = settingsOpen ? 'Return to the controller when you’re ready.' : gameActive
    ? 'Motion starts automatically once setup is complete and everyone is connected.'
    : 'Once motion is ready, press Ready above.';
  element('enable').disabled = permissionPending || (enabled && recentReadings());
  element('enable').textContent = enabled ? 'Retry motion access' : 'Enable motion';
  element('calibrate').disabled = permissionPending || Boolean(calibration);
  element('calibrate').textContent = calibration ? calibrationIsRestore ? 'Checking motion…' : 'Calibrating…'
    : bias ? 'Reset motion setup' : savedSetup ? 'Resume motion' : 'Enable motion';
  element('stop').disabled = !gameActive || !motionWanted;
  for (const id of ['hand', 'response', 'stroke-mode', 'suppress-returns']) element(id).disabled = recording || Boolean(calibration) || Boolean(rehearsal);
  for (const id of ['forehand', 'backhand']) element(id).disabled = !gameActive || lobbyPaused || !connected || tennisState?.phase === 'complete';
  element('roll').disabled = !turnReady() || (!buttonMode && !bias);
  element('arm-roll').disabled = !turnReady() || !recording || Boolean(bowlingDetector);
  element('arm-roll').textContent = bowlingDetector ? 'Armed · swing forward' : 'Arm motion roll';
  publishSetup();
  renderPlayState();
}
function deliveryResult(event, kind = 'swing') {
  element('delivery').textContent = event.ok === false
    ? event.error === 'network-busy' ? 'Connection busy. This swing was not sent; try your next swing when it clears.'
      : event.error === 'game-loading' ? 'The game is loading. Try again when it appears on the TV.'
      : event.error === 'not-your-turn' || event.error === 'roll-rejected' ? 'Wait until the TV and your controller show your turn.'
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
function send(label, power = 0.5, recognitionMs, netNormal, swingNormal) {
  if (bowling || lobbyPaused || !gameActive || !connected || settingsOpen || rehearsal || document.hidden || tennisState?.phase === 'complete') return;
  strokeNoticeUntil = 0;
  nextRecognitionMs = recognitionMs;
  const sent = connection.sendSwing(label, element('hand').value, power, netNormal, swingNormal);
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
  if (!bowling && tennisState?.phase === 'complete') return;
  if (recording || settingsOpen || rehearsal || !motionWanted || !bias || buttonMode || calibration || !enabled || !gameActive || lobbyPaused || !connected || document.hidden || !recentReadings()) return;
  stream = bowling ? null : createSwingDetector();
  started = performance.now();
  recording = true;
  element('latest').textContent = '';
  playNotice = '';
  element('motion').textContent = bowling ? 'Motion is live. Arm a roll when it is your turn.' : 'Motion is live. Swing to play; use Stop motion to pause your detector.';
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
  rehearsalStream = createSwingDetector();
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
  strengthProfile = null;
  // Gyro bias is hand-independent once verified, but an unverified stored
  // setup must never restore another hand's power profile or selection.
  savedSetup = null; automaticSetupPending = false;
  calibrationMemory.clear();
  rememberCalibration();
  finishRehearsal('Playing hand changed. Default power is ready.');
};
window.addEventListener('message', event => {
  if (!embedded || event.source !== window.parent || event.origin !== location.origin) return;
  const data = event.data;
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
  // are we star
  if (data?.type === 'wee:tennis-state' && !bowling && isTennisState(data)) {
    tennisState = { phase: data.phase, server: data.server, winner: data.winner, practice: data.practice, serveAttempt: data.serveAttempt };
    if (data.phase === 'complete') stop('Match complete. See the TV for results.');
    // why are we calling startMotion again
    else startMotion();
    controls(); return;
  }
  if (data?.type === 'wee:roll-ack' && bowling) {
    if (!pendingRoll || (data.result?.id && data.result.id !== pendingRoll.id)) return;
    pendingRoll = null;
    deliveryResult(data.result ?? { ok: false }, 'roll');
    controls(); return;
  }
  if (data?.type !== 'wee:lobby-state' || typeof data.paused !== 'boolean') return;
  if (['tennis', 'bowling'].includes(data.sport) && bowling !== (data.sport === 'bowling')) {
    // The same controller document owns permission and gyro zero across sports.
    // Drop sport-specific input, but never require another calibration to switch.
    stop('Switching games…');
    if (rehearsal) finishRehearsal('Power tuning stopped. Your saved power is kept.');
    bowling = data.sport === 'bowling';
    canRoll = false; currentPlayer = null; bowlingPhase = 'waiting';
    pendingRoll = null; bowlingReadout = null; liveAim = 0;
    element('aim').value = '0'; element('aim').oninput();
    element('strength-panel').open = false;
    settingsOpen = false; playNotice = ''; feedbackUntil = 0;
    tennisState = null; pendingTimings.clear(); strokeNoticeUntil = 0;
    renderSport();
    // The lobby may have reset readiness for its new sport. Re-publish the
    // already verified controller mode without dropping it to an unset state.
    lastSetup = undefined;
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
  if (data.phase === PHASES.CALIBRATION && !orientationCalibration && enabled) startOrientationCalibration();
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
  if (automaticSetupPending && !calibration && !bias && !buttonMode && !document.hidden && pageActive) {
    // Actual sensor data proves the browser already allows this page to listen.
    // Merely finding a stored profile is never sufficient.
    enabled = true;
    beginCalibration(Boolean(savedSetup));
  }
  calibration?.push(rate, now);
  if ((!recording && !rehearsal) || !bias) return;
  const ag = event.accelerationIncludingGravity;
  const accelMag = ag ? Math.hypot(ag.x ?? 0, ag.y ?? 0, ag.z ?? 0) : 0;
  const sample = { timeMs: now - (rehearsal ? rehearsalStarted : started),
    accelMag, rotationAlpha: rate.alpha - bias.alpha,
    rotationBeta: rate.beta - bias.beta, rotationGamma: rate.gamma - bias.gamma,
    acceleration: event.acceleration, netOrientation, currentNormal };
  if (rehearsal) {
    const swing = rehearsalStream?.push(sample);
    if (swing && rehearsal) updateRehearsal(rehearsal.accept(swing, now));
    return;
  }
  phoneFeedback.motion(sample, now);
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
  } else {
    const swing = stream?.push(sample);
    if (swing) {
      const power = tennisPower(swing.peakRotation, strengthProfile, swing.label);
      element('latest').textContent = `${swing.label} · ${tennisStrength(power)}`;
      feedbackUntil = performance.now() + 1500;
      // this would send on my phone, not my computer
      console.log("sending net orientation normal: ", netOrientation?.normal); 
      console.log("sending the current normal: ", currentNormal); 
      send(swing.label, power, undefined, netOrientation?.normal, currentNormal);
    }
  }
}
function currentSetupIntent(intent) { return intent === setupIntent && pageActive && !document.hidden; }
async function requestMotion(intent) {
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
    const permission = typeof DeviceMotionEvent.requestPermission === 'function'
      ? await DeviceMotionEvent.requestPermission() : 'granted';
    if (!currentSetupIntent(intent)) return;
    if (permission !== 'granted') throw new Error('Motion access was denied. Allow Motion & Orientation in this site’s browser permissions, then reload and try again. Button controls are available now.');
    window.addEventListener('devicemotion', motion);
    enabled = true;
    permissionAt = performance.now();
    element('motion').textContent = recentReadings() ? 'Sensor readings received. Hold still for a moment while motion gets ready.' : 'Permission allowed. Waiting for actual sensor readings…';
  } finally {
    if (permissionIntent === intent) { permissionPending = false; permissionIntent = null; controls(); }
  }
}
function showMotionError(error) {
  element('motion').textContent = error.name === 'NotAllowedError'
    ? 'Motion permission needs a direct tap. Open this page in Safari or Chrome, tap Enable motion and allow access.' : error.message;
  element('sensor-status').dataset.state = 'error';
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
  orientationSource?.stop(); orientationSource = null;
  currentNormal = null;
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
element('enable').onclick = async () => {
  const intent = ++setupIntent;
  try {
    await requestMotion(intent);
    if (!currentSetupIntent(intent)) return;
    if (!bias && !calibration) beginCalibration(Boolean(savedSetup));
  } catch (error) { if (currentSetupIntent(intent)) showMotionError(error); }
};
element('calibrate').onclick = async () => {
  const intent = ++setupIntent;
  if (rehearsal) finishRehearsal('Rehearsal stopped for recalibration.');
  stop();
  try {
    // One tap also requests permission; disabled Calibrate used to hide this step.
    if (!enabled || !recentReadings()) await requestMotion(intent);
    if (!currentSetupIntent(intent)) return;
    beginCalibration(Boolean(savedSetup) && !bias);
  } catch (error) { if (currentSetupIntent(intent)) showMotionError(error); }
};
element('record').onclick = () => { motionWanted = true; startMotion(); };
element('stop').onclick = () => stop(undefined, true);
element('toggle-settings').onclick = () => {
  if (rehearsal) return;
  settingsOpen = !settingsOpen;
  if (settingsOpen) stop('Motion pauses while controller settings are open.');
  else startMotion();
  controls();
};
element('use-buttons').onclick = () => {
  setupIntent++;
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
  } else status.textContent = enabled ? 'Waiting for sensor readings…' : 'Tap Enable motion to allow sensors. Setup completes automatically while you hold still.';
  element('sensor-detail').textContent = `${window.isSecureContext ? 'Secure context' : 'Insecure context'} · ${eventsSeen} events · ${validReadings} valid gyro readings${latestRate ? ` · ${Math.round(Math.hypot(...Object.values(latestRate)))}°/s · last reading ${Math.round(now - lastReading)} ms ago` : ''}`;
  element('detector-state').textContent = !recording ? 'Motion idle' : bowling ? bowlingDetector ? 'Armed for one underhand delivery' : 'Motion live · arm your roll on your turn'
    : 'Motion live · ready for a swing';
  renderPlayState();
}
setInterval(() => {
  const now = performance.now();
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
        // Start orientation source now that gyro bias is known
        if (!orientationSource) {
          orientationSource = createOrientationSource({ bias });
          orientationSource.onReading = (_, n) => { currentNormal = n; };
          orientationSource.start();
        }
        if (restored) strengthProfile = savedSetup?.strength ?? null;
        // Reusing a stored bias is not a new stationary verification. Keep its
        // original expiry so repeated reloads cannot extend stale calibration.
        verifiedAt = restored ? savedSetup.verifiedAt : Date.now();
        savedSetup = null;
        rememberCalibration();
        motionWanted = true;
        settingsOpen = false;
        element('motion').textContent = restored ? 'Your setup is ready again. Motion starts with the match.'
          : gameActive ? 'Calibrated. Motion starts when the match is ready.' : 'Calibrated. Press Ready above; motion will start with the match.';
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
  if (armedAt !== null && now - armedAt > 6000) {
    cancelArmedRoll(); playNotice = 'Roll timed out. Arm again when you are ready.'; element('motion').textContent = playNotice; controls();
  }
  if (pendingRoll && now - pendingRoll.at > 4000) {
    pendingRoll = null; playNotice = 'No roll confirmation yet. Watch the TV before trying again.'; element('delivery').textContent = playNotice; controls();
  }
  startMotion();
}, 30);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    if (savedSetup && !bias && !buttonMode) automaticSetupPending = true;
    startMotion(); controls(); screenAwake.retry(); return;
  }
  setupIntent++;
  stop('Motion paused while the page is hidden. Return to this page to continue.');
  if (rehearsal) finishRehearsal('Rehearsal stopped because the page was hidden. Keep it open and try again.');
  if (calibration) {
    calibration = null; bias = null; strengthProfile = null;
    orientationSource?.stop(); orientationSource = null; currentNormal = null;
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
  if (rehearsal) finishRehearsal('Rehearsal stopped. Start again when you return.');
  screenAwake.setActive(false); phoneFeedback.setActive(false);
});
window.addEventListener('pageshow', () => { pageActive = true; controls(); screenAwake.retry(); });
{
  element('motion').textContent = savedSetup
    ? 'Your setup is saved. Motion reconnects automatically; tap Resume motion only if your browser asks.'
    : 'Tap Enable motion and allow access. Hold still briefly; then you’re ready for every game.';
  const policy = document.permissionsPolicy ?? document.featurePolicy;
  const allowed = !policy?.allowsFeature || ['accelerometer', 'gyroscope'].every(feature => policy.allowsFeature(feature));
  if (window.isSecureContext && window.DeviceMotionEvent && allowed) {
    // Listening can reuse an existing browser grant. A new grant is requested
    // only by the explicit Resume motion / Enable motion tap handlers.
    window.addEventListener('devicemotion', motion);
  }
  // currentNormal is now updated via orientationSource.onReading (set in the
  // interval callback after gyro bias calibration completes)
}
controls();
sensorStatus(performance.now() + 250);
