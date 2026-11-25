import {focusControllerSection} from './focusSection.js';
import {createSwingStream} from './swingStream.js';
import {createBowlingAimStream} from './bowlingAim.js';
import {createControllerPreferences} from './preferences.js';
import {createTutorialDetector} from './tutorialMoves.js';
import {tennisStrength} from './tennisPower.js';
import {createStrengthRehearsal} from './strengthRehearsal.js';
import {connectSwings} from '../network/swingConnection.js';
import {createInputId} from '../network/inputId.js';
import {createCalibrationMemory} from './calibrationMemory.js';
import {createPhoneFeedback, createScreenAwake} from './phoneExperience.js';
import {isTennisState, isStrokeResult, PHASES} from '../../shared/protocol.js';
import {createTimingStats} from '../network/timingStats.js';
import {browserDiagnostics} from '../../shared/diagnostics.js';
import {createMotionSDK} from './motionSDK.js';
import {createTennisDetector} from './tennisDetector.js';
import {createBowlingDetector} from './bowlingDetector.js';
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
if (!/^[a-zA-Z0-9-]{6,40}$/.test(room ?? ''))
  throw new Error('Open the controller link from the game to join its room.');
const player = Math.max(
  1,
  Math.min(8, Math.trunc(Number(query.get('player'))) || 1),
);
const post = data => {
  if (embedded) window.parent.postMessage(data, location.origin);
};
const lobbyCode = query.get('lobby');
element('room').textContent =
  lobbyCode && embedded ? `Lobby ${lobbyCode} · P${player}` : `Room: ${room}`;
if (embedded)
  element('connection-help').textContent =
    'Your controller is connected through the homepage lobby.';
