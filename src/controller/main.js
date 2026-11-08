import { createSwingDetector } from './classifySwing.js';
import { createBowlingMotionDetector, bowlingTiltAim } from './motionGestures.js';
import { connectSwings } from '../network/swingConnection.js';
import { createInputId } from '../network/inputId.js';
import { createPhoneFeedback, createScreenAwake } from './phoneExperience.js';
import { isTennisState, isStrokeResult } from '../../shared/protocol.js';
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
let strokeNotice = '';
let strokeNoticeUntil = 0;

function renderSport() {
  element('controller-title').textContent = bowling ? 'Your bowling ball' : 'Your racket';
  element('tennis-settings').hidden = bowling;
  element('motion-visual').dataset.sport = bowling ? 'bowling' : 'tennis';
}
renderSport();
const phoneFeedback = createPhoneFeedback({ visual: element('motion-visual'), object: element('motion-object'),
  navigator: globalThis.navigator, document, reducedMotion: window.matchMedia?.('(prefers-reduced-motion: reduce)') });
const screenAwake = createScreenAwake({ navigator: globalThis.navigator, document,
  onState: state => {
    element('wake-status').textContent = state === 'awake' ? 'Screen stays awake while your controller is ready.'
      : state === 'unavailable' || state === 'released' ? 'Your browser could not keep the screen awake. Keep this page visible and check your phone's screen-lock setting.'
      : 'The screen stays awake during play when your browser allows it.';
  },
});

function recentReadings() { return lastReading !== null && performance.now() - lastReading < 1500; }
function publishSetup() {
  const setup = buttonMode ? 'buttons' : enabled ? 'motion' : null;
  element('setup-status').textContent = setup === 'motion' ? 'Motion ready ✓' : setup === 'buttons' ? 'Button controls selected ✓' : 'Set up your controller';
  if (embedded && setup !== lastSetup) {
    lastSetup = setup;
    post({ type: 'wee:controller-setup', setup });
  }
}
function turnReady() { return bowling && gameActive && connected && !lobbyPaused && canRoll && currentPlayer === player && !pendingRoll; }
function cancelArmedRoll() { bowlingDetector = null; armedAt = null; }
function renderPlayState() {
  const tiltAvailable = lastTiltReading !== null && performance.now() - lastTiltReading < 500;
  const setup = buttonMode || enabled;
  element('setup-panel').hidden = setup && !settingsOpen;
  element('controller-options').hidden = setup && !settingsOpen;
  element('play-panel').hidden = !setup || settingsOpen;
  element('timing-details').hidden = bowling || !settingsOpen;
  element('controller-header').hidden = embedded && setup && !settingsOpen;
  element('toggle-settings').hidden = !setup;
  element('toggle-settings').disabled = permissionPending;
  element('toggle-settings').textContent = settingsOpen ? 'Back to controller' : 'Controller settings';
  element('toggle-settings').ariaExpanded = String(settingsOpen);
  element('stop').hidden = !setup || buttonMode || !gameActive || !settingsOpen;
  let state = 'ready';
  let status = buttonMode ? 'Buttons ready' : 'Motion ready';
  let title = 'You're ready';
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
    help = 'Open Controller settings and reconnect.';
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
      help = serving ? 'Swing when you're ready to serve.' : 'Get ready to return. Watch the ball on the TV.';
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
  const notice = setupError || playNotice || (performance.now() < strokeNoticeUntil ? strokeNotice : '');
  for (const [id, text] of [['play-status', status], ['play-title', title], ['play-help', help], ['play-notice', notice]]) {
    if (element(id).textContent !== text) element(id).textContent = text;
  }
  element('play-panel').dataset.state = state;
  element('play-notice').hidden = !notice || (!setupError && (!gameActive || lobbyPaused || !connected));
  element('record').hidden = !setup || buttonMode || !gameActive || lobbyPaused || !connected || recording || settingsOpen || state === 'finished';
  element('record').disabled = !gameActive || lobbyPaused || !connected || !enabled || recording || !recentReadings();
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
  const readyInLobby = !gameActive && enabled && !buttonMode && connected && !settingsOpen && pageActive && !document.hidden && state === 'ready';
  screenAwake.setActive(activeController || readyInLobby);
  phoneFeedback.setActive(activeController);
}
function controls() {
  element('setup-next').textContent = settingsOpen ? 'Return to the controller when you're ready.' : gameActive
    ? 'Motion starts automatically once setup is complete and everyone is connected.'
    : 'Once motion is ready, press Ready above.';
  element('enable').disabled = permissionPending || (enabled && recentReadings());
  element('enable').textContent = enabled ? 'Retry motion access' : 'Enable motion';
  element('stop').disabled = !gameActive || !motionWanted;
  for (const id of ['forehand', 'backhand']) element(id).disabled = !gameActive || lobbyPaused || !connected || tennisState?.phase === 'complete';
  element('roll').disabled = !turnReady() || !buttonMode;
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
    : event.receivers ? 'Delivered to game.' : 'No game connected. Check the TV.';
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
  onAck: event => {
    deliveryResult(event);
  },
});
function send(label, power = 0.5) {
  if (bowling || lobbyPaused || !gameActive || !connected || settingsOpen || document.hidden || tennisState?.phase === 'complete') return;
  strokeNoticeUntil = 0;
  const sent = connection.sendSwing(label, element('hand').value, power);
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
function analyze(sample) {
  if (!recording || bowling) return;
  const swing = stream?.push(sample);
  if (!swing) return;
  element('latest').textContent = swing.label;
  feedbackUntil = performance.now() + 1500;
  send(swing.label, 0.5);
}
function stop(message = 'Motion paused. Tap Resume motion when you are ready.', user = false) {
  if (user) motionWanted = false;
  const wasRecording = recording;
  recording = false;
  lastTiltReading = null;
  stream = null;
  cancelArmedRoll();
  if (wasRecording || user) element('motion').textContent = message;
  controls();
}
function startMotion() {
  if (!bowling && tennisState?.phase === 'complete') return;
  if (recording || settingsOpen || !motionWanted || buttonMode || !enabled || !gameActive || lobbyPaused || !connected || document.hidden || !recentReadings()) return;
  stream = bowling ? null : createSwingDetector();
  started = performance.now();
  recording = true;
  element('latest').textContent = '';
  playNotice = '';
  element('motion').textContent = bowling ? 'Motion is live. Arm a roll when it is your turn.' : 'Motion is live. Swing to play.';
  controls();
}
window.addEventListener('message', event => {
  if (!embedded || event.source !== window.parent || event.origin !== location.origin) return;
  const data = event.data;
  if (data?.type === 'wee:stroke-result' && !bowling && isStrokeResult(data) &&
      data.gameId === tennisGameId && data.player === player && connected && gameActive && !lobbyPaused) {
    if (data.result !== 'hit') { strokeNotice = data.reason; strokeNoticeUntil = performance.now() + 1800; }
    renderPlayState(); return;
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
  if (data?.type === 'wee:tennis-state' && !bowling && isTennisState(data)) {
    tennisState = { phase: data.phase, server: data.server, winner: data.winner, practice: data.practice, serveAttempt: data.serveAttempt };
    if (data.phase === 'complete') stop('Match complete. See the TV for results.');
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
    stop('Switching games…');
    bowling = data.sport === 'bowling';
    canRoll = false; currentPlayer = null; bowlingPhase = 'waiting';
    pendingRoll = null; bowlingReadout = null; liveAim = 0;
    element('aim').value = '0'; element('aim').oninput();
    settingsOpen = false; playNotice = ''; feedbackUntil = 0;
    tennisState = null; strokeNoticeUntil = 0;
    renderSport();
    lastSetup = undefined;
  }
  if (data.gameId !== tennisGameId || !data.playing) {
    tennisState = null; tennisGameId = data.gameId; strokeNoticeUntil = 0;
  }
  if (data.connected && !wasConnected) lastSetup = undefined;
  connected = data.connected === true;
  wasConnected = connected;
  gameActive = data.playing === true;
  lobbyPaused = data.paused;
  manuallyPaused = data.manuallyPaused === true;
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
  if (!recording) return;
  const ag = event.accelerationIncludingGravity;
  const accelMag = ag ? Math.hypot(ag.x ?? 0, ag.y ?? 0, ag.z ?? 0) : 0;
  const sample = { timeMs: now - started, accelMag };
  phoneFeedback.motion(sample, now);
  if (bowling) {
    if (!bowlingDetector && turnReady()) {
      const tilt = bowlingTiltAim(event.accelerationIncludingGravity, Math.hypot(rate.alpha, rate.beta, rate.gamma));
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
  } else { analyze(sample); }
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
    const permission = typeof DeviceMotionEvent.requestPermission === 'function'
      ? await DeviceMotionEvent.requestPermission() : 'granted';
    if (!currentSetupIntent(intent)) return;
    if (permission !== 'granted') throw new Error('Motion access was denied. Allow Motion & Orientation in this site's browser permissions, then reload and try again. Button controls are available now.');
    window.addEventListener('devicemotion', motion);
    enabled = true;
    motionWanted = true;
    permissionAt = performance.now();
    element('motion').textContent = 'Motion enabled. Swing to play when the match starts.';
  } finally {
    if (permissionIntent === intent) { permissionPending = false; permissionIntent = null; controls(); }
  }
}
function showMotionError(error) {
  element('motion').textContent = error.name === 'NotAllowedError'
    ? 'Motion permission needs a direct tap. Open this page in Safari or Chrome, tap Enable motion and allow access.' : error.message;
  element('sensor-status').dataset.state = 'error';
}
element('enable').onclick = async () => {
  const intent = ++setupIntent;
  try {
    await requestMotion(intent);
  } catch (error) { if (currentSetupIntent(intent)) showMotionError(error); }
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
  setupIntent++;
  stop(undefined, true);
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
  } else if (recentReadings()) status.textContent = `Motion connected · ${validReadings} readings received`;
  else if (enabled && now - permissionAt > 2500) {
    status.textContent = eventsSeen ? 'Motion events arrived without sensor data. Check browser permissions or use buttons.' : 'Permission allowed, but no readings arrived. Keep this page visible and check browser motion permissions.';
    status.dataset.state = 'error';
  } else status.textContent = enabled ? 'Waiting for sensor readings…' : 'Tap Enable motion to allow sensors.';
  element('sensor-detail').textContent = `${window.isSecureContext ? 'Secure context' : 'Insecure context'} · ${eventsSeen} events · ${validReadings} valid readings${latestRate ? ` · last reading ${Math.round(now - lastReading)} ms ago` : ''}`;
  element('detector-state').textContent = !recording ? 'Motion idle' : bowling ? bowlingDetector ? 'Armed for one underhand delivery' : 'Motion live · arm your roll on your turn'
    : 'Motion live · ready for a swing';
  renderPlayState();
}
setInterval(() => {
  const now = performance.now();
  sensorStatus(now);
  if (recording && !recentReadings()) stop('Sensor readings paused. Keep the page visible; motion resumes when readings return.');
  if (armedAt !== null && now - armedAt > 6000) {
    cancelArmedRoll(); playNotice = 'Roll timed out. Arm again when you are ready.'; element('motion').textContent = playNotice; controls();
  }
  if (pendingRoll && now - pendingRoll.at > 4000) {
    pendingRoll = null; playNotice = 'No roll confirmation yet. Watch the TV before trying again.'; element('delivery').textContent = playNotice; controls();
  }
  startMotion();
}, 30);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) { startMotion(); controls(); screenAwake.retry(); return; }
  setupIntent++;
  stop('Motion paused while the page is hidden. Return to this page to continue.');
});
document.addEventListener('pointerdown', () => screenAwake.retry());
window.addEventListener('pagehide', () => {
  setupIntent++;
  pageActive = false;
  screenAwake.setActive(false); phoneFeedback.setActive(false);
});
window.addEventListener('pageshow', () => { pageActive = true; controls(); screenAwake.retry(); });
{
  const policy = document.permissionsPolicy ?? document.featurePolicy;
  const allowed = !policy?.allowsFeature || ['accelerometer', 'gyroscope'].every(feature => policy.allowsFeature(feature));
  if (window.isSecureContext && window.DeviceMotionEvent && allowed) {
    window.addEventListener('devicemotion', motion);
  }
  element('motion').textContent = 'Tap Enable motion and allow access to start playing.';
}
controls();
sensorStatus(performance.now() + 250);