if (embedded && window.ResizeObserver) {
  new ResizeObserver(entries =>
    post({
      type: 'wee:controller-height',
      height: Math.ceil(entries[0].target.getBoundingClientRect().height) + 2,
    }),
  ).observe(document.querySelector('main'));
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
let motionReady = false;
let setupStorage;
let fallbackSetupStorage;
try {
  setupStorage = window.localStorage;
} catch {
  /* Fall back to this tab. */
}
try {
  fallbackSetupStorage = window.sessionStorage;
} catch {
  /* Setup still works without storage. */
}
const calibrationMemory = createCalibrationMemory(
  setupStorage,
  Date.now,
  fallbackSetupStorage,
);
let savedSetup = calibrationMemory.read();
const controllerPreferences = createControllerPreferences(
  setupStorage ?? fallbackSetupStorage,
);
let motionSensitivity = controllerPreferences.values.sensitivity;
element('hand').value = savedSetup?.hand ?? controllerPreferences.values.hand;
let strengthProfile = null;
let rehearsal = null;
let rehearsalStream = null;
let rehearsalStarted = 0;
let sdkActive = false;
let motionDetector = null; // the active tennis or bowling detector instance
let motionWanted = false;
let userPaused = false;
let lastReading = null;
let latestRate = null;
let validReadings = 0;
let buttonMode = false;
let lastSetup, lastSetupReason;
let setupRequest = 0,
  pendingSetup = null,
  setupSentAt = 0,
  setupRetryAt = 0;
let wasConnected = false;
let canRoll = false;
let currentPlayer = null;
let bowlingPhase = 'waiting';
let tennisState = null;
let tennisGameId = null;
let bowlingTurn = 0;
let inputGeneration = null;
let pendingRoll = null;
let sensorUpdatedAt = 0;
let settingsOpen = false;
let playNotice = '';
let setupError = '';
let feedbackUntil = 0;
let liveAim = 0;
const aimStream = createBowlingAimStream(event =>
  post({type: 'wee:player-aim', event}),
);
let lockedAim = null;
let bowlingReadout = null;
let pageActive = true;
let lobbyPhase = null;
// The move this player is learning right now, and the detector watching for it.
let tutorial = null;
let tutorialDetector = null;
const timingStats = {
  recognition: createTimingStats(),
  delivery: createTimingStats(),
  contact: createTimingStats(),
};
const pendingTimings = new Map();
let nextRecognitionMs;
let strokeNotice = '';
let strokeNoticeUntil = 0;
function renderTiming() {
  for (const [key, label] of [
    ['recognition', 'Motion confirmation'],
    ['delivery', 'Delivery acknowledgement round trip'],
    ['contact', 'TV arrival to contact'],
  ]) {
    const sample = timingStats[key].summary();
    if (key === 'contact' && !embedded) {
      setView(
        'timing-contact',
        'textContent',
        'TV arrival to contact: available when playing through the homepage lobby.',
      );
      continue;
    }
    setView(
      `timing-${key}`,
      'textContent',
      `${label}: ${sample ? `median ${Math.round(sample.median)} ms · p95 ${Math.round(sample.p95)} ms · ${sample.count} ${sample.count === 1 ? 'sample' : 'samples'}` : 'waiting for samples'}.`,
    );
  }
}
renderTiming();
function renderSport() {
  element('controller-title').textContent = bowling
    ? 'Your bowling ball'
    : 'Your racket';
  element('tennis-settings').hidden = bowling;
  element('motion-visual').dataset.sport = bowling ? 'bowling' : 'tennis';
}
renderSport();
const phoneFeedback = createPhoneFeedback({
  visual: element('motion-visual'),
  object: element('motion-object'),
  navigator: globalThis.navigator,
  document,
  reducedMotion: window.matchMedia?.('(prefers-reduced-motion: reduce)'),
});
function renderPreferences() {
  const preferences = controllerPreferences.values;
  motionSensitivity = preferences.sensitivity;
  element('haptics').checked = preferences.haptics;
  element('motion-sensitivity').value = String(preferences.sensitivity);
  element('motion-sensitivity-value').textContent =
    `${preferences.sensitivity}×`;
  phoneFeedback.setHaptics(preferences.haptics);
}
renderPreferences();
// SDK: handles sensor ingestion, automatic calibration, orientation, and
// routes calibrated samples to the active game detector.
function handleEmit(struct) {
  if (bowling) {
    if (struct.type === 'aim') {
      liveAim = struct.aim;
      element('aim').value = String(liveAim);
      showDeliveryValue('aim', liveAim);
      if (struct.locked) lockedAim = struct.aim;
      publishAim();
    } else if (struct.type === 'delivery') {
      bowlingReadout = {power: struct.power, spin: struct.spin};
      showBowlingReadout(bowlingReadout);
      feedbackUntil = performance.now() + 3500;
      roll(struct.power, struct.spin);
    }
    renderPlayState();
  } else {
    // Tennis swing struct: { label, power, placement, recognitionMs, swing }
    element('latest').textContent =
      `${struct.label} · ${tennisStrength(struct.power)}`;
    feedbackUntil = performance.now() + 1500;
    element('timing').textContent = struct.swing?.simple
      ? 'Simple motion mapping · your selected shot.'
      : struct.swing?.early || struct.swing?.fast
        ? `Recognized in ${Math.round(struct.recognitionMs)} ms, before network and game response.`
        : 'Stroke classified after completion.';
    if (struct.recognitionMs != null) {
      motionDiagnostics.count('swing.recognized');
      motionDiagnostics.observe('swing.recognitionMs', struct.recognitionMs);
    }
    send(struct.label, struct.power, struct.recognitionMs, struct.placement);
  }
}
const sdk = createMotionSDK({
  onEmit: handleEmit,
  onReady() {
    motionReady = true;
    if (savedSetup?.hand === element('hand').value) {
      strengthProfile = savedSetup.strength ?? null;
      if (strengthProfile)
        element('strength-status').textContent =
          'Your comfortable strength was restored for this playing hand.';
    }
    savedSetup = null;
    if (!userPaused) motionWanted = true;
    element('motion').textContent = 'Motion ready. Watch the TV.';
    controls();
    startMotion();
  },
  onState,
  onSample(sample) {
    const now = performance.now();
    lastReading = now;
    validReadings++;
    latestRate = {
      alpha: sample.rotationAlpha,
      beta: sample.rotationBeta,
      gamma: sample.rotationGamma,
    };
    if (rehearsal) {
      rehearsalStream?.push(sample);
      for (const swing of rehearsalStream?.analyze() ?? []) {
        if (rehearsal) updateRehearsal(rehearsal.accept(swing, now));
      }
      return;
    }
    if (sdkActive && !bowling && !tutorialActive())
      phoneFeedback.motion(sample, now);
    if (tutorialActive()) {
      const accelWithGravity = {
        x: (sample.acceleration?.x ?? 0) + (sample.gravity?.x ?? 0),
        y: (sample.acceleration?.y ?? 0) + (sample.gravity?.y ?? 0),
        z: (sample.acceleration?.z ?? 0) + (sample.gravity?.z ?? 0),
      };
      const attempt = tutorialDetector?.push(sample, accelWithGravity);
      if (attempt)
        post({
          type: 'wee:tutorial-attempt',
          step: tutorial.step,
          move: tutorial.move,
          ...attempt,
        });
    }
  },
});
function onState() {}
element('haptics').onchange = () => {
  controllerPreferences.update({haptics: element('haptics').checked});
  renderPreferences();
};
element('motion-sensitivity').oninput = () => {
  if (sdkActive || rehearsal) return;
  controllerPreferences.update({
    sensitivity: Number(element('motion-sensitivity').value),
  });
  renderPreferences();
};
const screenAwake = createScreenAwake({
  navigator: globalThis.navigator,
  document,
  onState: state => {
    element('wake-status').textContent =
      state === 'awake'
        ? 'Screen stays awake while your controller is ready.'
        : state === 'unavailable' || state === 'released'
          ? 'Your browser could not keep the screen awake. Keep this page visible and check your phone’s screen-lock setting.'
          : 'The screen stays awake during play when your browser allows it.';
  },
});

function recentReadings() {
  return lastReading !== null && performance.now() - lastReading < 1500;
}
function publishSetup() {
  const setup =
    !pageActive || document.hidden
      ? null
      : buttonMode
        ? 'buttons'
        : motionReady && !rehearsal
          ? 'motion'
          : null;
  setView(
    'setup-status',
    'textContent',
    setup === 'motion'
      ? 'Motion ready'
      : setup === 'buttons'
        ? 'Touch controls ready'
        : 'Connecting motion',
  );
  const now = performance.now();
  const reason = !pageActive || document.hidden ? 'background' : undefined;
  if (
    embedded &&
    (setup !== lastSetup ||
      reason !== lastSetupReason ||
      (connected &&
        ((pendingSetup !== null && now - setupSentAt > 6000) ||
          (setupError && now >= setupRetryAt))))
  ) {
    lastSetup = setup;
    lastSetupReason = reason;
    pendingSetup = ++setupRequest;
    setupSentAt = now;
    setupRetryAt = Infinity;
    post({
      type: 'wee:controller-setup',
      setup,
      requestId: pendingSetup,
      ...(reason ? {reason} : {}),
    });
  }
}
function turnReady() {
  return (
    bowling &&
    gameActive &&
    connected &&
    !lobbyPaused &&
    canRoll &&
    currentPlayer === player &&
    !pendingRoll
  );
}
// The touch slider has deliberately coarse steps. Keep motion at sensor
// precision so its preview and locked delivery never inherit those steps.
function currentAim() {
  return buttonMode ? Number(element('aim').value) : liveAim;
}
function publishAim() {
  aimStream.publish(
    lockedAim ?? currentAim(),
    lockedAim !== null,
    performance.now(),
    turnReady() &&
      pageActive &&
      !document.hidden &&
      !settingsOpen &&
      (buttonMode || motionReady),
  );
}
function cancelArmedRoll() {
  if (motionDetector && bowling) motionDetector.setTurn(bowlingTurn, false);
  lockedAim = null;
}
// Tutorial motion is watched outside a match and never sent to the game.
function tutorialActive() {
  return Boolean(tutorial) && connected && !lobbyPaused && !gameActive;
}
// One calm play screen; setup remains mounted so switching views preserves
// calibration, sensor permission and the lobby connection.
function renderPlayState() {
  const setup = buttonMode || motionReady;
  setView('setup-panel', 'hidden', !settingsOpen);
  setView('controller-options', 'hidden', !settingsOpen);
  setView('play-panel', 'hidden', settingsOpen);
  setView('timing-details', 'hidden', bowling || !settingsOpen);
  setView(
    'strength-panel',
    'hidden',
    bowling || buttonMode || !motionReady || !settingsOpen,
  );
  setView(
    'tune-strength',
    'disabled',
    !motionReady || !recentReadings() || Boolean(rehearsal),
  );
  setView(
    'tune-strength',
    'textContent',
    strengthProfile ? 'Retune power' : 'Tune power',
  );
  setView(
    'skip-strength',
    'textContent',
    rehearsal ? 'Cancel rehearsal' : 'Use default power',
  );
  setView('strength-progress', 'hidden', !rehearsal);
  setView('controller-header', 'hidden', embedded && !settingsOpen);
  setView('toggle-settings', 'hidden', settingsOpen);
  setView('back-to-play', 'hidden', !settingsOpen);
  setView(
    'toggle-settings',
    'disabled',
    Boolean(rehearsal) || permissionPending,
  );
  setView(
    'toggle-settings',
    'textContent',
    settingsOpen ? 'Back to play' : 'Settings',
  );
  setView('toggle-settings', 'ariaExpanded', String(settingsOpen));
  setView(
    'stop',
    'hidden',
    !setup || buttonMode || !gameActive || !settingsOpen,
  );
  let state = 'ready';
  let status = buttonMode ? 'Touch ready' : 'Motion ready';
  let title = 'You’re in';
  let help = 'Watch the TV. Your game starts here.';
  if (!connected) {
    state = 'paused';
    status = 'Connection lost';
    title = 'Reconnecting…';
    help = 'Keep this page open. Your controller will reconnect automatically.';
  } else if (!setup) {
    state = 'paused';
    status = enabled ? 'Connecting motion' : 'Let’s play';
    title = enabled
      ? 'Getting your phone ready'
      : 'Your phone is the controller';
    help = enabled
      ? 'Waiting for motion readings…'
      : 'Allow motion, or use touch controls.';
    if (playNotice) help = playNotice;
  } else if (gameActive && lobbyPaused) {
    state = 'paused';
    status = 'Match paused';
    title = 'Hang tight';
    help = manuallyPaused
      ? 'Player 1 or the TV can resume the match from game options.'
      : 'Waiting for everyone to reconnect and finish setup.';
  } else if (setupError) {
    state = 'paused';
    status = 'Reconnecting';
    title = 'Reconnecting your controls…';
    help = 'Keep this page open. We’ll retry automatically.';
  } else if (
    gameActive &&
    bowling &&
    (bowlingPhase === 'complete' || bowlingPhase === 'finished')
  ) {
    state = 'finished';
    status = 'Match complete';
    title = 'Nice bowling!';
    help = 'See the final scores on the TV.';
  } else if (gameActive && !bowling && tennisState?.phase === 'complete') {
    state = 'finished';
    status = 'Match complete';
    title = tennisState.winner === player ? 'You won!' : 'Good match!';
    help = 'See the set scores on the TV. The host can start another match.';
  } else if (tutorialActive()) {
    state = 'playing';
    status = buttonMode
      ? 'Button controls'
      : sdkActive
        ? 'Motion on'
        : 'Waiting for sensors';
    title = 'Tutorial';
    help = buttonMode
      ? 'Try the move shown above, then tap Done.'
      : 'Do the move shown above. Your phone checks it for you.';
  } else if (!gameActive && lobbyPhase === PHASES.TUTORIAL) {
    state = 'waiting';
    status = 'Tutorial';
    title = 'Tutorial';
    help = 'Follow along on the TV. The match starts when everyone is done.';
  } else if (gameActive && !buttonMode && !recentReadings()) {
    state = 'paused';
    status = 'Motion interrupted';
    title = 'Waiting for sensors';
    help = 'Keep this screen open. Motion resumes when readings return.';
  } else if (gameActive && !buttonMode && !sdkActive) {
    state = 'paused';
    status = 'Motion paused';
    title = 'Ready when you are';
    help = 'Tap Resume motion to keep playing.';
  } else if (gameActive) {
    state = 'playing';
    status = buttonMode ? 'Button controls' : 'Motion on';
    title = buttonMode ? 'Tap to swing' : 'Swing to play';
    help = 'Watch the TV.';
    if (buttonMode) help = 'Watch the TV and choose your shot.';
    if (!bowling && tennisState?.practice) {
      title = 'Practice your return';
      help =
        'Watch the feed on the TV. Each return helps you find your timing.';
    } else if (!bowling && tennisState?.phase === 'prepare') {
      title =
        tennisState.server === player
          ? 'You serve next'
          : `P${tennisState.server} serves next`;
      help = 'Point finished. Get ready for the next serve.';
    } else if (!bowling && tennisState?.phase === 'serve') {
      const serving = tennisState.server === player;
      title = serving ? 'Your serve' : `P${tennisState.server} is serving`;
      help = serving
        ? 'Swing when you’re ready to serve.'
        : 'Get ready to return. Watch the ball on the TV.';
      if (serving && tennisState.serveAttempt === 2) {
        title = 'Your second serve';
        help = 'Take your time and swing comfortably.';
      }
    }
    if (bowling) {
      if (pendingRoll || (currentPlayer === player && !canRoll)) {
        state = 'waiting';
        title = 'Watch the lane';
        help = 'Your ball is rolling. Let the pins settle.';
      } else if (turnReady()) {
        status = 'Your turn';
        title = buttonMode
          ? 'Choose your line'
          : motionDetector?.phase === 'finished'
            ? 'Watch the lane'
            : motionDetector?.phase === 'rest'
              ? 'Hold still for a moment'
              : 'Swing forward to bowl';
        help = buttonMode
          ? 'Aim, then tap Roll.'
          : motionDetector?.phase === 'finished'
            ? 'Waiting for the next ball.'
            : motionDetector?.phase === 'rest'
              ? 'Screen up. Keep your hand steady until the swing prompt appears.'
              : 'Screen up. Tilt to aim, then swing gently forward.';
      } else {
        state = 'waiting';
        title = currentPlayer
          ? `P${currentPlayer} is bowling`
          : 'Waiting for the lane';
        help = 'Watch the TV. Your turn will appear here.';
      }
    }
  }
  // Avoid repeatedly replacing live-region content on the sensor timer.
  const notice =
    setupError ||
    playNotice ||
    (performance.now() < strokeNoticeUntil ? strokeNotice : '');
  for (const [id, text] of [
    ['play-status', status],
    ['play-title', title],
    ['play-help', help],
    ['play-notice', notice],
  ]) {
    if (element(id).textContent !== text) element(id).textContent = text;
  }
  if (element('play-panel').dataset.state !== state)
    element('play-panel').dataset.state = state;
  setView(
    'play-notice',
    'hidden',
    !notice || (!setupError && (!gameActive || lobbyPaused || !connected)),
  );
  setView(
    'record',
    'hidden',
    !setup ||
      buttonMode ||
      !gameActive ||
      lobbyPaused ||
      !connected ||
      sdkActive ||
      settingsOpen ||
      state === 'finished',
  );
  setView(
    'record',
    'disabled',
    !gameActive ||
      lobbyPaused ||
      !connected ||
      !enabled ||
      !motionReady ||
      sdkActive ||
      !recentReadings(),
  );
  setView(
    'bowling-controls',
    'hidden',
    !bowling || state !== 'playing' || !turnReady(),
  );
  setView('shot-adjustments', 'hidden', !buttonMode);
  setView('curve-buttons', 'hidden', !buttonMode);
  setView('aim', 'hidden', false);
  setView('aim-label', 'textContent', 'Aim');
  setView('tilt-help', 'hidden', true);
  setView(
    'bowling-readout',
    'hidden',
    !bowling ||
      buttonMode ||
      !gameActive ||
      state === 'paused' ||
      !(bowlingReadout && performance.now() < feedbackUntil),
  );
  setView(
    'grip-cue',
    'hidden',
    !bowling || buttonMode || !setup || state !== 'playing',
  );
  setView('use-buttons', 'hidden', buttonMode || settingsOpen);
  setView(
    'enable',
    'hidden',
    settingsOpen || (setup && !buttonMode) || (enabled && !buttonMode),
  );
  setView('enable', 'textContent', buttonMode ? 'Use motion' : 'Allow motion');
  setView('bowling-buttons', 'hidden', !buttonMode);
  setView(
    'manual-controls',
    'hidden',
    bowling || !buttonMode || state !== 'playing',
  );
  setView(
    'latest',
    'hidden',
    !gameActive || state === 'paused' || performance.now() >= feedbackUntil,
  );
  const activeController =
    setup &&
    (gameActive || tutorialActive()) &&
    connected &&
    !lobbyPaused &&
    !settingsOpen &&
    pageActive &&
    !document.hidden &&
    (state === 'playing' || state === 'waiting');
  const readyInLobby =
    !gameActive &&
    motionReady &&
    !buttonMode &&
    connected &&
    !settingsOpen &&
    pageActive &&
    !document.hidden &&
    state === 'ready';
  const rehearsing =
    Boolean(rehearsal) && connected && pageActive && !document.hidden;
  screenAwake.setActive(activeController || readyInLobby || rehearsing);
  phoneFeedback.setActive(activeController);
}
function controls() {
  element('setup-next').textContent =
    'Motion connects automatically. Reset only if your phone drifts.';
  element('enable').disabled = permissionPending;
  element('enable').textContent = enabled
    ? 'Retry motion access'
    : 'Enable motion';
  element('calibrate').disabled = permissionPending;
  element('calibrate').textContent = motionReady
    ? 'Reset motion setup'
    : savedSetup
      ? 'Resume motion'
      : 'Enable motion';
  element('stop').disabled = !gameActive || !motionWanted;
  for (const id of ['hand', 'response', 'stroke-mode', 'suppress-returns'])
    element(id).disabled = sdkActive || Boolean(rehearsal);
  element('motion-sensitivity').disabled = sdkActive || Boolean(rehearsal);
  for (const id of ['forehand', 'backhand'])
    element(id).disabled =
      !gameActive ||
      lobbyPaused ||
      !connected ||
      tennisState?.phase === 'complete';
  element('roll').disabled = !turnReady() || (!buttonMode && !motionReady);
  publishSetup();
  renderPlayState();
}
function deliveryResult(event, kind = 'swing') {
  element('delivery').textContent =
    event.ok === false
      ? kind === 'roll' && ['timeout', 'outcome-unknown'].includes(event.error)
        ? 'Roll confirmation is delayed. Watch the TV; do not release again until the lane is ready.'
        : event.error === 'network-busy'
          ? `Connection busy. This ${kind} was not sent; try when it clears.`
          : event.error === 'game-loading'
            ? 'The game is loading. Try again when it appears on the TV.'
            : event.error === 'not-your-turn' || event.error === 'roll-rejected'
              ? 'Wait until the TV and your controller show your turn.'
              : event.error === 'duplicate-roll'
                ? 'This roll was already received. Watch the lane for its result.'
                : ['stale-input', 'wrong-generation', 'wrong-epoch'].includes(
                      event.error,
                    )
                  ? 'That input belonged to an earlier turn. Wait for your controller to reconnect.'
                  : `The ${kind} was not accepted. Wait for the game to reconnect, then try again.`
      : event.receivers
        ? Number.isFinite(event.roundTripMs)
          ? `Delivered · ${event.roundTripMs} ms ${event.timingScope === 'server' ? 'server' : 'game delivery'} round trip.`
          : 'Delivered to game.'
        : 'No game connected. Check the TV.';
  playNotice =
    event.ok === false || !event.receivers
      ? element('delivery').textContent
      : '';
  if (event.ok !== false && event.receivers > 0) phoneFeedback.delivered(kind);
  renderPlayState();
}
const connection = connectSwings({
  room,
  role: 'phone',
  onStatus: text => {
    element('connection').textContent = text;
    if (!embedded) {
      connected = text === 'Connected';
      if (!connected) stop();
      controls();
    }
  },
  onSent: event => {
    pendingTimings.set(event.id, {at: performance.now(), acknowledged: false});
    if (pendingTimings.size > 40)
      pendingTimings.delete(pendingTimings.keys().next().value);
    timingStats.recognition.add(nextRecognitionMs);
    renderTiming();
  },
  onAck: event => {
    const pending = pendingTimings.get(event.id);
    if (
      !pending ||
      pending.acknowledged ||
      !connected ||
      !gameActive ||
      lobbyPaused ||
      performance.now() - pending.at > 5000
    )
      return;
    if (event.ok !== false) {
      timingStats.delivery.add(event.roundTripMs);
      pending.acknowledged = true;
      renderTiming();
    }
    pending.acknowledged = true;
    deliveryResult(event);
  },
});
function send(label, power = 0.5, recognitionMs, placement) {
  if (
    bowling ||
    lobbyPaused ||
    !gameActive ||
    !connected ||
    settingsOpen ||
    rehearsal ||
    document.hidden ||
    tennisState?.phase === 'complete'
  )
    return;
  strokeNoticeUntil = 0;
  nextRecognitionMs = recognitionMs;
  const sent = connection.sendSwing(
    label,
    element('hand').value,
    power,
    placement ?? null,
  );
  nextRecognitionMs = undefined;
  if (sent) phoneFeedback.swing(label);
  element('delivery').textContent = sent
    ? 'Sending stroke…'
    : 'Disconnected: the stroke was not sent.';
  playNotice = sent ? '' : element('delivery').textContent;
  renderPlayState();
}
element('forehand').onclick = () => send('Forehand');
element('backhand').onclick = () => send('Backhand');
function roll(power, measuredSpin = null) {
  if (!turnReady() || document.hidden) return;
  const aim = lockedAim ?? currentAim();
  cancelArmedRoll();
  const event = {
    type: 'roll',
    id: createInputId(),
    power,
    aim,
    spin: measuredSpin ?? Number(element('spin').value),
  };
  pendingRoll = {id: event.id, turnKey: bowlingTurn, at: performance.now()};
  post({type: 'wee:player-roll', event});
  element('delivery').textContent = 'Sending your roll…';
  element('latest').textContent =
    measuredSpin === null ? `${Math.round(power * 100)}% power` : 'Roll sent';
  feedbackUntil = performance.now() + 3500;
  playNotice = '';
  controls();
}
element('roll').onclick = () => roll(Number(element('power').value));
function showBowlingReadout(readout) {
  element('motion-power').value = readout.power;
  element('motion-power-value').textContent =
    `${Math.round(readout.power * 100)}%`;
  element('motion-curve').textContent =
    Math.abs(readout.spin) < 0.005
      ? 'Straight'
      : `${readout.spin < 0 ? 'Left' : 'Right'} ${Math.round((Math.abs(readout.spin) / 0.55) * 100)}%`;
}
function showDeliveryValue(id, value) {
  element(`${id}-value`).textContent =
    id === 'power'
      ? `${Math.round(value * 100)}%`
      : value === 0
        ? id === 'aim'
          ? 'Center'
          : 'Straight'
        : `${value < 0 ? 'Left' : 'Right'} ${Math.round(Math.abs(value) * 100)}%`;
}
for (const id of ['aim', 'spin', 'power']) {
  element(id).oninput = () => {
    const value = Number(element(id).value);
    showDeliveryValue(id, value);
    if (id === 'aim') {
      liveAim = value;
      publishAim();
    }
  };
}
function stop(
  message = 'Motion paused. Tap Resume motion when you are ready.',
  user = false,
) {
  if (user) {
    motionWanted = false;
    userPaused = true;
  }
  const wasActive = sdkActive;
  sdkActive = false;
  motionDetector = null;
  sdk.pause();
  cancelArmedRoll();
  if (wasActive || user) element('motion').textContent = message;
  controls();
}
function startMotion() {
  if (!bowling && tennisState?.phase === 'complete') return;
  if (
    sdkActive ||
    settingsOpen ||
    rehearsal ||
    !motionWanted ||
    !motionReady ||
    buttonMode ||
    !enabled ||
    !(gameActive || tutorialActive()) ||
    lobbyPaused ||
    !connected ||
    !pageActive ||
    document.hidden
  )
    return;
  if (bowling) {
    motionDetector = createBowlingDetector({sensitivity: motionSensitivity});
    motionDetector.setTurn(bowlingTurn, turnReady());
  } else {
    motionDetector = createTennisDetector({
      hand: element('hand').value,
      mode: element('stroke-mode').value,
      response: element('response').value,
      suppressReturns: element('suppress-returns').checked,
      sensitivity: motionSensitivity,
      strengthProfile,
    });
  }
  sdk.setDetector(motionDetector);
  sdk.resume();
  sdkActive = true;
  element('latest').textContent = '';
  playNotice = '';
  element('motion').textContent = tutorialActive()
    ? 'Motion is live. Do the move shown above.'
    : bowling
      ? 'Swing forward to bowl. Turn your wrist to curve.'
      : 'Motion is live. Swing to play; use Stop motion to pause your detector.';
  controls();
}
function finishRehearsal(message, profile = null) {
  rehearsal = null;
  rehearsalStream = null;
  if (profile) {
    strengthProfile = profile;
    saveStrength();
  }
  element('strength-status').textContent = message;
  controls();
}
function updateRehearsal(result) {
  element('strength-progress').value = result.count;
  if (element('strength-status').textContent !== result.message)
    element('strength-status').textContent = result.message;
  if (result.state !== 'collecting')
    finishRehearsal(result.message, result.profile);
}
element('tune-strength').onclick = () => {
  if (
    bowling ||
    !motionReady ||
    buttonMode ||
    !recentReadings() ||
    document.hidden ||
    rehearsal
  )
    return;
  stop('Motion pauses while you rehearse comfortable swings.');
  settingsOpen = true;
  rehearsalStarted = performance.now();
  rehearsal = createStrengthRehearsal(element('hand').value, rehearsalStarted);
  // Use complete real classifications regardless of the selected gameplay mode.
  rehearsalStream = createSwingStream(element('hand').value, {
    suppressReturns: true,
  });
  updateRehearsal(rehearsal.read(rehearsalStarted));
  controls();
};
element('skip-strength').onclick = () => {
  if (rehearsal)
    finishRehearsal(
      strengthProfile
        ? 'Rehearsal cancelled. Your previous comfortable strength is kept.'
        : 'Rehearsal cancelled. Default strength is ready.',
    );
  else {
    strengthProfile = null;
    saveStrength();
    element('strength-status').textContent =
      'Default strength is ready. Tune again whenever you want.';
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
  finishRehearsal('Playing hand changed. Default power is ready.');
};
window.addEventListener('message', event => {
  if (
    !embedded ||
    event.source !== window.parent ||
    event.origin !== location.origin
  )
    return;
  const data = event.data;
  if (data?.type === 'wee:controller-intent') {
    const selected =
      data.mode === 'touch' ||
      data.permission === 'denied' ||
      data.permission === 'unavailable'
        ? 'touch'
        : data.mode;
    if (
      !['motion', 'touch'].includes(selected) ||
      selected === controllerIntentMode
    )
      return;
    controllerIntentMode = selected;
    if (
      data.mode === 'touch' ||
      data.permission === 'denied' ||
      data.permission === 'unavailable'
    )
      element('use-buttons').onclick();
    else if (data.mode === 'motion' && data.permission === 'granted')
      void activateMotion(true);
    return;
  }
  if (data?.type === 'wee:profile-preferences') {
    const active =
      setupIntent > 0 ||
      Boolean(motionReady || sdkActive || rehearsal || buttonMode || pendingRoll);
    if (
      controllerPreferences.applyProfile(data.preferences, {
        active,
        protectedKeys: savedSetup
          ? ['hand', 'touchControls', 'sensitivity']
          : [],
      })
    ) {
      if (!savedSetup)
        element('hand').value = controllerPreferences.values.hand;
      renderPreferences();
      if (controllerPreferences.values.touchControls)
        element('use-buttons').onclick();
    }
    return;
  }
  if (
    data?.type === 'wee:stroke-result' &&
    !bowling &&
    isStrokeResult(data) &&
    data.gameId === tennisGameId &&
    data.player === player &&
    connected &&
    gameActive &&
    !lobbyPaused
  ) {
    const pending = pendingTimings.get(data.id);
    if (!pending || pending.result || performance.now() - pending.at > 5000)
      return;
    pending.result = true;
    if (data.result === 'hit')
      timingStats.contact.add(data.receivedToContactMs);
    element('timing-result').textContent =
      `Last stroke: ${data.result} · ${data.reason}`;
    if (!settingsOpen && data.result !== 'hit') {
      strokeNotice = data.reason;
      strokeNoticeUntil = performance.now() + 1800;
    }
    renderTiming();
    renderPlayState();
    return;
  }
  if (
    data?.type === 'wee:game-hit' &&
    data.kind === (bowling ? 'bowling' : 'tennis') &&
    data.player === player
  ) {
    if (gameActive && connected && !lobbyPaused && !settingsOpen)
      phoneFeedback.hit(performance.now(), data.kind);
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
    if (
      data.phase === 'ready' &&
      (bowlingPhase !== 'ready' || currentPlayer !== data.currentPlayer)
    ) {
      bowlingTurn++;
      // A new authoritative turn resolves the previous delivery even if its
      // reply was lost. Replaying the same ready state after pause/reconnect
      // does not create a turn, and cannot unlock an uncertain release.
      if (pendingRoll && pendingRoll.turnKey !== bowlingTurn)
        pendingRoll = null;
    }
    canRoll = data.canRoll === true;
    currentPlayer = data.currentPlayer;
    bowlingPhase = data.phase;
    if (!canRoll || currentPlayer !== player) cancelArmedRoll();
    if (motionDetector && bowling && sdkActive)
      motionDetector.setTurn(bowlingTurn, turnReady());
    controls();
    return;
  }
  if (data?.type === 'wee:tennis-state' && !bowling && isTennisState(data)) {
    tennisState = {
      phase: data.phase,
      server: data.server,
      winner: data.winner,
      practice: data.practice,
      serveAttempt: data.serveAttempt,
    };
    if (data.phase === 'complete')
      stop('Match complete. See the TV for results.');
    else startMotion();
    controls();
    return;
  }
  if (data?.type === 'wee:roll-ack' && bowling) {
    if (!pendingRoll || data.result?.id !== pendingRoll.id) return;
    motionDetector?.rejectRelease(pendingRoll.turnKey, data.result);
    pendingRoll = null;
    deliveryResult(data.result ?? {ok: false}, 'roll');
    controls();
    return;
  }
  if (data?.type !== 'wee:lobby-state' || typeof data.paused !== 'boolean')
    return;
  const generation = data.generation ?? data.inputGeneration;
  if (
    (generation !== undefined && generation !== inputGeneration) ||
    data.gameId !== tennisGameId
  ) {
    inputGeneration = generation;
    if (data.gameId !== tennisGameId) bowlingTurn++;
    cancelArmedRoll();
  }
  if (
    ['tennis', 'bowling'].includes(data.sport) &&
    bowling !== (data.sport === 'bowling')
  ) {
    // The same controller document owns permission and gyro zero across sports.
    // Drop sport-specific input, but never require another calibration to switch.
    stop('Switching games…');
    if (rehearsal)
      finishRehearsal('Power tuning stopped. Your saved power is kept.');
    bowling = data.sport === 'bowling';
    canRoll = false;
    currentPlayer = null;
    bowlingPhase = 'waiting';
    pendingRoll = null;
    bowlingReadout = null;
    liveAim = 0;
    aimStream.reset();
    element('aim').value = '0';
    element('aim').oninput();
    element('strength-panel').open = false;
    settingsOpen = false;
    playNotice = '';
    feedbackUntil = 0;
    tennisState = null;
    pendingTimings.clear();
    strokeNoticeUntil = 0;
    renderSport();
    // The lobby may have reset readiness for its new sport. Re-publish the
    // already verified controller mode without dropping it to an unset state.
    lastSetup = undefined;
  }
  if (data.gameId !== tennisGameId || (gameActive && !data.playing)) {
    // A returned match cannot keep a pending roll or an open tuning panel
    // attached to the next game. Verified controller setup stays available.
    pendingRoll = null;
    canRoll = false;
    currentPlayer = null;
    bowlingPhase = 'waiting';
    bowlingReadout = null;
    settingsOpen = false;
    playNotice = '';
    feedbackUntil = 0;
    if (rehearsal)
      finishRehearsal('Your controller is ready for the next game.');
  }
  if (data.gameId !== tennisGameId || !data.playing) {
    tennisState = null;
    tennisGameId = data.gameId;
    pendingTimings.clear();
    strokeNoticeUntil = 0;
    for (const stats of Object.values(timingStats)) stats.clear();
    element('timing-result').textContent = '';
    renderTiming();
  }
  if (data.connected && !wasConnected) lastSetup = undefined;
  connected = data.connected === true;
  if (!connected && rehearsal)
    finishRehearsal(
      'Rehearsal stopped while reconnecting. Try again when connected, or keep the default strength.',
    );
  wasConnected = connected;
  gameActive = data.playing === true;
  lobbyPaused = data.paused;
  manuallyPaused = data.manuallyPaused === true;
  lobbyPhase = typeof data.phase === 'string' ? data.phase : null;
  const nextTutorial =
    !gameActive &&
    lobbyPhase === PHASES.TUTORIAL &&
    Number.isInteger(data.tutorial?.step) &&
    typeof data.tutorial?.move === 'string'
      ? {step: data.tutorial.step, move: data.tutorial.move}
      : null;
  if (
    nextTutorial?.step !== tutorial?.step ||
    nextTutorial?.move !== tutorial?.move
  ) {
    // A new step starts from a clean detector, so no half-finished swing carries over.
    tutorial = nextTutorial;
    tutorialDetector = tutorial
      ? createTutorialDetector(bowling ? 'bowling' : 'tennis', tutorial.move, {
          hand: element('hand').value,
        })
      : null;
  }
  if (lobbyPaused || !connected) {
    pendingTimings.clear();
    strokeNoticeUntil = 0;
  }
  if (lobbyPaused || !connected || (!gameActive && !tutorialActive()))
    stop('Paused. Motion will resume when the match is ready.');
  startMotion();
  controls();
});

function currentSetupIntent(intent) {
  return intent === setupIntent && pageActive && !document.hidden;
}
function showMotionError(error) {
  playNotice =
    error.name === 'NotAllowedError'
      ? 'Tap Allow motion to continue, or use touch controls.'
      : /denied/i.test(error.message)
        ? 'Motion access was denied. Touch controls are ready to use.'
        : /HTTPS/i.test(error.message)
          ? 'Motion needs a secure HTTPS link. You can use touch controls here.'
          : 'Motion is unavailable here. Use touch controls to play.';
  element('motion').textContent =
    error.name === 'NotAllowedError'
      ? 'Motion permission needs a direct tap. Open this page in Safari or Chrome, tap Enable motion and allow access.'
      : error.message;
  element('sensor-status').dataset.state = 'error';
  renderPlayState();
}
function saveStrength() {
  const hand = element('hand').value;
  const existing = calibrationMemory.read();
  if (existing?.hand === hand || motionReady)
    calibrationMemory.save({hand, strength: strengthProfile});
}
async function activateMotion(reusePermission = false) {
  userPaused = false;
  controllerIntentMode = 'motion';
  post({type: 'wee:controller-mode', mode: 'motion'});
  const intent = ++setupIntent;
  controllerPreferences.update({touchControls: false});
  buttonMode = false;
  motionReady = false;
  stop();
  permissionPending = true;
  permissionIntent = intent;
  controls();
  try {
    await sdk.start({reusePermission});
    if (!currentSetupIntent(intent)) return;
    enabled = true;
    permissionAt = performance.now();
    motionWanted = true;
    element('motion').textContent = 'Permission allowed. Waiting for sensor readings…';
    controls();
  } catch (error) {
    if (currentSetupIntent(intent)) {
      element('use-buttons').onclick();
      showMotionError(error);
    }
  } finally {
    if (permissionIntent === intent) {
      permissionPending = false;
      permissionIntent = null;
      controls();
    }
  }
}
element('enable').onclick = () => activateMotion();
element('calibrate').onclick = async () => {
  if (rehearsal) finishRehearsal('Rehearsal stopped for recalibration.');
  await activateMotion(enabled && recentReadings());
};
element('record').onclick = () => {
  userPaused = false;
  motionWanted = true;
  startMotion();
};
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
  startMotion();
  controls();
  focusControllerSection(element('play-panel'));
};
element('use-buttons').onclick = () => {
  controllerIntentMode = 'touch';
  post({type: 'wee:controller-mode', mode: 'touch'});
  setupIntent++;
  controllerPreferences.update({touchControls: true});
  if (rehearsal)
    finishRehearsal('Rehearsal stopped. Button controls use default strength.');
  stop(undefined, true);
  element('calibration-progress').hidden = true;
  buttonMode = true;
  settingsOpen = false;
  lastSetup = undefined;
  element('bowling-buttons').open = true;
  element('motion').textContent = bowling
    ? 'Button controls ready. Set aim, curve and power, then Roll ball on your turn.'
    : 'Button controls ready. Use Forehand and Backhand when the match starts.';
  controls();
};
function sensorStatus(now) {
  if (now - sensorUpdatedAt < 250) return;
  sensorUpdatedAt = now;
  // Readiness and notices still refresh during play. Live gyro counters belong
  // to Settings, so do not rebuild their hidden text on every sensor poll.
  if (gameActive && !settingsOpen && (buttonMode || recentReadings())) {
    renderPlayState();
    return;
  }
  const status = element('sensor-status');
  let sensorState = 'ready';
  if (!window.isSecureContext) {
    setView(
      'sensor-status',
      'textContent',
      'HTTP connection: phone motion is unavailable. Use an HTTPS link or button controls.',
    );
    sensorState = 'error';
  } else if (!window.DeviceMotionEvent) {
    setView(
      'sensor-status',
      'textContent',
      'No motion API on this device. Button controls are available.',
    );
    sensorState = 'error';
  } else if (recentReadings())
    setView(
      'sensor-status',
      'textContent',
      `Gyroscope connected · ${validReadings} readings received`,
    );
  else if (enabled && now - permissionAt > 2500) {
    setView(
      'sensor-status',
      'textContent',
      'Permission allowed, but no readings arrived. Keep this page visible and check browser motion permissions.',
    );
    sensorState = 'error';
  } else
    setView(
      'sensor-status',
      'textContent',
      enabled
        ? 'Waiting for sensor readings…'
        : 'Allow motion or choose touch controls.',
    );
  setView(
    'sensor-detail',
    'textContent',
    `${window.isSecureContext ? 'Secure context' : 'Insecure context'} · ${validReadings} valid gyro readings${latestRate ? ` · ${Math.round(Math.hypot(...Object.values(latestRate)))}°/s · last reading ${Math.round(now - lastReading)} ms ago` : ''}`,
  );
  setView(
    'detector-state',
    'textContent',
    !sdkActive
      ? 'Motion idle'
      : bowling
        ? motionDetector?.phase === 'forward'
          ? 'Forward swing · aim locked'
          : 'Motion live · waiting for your turn and a brief rest'
        : 'Motion live · ready for a swing',
  );
  if (status.dataset.state !== sensorState) status.dataset.state = sensorState;
  renderPlayState();
}
setInterval(() => {
  const now = performance.now();
  publishSetup();
  if (
    enabled &&
    !buttonMode &&
    !motionReady &&
    !permissionPending &&
    pageActive &&
    !document.hidden &&
    now - permissionAt >= 3000
  ) {
    element('use-buttons').onclick();
    playNotice = "Motion isn't available here. Touch controls are ready.";
  }
  // Poll bowling detector preview while in forward swing phase.
  if (bowling && sdkActive && motionDetector?.phase === 'forward') {
    const preview = motionDetector.preview;
    if (preview) {
      bowlingReadout = {
        power: Math.min(1, preview.power * motionSensitivity),
        spin: preview.spin,
      };
      showBowlingReadout(bowlingReadout);
      feedbackUntil = performance.now() + 3500;
    }
  }
  // Sync bowling detector turn state each interval.
  if (bowling && sdkActive && motionDetector)
    motionDetector.setTurn(bowlingTurn, turnReady());
  publishAim();
  sensorStatus(now);
  if (sdkActive && !recentReadings())
    stop(
      'Sensor readings paused. Keep the page visible; motion resumes when readings return.',
    );
  if (rehearsal) {
    if (!recentReadings())
      finishRehearsal(
        'Rehearsal stopped because sensor readings paused. Keep the screen open and try again.',
      );
    else updateRehearsal(rehearsal.read(now));
  }
  if (pendingRoll && now - pendingRoll.at > 4000) {
    pendingRoll = null;
    playNotice = 'No roll confirmation yet. Watch the TV before trying again.';
    element('delivery').textContent = playNotice;
    controls();
  }
  startMotion();
}, 30);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    startMotion();
    controls();
    screenAwake.retry();
    return;
  }
  setupIntent++;
  stop(
    'Motion paused while the page is hidden. Return to this page to continue.',
  );
  if (rehearsal)
    finishRehearsal(
      'Rehearsal stopped because the page was hidden. Keep it open and try again.',
    );
});
document.addEventListener('pointerdown', () => screenAwake.retry());
window.addEventListener('pagehide', () => {
  setupIntent++;
  pageActive = false;
  stop('Motion paused.');
  if (rehearsal)
    finishRehearsal('Rehearsal stopped. Start again when you return.');
  screenAwake.setActive(false);
  phoneFeedback.setActive(false);
});
window.addEventListener('pageshow', () => {
  pageActive = true;
  controls();
  screenAwake.retry();
});
if (controllerPreferences.values.touchControls)
  element('use-buttons').onclick();
{
  if (!buttonMode)
    element('motion').textContent = savedSetup
      ? 'Your setup is saved. Motion reconnects automatically; tap Resume motion only if your browser asks.'
      : 'Allow motion or use touch controls. Your phone connects automatically.';
  // Start the SDK automatically to begin sensor ingestion and auto-calibration
  // without requesting new permission (reuses any existing browser grant).
  if (!buttonMode) void activateMotion(true);
}
controls();
sensorStatus(performance.now() + 250);
