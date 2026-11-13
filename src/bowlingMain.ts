import {BowlingWorld, BowlingState} from './bowling/World';
import {awaitingBonus, createRollCallouts, frameMarks} from './bowling/scoreboard';
import {isGameCommand} from '../shared/protocol.js';
import {createSportsAudio} from './audio/sportsAudio';
import {shouldTogglePause} from './network/pauseShortcut.js';
import '../client/src/styles/tokens.css';
import './gameHud.css';
import './bowling.css';
import './gameResults.css';
import './theme.js';

const embedded = window.parent !== window;
const el = (id: string): HTMLElement => document.getElementById(id)!;
let world: BowlingWorld | null = null;
let gameId: string | null = null;
let lobbyPaused = embedded;
let pageSuspended = false;
let manuallyPaused = false;
let paused = embedded;
let connected = false;
let inputGeneration: number | undefined;
let hostEpoch: number | undefined;
let lastAimSequence = -1;
let lastAimPlayer: number | null = null;
let previousPhase: BowlingState['phase'] | null = null;
let aimTarget: Pick<BowlingState, 'phase' | 'currentPlayer'> | null = null;
let lastCheckpoint = '';
let restored = false;
let restoring = false;
const sound = embedded ? null : createSportsAudio('bowling');
sound?.mountButton(document.querySelector('.bowling-heading') as HTMLElement);
sound?.setActive(!paused);
const delivered = new Set<string>();
const commands = new Set<string>();
const callouts = createRollCallouts();
let calloutTimer: ReturnType<typeof setTimeout> | null = null;
let complete = false;
let finalResultKey = '';
const post = (message: object): void => { if (embedded) window.parent.postMessage(message, location.origin); };
document.body.classList.toggle('bowling-embedded', embedded);
el('replay').hidden = embedded;
function publishOptions(): void {
  if (gameId) post({type: 'wee:game-options', gameId, sport: 'bowling',
    ...(world?.getState().practice ? {practice: {active: true}} : {})});
}
function publishCheckpoint(): void {
  if (!gameId || restoring) return;
  const payload = world?.exportCheckpoint?.();
  if (!payload) return;
  const serialized = JSON.stringify(payload);
  if (serialized === lastCheckpoint) return;
  lastCheckpoint = serialized;
  post({type: 'wee:game-checkpoint', gameId, sport: 'bowling', rulesVersion: 1, checkpointVersion: 1, payload});
}
function clearCallout(): void {
  if (calloutTimer !== null) clearTimeout(calloutTimer);
  calloutTimer = null;
  el('roll-callout').hidden = true;
  el('callout-title').textContent = '';
  el('results').hidden = !complete;
}
function showCallout(call: {kind: 'strike' | 'spare'; player: string}): void {
  clearCallout();
  el('roll-callout').dataset.kind = call.kind;
  el('callout-player').textContent = call.player;
  el('callout-title').textContent = call.kind === 'strike' ? 'Strike!' : 'Spare!';
  el('callout-detail').textContent = call.kind === 'strike' ? 'All ten. One roll.' : 'Every pin cleared.';
  el('roll-callout').hidden = false;
  // Let the final delivery have its moment before showing the ranking card.
  if (complete) el('results').hidden = true;
  calloutTimer = setTimeout(clearCallout, 2400);
}
function audioEvent(event: string): void {
  if (embedded) {
    if (gameId) post({type: 'wee:game-audio', sport: 'bowling', gameId, event});
  } else if (event === 'stop') sound?.stop();
  else sound?.play(event);
}

function showAim(aim: number, locked = false): void {
  (el('aim') as HTMLInputElement).value = String(aim);
  const guide = el('aim-hud');
  guide.style.setProperty('--aim-position', `${50 + aim * 45}%`);
  guide.dataset.locked = String(locked);
  el('aim-label').textContent = `Aim · ${Math.abs(aim) < .08 ? 'centre' : aim < 0 ? 'left' : 'right'}`;
  el('aim-state').textContent = locked ? 'Locked' : 'Live';
  el('help').textContent = locked ? 'Follow through. Turn your wrist to curve.' : 'Tilt to aim. Swing forward to bowl.';
}

function render(state: BowlingState): void {
  aimTarget = {phase: state.phase, currentPlayer: state.currentPlayer};
  const changedPlayer = state.currentPlayer !== lastAimPlayer;
  if (changedPlayer) { lastAimSequence = -1; lastAimPlayer = state.currentPlayer; }
  if (!restoring && state.phase === 'ready' && (changedPlayer || previousPhase === 'rolling')) {
    // A completed delivery never leaves a gold, locked guide for the next turn.
    showAim(0); world?.setAim(0);
  }
  previousPhase = state.phase;
  el('aim-hud').hidden = paused || state.phase !== 'ready';
  complete = state.complete;
  const call = callouts.observe(state, paused);
  if (paused || state.phase === 'rolling' || !state.lastRoll) clearCallout();
  if (state.phase !== 'rolling') audioEvent('roll-end');
  const player = state.players.find(p => p.player === state.currentPlayer);
  el('frame-label').textContent = state.practice ? 'Solo practice · fresh rack' : state.complete ? 'Final · 10 frames' : `Frame ${state.frame} / 10 · Ball ${state.ball}`;
  const last = state.lastRoll;
  const result = last ? last.strike ? 'Strike!' : last.spare ? 'Spare!' : `${last.pins} ${last.pins === 1 ? 'pin' : 'pins'} down` : '';
  const cue = paused ? manuallyPaused ? 'Paused · resume on your phone or TV' : 'Paused · waiting for controllers' : state.complete ? 'Final scores' : state.phase === 'rolling' ? `${player?.name} · ball in play` :
    `${result ? `${result} · ` : ''}${player?.name}, ${last?.player === state.currentPlayer ? 'roll again' : 'your turn'}`;
  if (el('roll-status').textContent !== cue) el('roll-status').textContent = cue;
  el('score-totals').replaceChildren(...state.players.map(score => {
    const item = document.createElement('li');
    item.dataset.active = String(!state.complete && score.player === state.currentPlayer);
    item.style.setProperty('--player-color', `var(--p${score.player}, var(--accent-ink))`);
    const name = document.createElement('span'); name.className = 'bowling-standings__name';
    name.textContent = `P${score.player} · ${score.name}`; name.title = score.name;
    const total = document.createElement('strong'); total.textContent = String(score.total);
    total.setAttribute('aria-label', `${score.total} points`);
    const marks = document.createElement('span'); marks.className = 'bowling-standings__frame';
    marks.textContent = frameMarks(score.frames[state.frame - 1] || [], state.frame - 1).filter(Boolean).join(' ') || '—';
    marks.setAttribute('aria-label', `Frame ${state.frame}: ${marks.textContent}`);
    item.append(name, total, marks);
    return item;
  }));
  const body = el('score-body'); body.replaceChildren();
  for (const score of state.players) {
    const row = document.createElement('tr');
    row.dataset.active = String(!state.complete && score.player === state.currentPlayer);
    row.style.setProperty('--player-color', `var(--p${score.player})`);
    const name = document.createElement('th'); name.scope = 'row'; name.textContent = `P${score.player} · ${score.name}`; row.append(name);
    score.frames.forEach((rolls, index) => {
      const cell = document.createElement('td');
      cell.dataset.current = String(!state.complete && score.player === state.currentPlayer && index + 1 === state.frame);
      const deliveries = document.createElement('span'); deliveries.className = 'bowling-marks';
      const marks = frameMarks(rolls, index);
      deliveries.style.setProperty('--rolls', String(marks.length));
      for (const mark of marks) {
        const box = document.createElement('span'); box.textContent = mark;
        box.className = mark === 'X' ? 'bowling-mark--strike' : mark === '/' ? 'bowling-mark--spare' : '';
        deliveries.append(box);
      }
      const pending = awaitingBonus(rolls, index, score.frameScores[index]);
      const total = document.createElement('strong');
      total.textContent = score.frameScores[index] === null ? pending ? '…' : '' : String(score.frameScores[index]);
      const readable = marks.map(mark => mark === 'X' ? 'strike' : mark === '/' ? 'spare' : mark === '–' ? 'zero' : mark).filter(Boolean).join(', ');
      cell.setAttribute('aria-label', `Frame ${index + 1}: ${readable || 'not played'}${score.frameScores[index] === null ? pending ? '; bonus rolls pending' : '' : `; total ${score.frameScores[index]}`}`);
      cell.append(deliveries, total); row.append(cell);
    });
    const total = document.createElement('td'); total.className = 'bowling-total'; total.textContent = String(score.total); row.append(total); body.append(row);
  }
  el('results').hidden = !state.complete || !el('roll-callout').hidden;
  const winners = state.ranking.filter(player => player.rank === 1);
  const finalKey = state.complete ? JSON.stringify(state.ranking) : '';
  if (finalKey !== finalResultKey) {
    finalResultKey = finalKey;
    el('result-winner').textContent = state.complete ? winners.length > 1 ? 'Tied for first!' : `${winners[0].name} wins!` : '';
    el('result-score').textContent = state.complete ? `${winners[0].total} points` : '';
    el('replay-prompt').textContent = embedded ? 'Play again? Choose on your phone.' : 'Ready for another game?';
    el('ranking').replaceChildren(...(state.complete ? state.ranking : []).map(p => {
      const item = document.createElement('li'); item.dataset.winner = String(p.rank === 1);
      const rank = document.createElement('span'); rank.className = 'result-rank'; rank.textContent = String(p.rank);
      const name = document.createElement('span'); name.className = 'result-name'; name.textContent = p.name;
      const total = document.createElement('strong'); total.textContent = String(p.total);
      item.append(rank, name, total); return item;
    }));
  }
  (el('roll') as HTMLButtonElement).disabled = paused || state.phase !== 'ready';
  const practiceButton = document.getElementById('practice');
  if (practiceButton) {
    practiceButton.textContent = state.practice ? 'Start ten-frame game' : 'Practice a fresh rack';
    (practiceButton as HTMLButtonElement).disabled = paused || state.phase === 'rolling';
  }
  if (call) showCallout(call);
  post({type: 'wee:bowling-state', gameId, phase: state.phase, currentPlayer: state.currentPlayer, frame: state.frame,
    ...(state.complete ? {winners: winners.map(player => player.player), winnerScore: winners[0].total} : {})});
  publishCheckpoint();
}
function create(players: Array<{player: number; name: string}>): void {
  callouts.reset(); complete = false; clearCallout();
  world = new BowlingWorld(el('lane'), players);
  world.onState = render;
  world.onSoundEvent = event => {
    if (!paused || event === 'roll-end') audioEvent(event);
  };
  world.onPinHit = player => {
    if (!paused && connected && gameId) post({type: 'wee:game-hit', player, gameId});
  };
  syncWorldState();
  render(world.getState());
  publishOptions();
}
function newMatch(): void {
  audioEvent('stop');
  clearCallout(); callouts.reset();
  delivered.clear(); world?.reset();
  showAim(0); world?.setAim(0);
  lastAimSequence = -1;
  audioEvent('start'); publishOptions();
}
function receive(event: MessageEvent): void {
  if (!embedded || event.source !== window.parent || event.origin !== location.origin) return;
  const data = event.data;
  if (data?.type === 'wee:lobby-state' && data.sport === 'bowling') {
    const wasPaused = paused;
    const wasConnected = connected;
    connected = data.connected === true;
    const generation = data.inputGeneration ?? data.generation;
    if (generation !== inputGeneration || data.hostEpoch !== hostEpoch) lastAimSequence = -1;
    inputGeneration = generation;
    hostEpoch = data.hostEpoch;
    lobbyPaused = data.paused || !connected || !data.playing || typeof data.gameId !== 'string';
    manuallyPaused = data.manuallyPaused === true;
    paused = lobbyPaused || pageSuspended;
    sound?.setActive(!paused);
    if (typeof data.gameId !== 'string') {
      gameId = null;
      syncWorldState();
      if (world && wasPaused !== paused) render(world.getState());
      return;
    }
    if (!world || gameId !== data.gameId) {
      const players = (Array.isArray(data.players) ? data.players : []).map((p: {slot: number; name: string}) => ({player: p.slot + 1, name: p.name}));
      if (!players.length) return;
      audioEvent('roll-end');
      world?.dispose(); world = null; gameId = data.gameId; delivered.clear(); commands.clear();
      lastAimSequence = -1; lastCheckpoint = ''; restored = false;
      try { create(players); }
      catch (error) {
        el('frame-label').textContent = 'Lane unavailable';
        el('roll-status').textContent = 'Enable hardware acceleration, then reload the TV page.';
        console.error(error); return;
      }
    }
    syncWorldState();
    // Publish after reconnect even when pinfall did not change, without a snapshot feedback loop.
    if (wasPaused !== paused || wasConnected !== connected) render(world!.getState());
    if (wasConnected !== connected) publishOptions();
  } else if (data?.type === 'wee:checkpoint-request') {
    if (world && data.gameId === gameId) { lastCheckpoint = ''; publishCheckpoint(); }
  } else if (data?.type === 'wee:restore-checkpoint') {
    let ok = false;
    if (world && data.gameId === gameId && !restored && delivered.size === 0 && commands.size === 0) {
      restoring = true;
      ok = world.restoreCheckpoint(data.payload);
      restoring = false;
      if (ok) { restored = true; showAim(data.payload.settings.aim); lastCheckpoint = JSON.stringify(world.exportCheckpoint()); publishOptions(); }
    }
    post({type: 'wee:restore-checkpoint-result', gameId, ok, ...(ok ? {} : {error: 'checkpoint-unavailable'})});
  } else if (data?.type === 'wee:game-aim') {
    const aim = data.event;
    const sequence = aim?.seq ?? aim?.sequence;
    const generation = aim?.inputGeneration ?? aim?.generation;
    // World transitions publish synchronously. Live aim needs only the turn;
    // rebuilding eight ten-frame scorecards on every sensor packet adds work
    // to the same thread that renders the lane.
    const target = aimTarget;
    if (!world || paused || !connected || aim?.gameId !== gameId ||
        target?.phase !== 'ready' || aim.player !== target.currentPlayer ||
        !Number.isFinite(aim.aim) || Math.abs(aim.aim) > 1 || typeof aim.locked !== 'boolean' ||
        !Number.isSafeInteger(sequence) || sequence < 0 || sequence <= lastAimSequence ||
        (inputGeneration !== undefined && generation !== inputGeneration) ||
        (hostEpoch !== undefined && aim.hostEpoch !== hostEpoch)) return;
    lastAimSequence = sequence;
    world.setAim(aim.aim, aim.locked);
    showAim(aim.aim, aim.locked);
  } else if (data?.type === 'wee:game-command') {
    const command = data.command;
    if (!command || typeof command.id !== 'string') return;
    let result: {ok: boolean; error?: string};
    if (!world || command.gameId !== gameId) result = {ok: false, error: 'game-loading'};
    else if (!isGameCommand(command, 'bowling')) result = {ok: false, error: 'invalid-command'};
    else if (paused || !connected) result = {ok: false, error: 'paused'};
    else if (commands.has(command.id)) result = {ok: false, error: 'duplicate-command'};
    else if (world.getState().phase === 'rolling') result = {ok: false, error: 'ball-in-play'};
    else {
      commands.add(command.id);
      if (commands.size > 256) commands.delete(commands.values().next().value!);
      if (command.action === 'practice-start' || command.action === 'practice-stop') {
        const ok = world.setPractice(command.action === 'practice-start');
        result = ok ? {ok: true} : {ok: false, error: 'practice-requires-solo'};
        if (ok) { callouts.reset(); clearCallout(); delivered.clear(); showAim(0); world.setAim(0); publishOptions(); }
      } else { newMatch(); result = {ok: true}; }
    }
    post({type: 'wee:game-command-result', id: command.id, gameId, result});
  } else if (data?.type === 'wee:game-roll') {
    const roll = data.event;
    if (!roll || typeof roll.id !== 'string') return;
    let result: {ok: boolean; error?: string};
    if (!world || roll.gameId !== gameId) result = {ok: false, error: 'game-loading'};
    else if (paused) result = {ok: false, error: 'paused'};
    else if (delivered.has(roll.id)) result = {ok: false, error: 'duplicate-roll'};
    else {
      result = world.roll(roll);
      delivered.add(roll.id);
      if (delivered.size > 256) delivered.delete(delivered.values().next().value!);
    }
    post({type: 'wee:roll-result', id: roll.id, result});
  }
}
for (const label of [...Array.from({length: 10}, (_, i) => String(i + 1)), 'Total']) {
  const th = document.createElement('th'); th.scope = 'col'; th.textContent = label; el('score-head').append(th);
}
el('replay').onclick = () => { if (!paused) newMatch(); };
const scorecard = el('scorecard-dialog') as HTMLDialogElement;
el('open-scorecard').onclick = () => scorecard.showModal();
el('close-scorecard').onclick = () => scorecard.close();
scorecard.onclose = () => el('open-scorecard').focus({preventScroll: true});
scorecard.onclick = event => { if (event.target === scorecard) scorecard.close(); };
el('roll').onclick = () => {
  const player = world?.getState().currentPlayer;
  if (!world || !player || paused) return;
  const value = (id: string): number => Number((el(id) as HTMLInputElement).value);
  world.roll({player, aim: value('aim'), spin: value('spin'), power: value('power')});
};
el('aim').oninput = () => {
  const aim = Number((el('aim') as HTMLInputElement).value);
  world?.setAim(aim); showAim(aim);
};
const practiceButton = document.getElementById('practice');
if (practiceButton) practiceButton.onclick = () => {
  if (!world || paused) return;
  if (world.setPractice(!world.getState().practice)) { callouts.reset(); clearCallout(); showAim(0); world.setAim(0); publishOptions(); }
};
function syncWorldState(): void {
  paused = lobbyPaused || pageSuspended;
  sound?.setActive(!paused);
  if (paused) world?.stop();
  else world?.start();
}
function pauseShortcut(event: KeyboardEvent): void {
  if (!embedded || !gameId || pageSuspended || !shouldTogglePause(event)) return;
  event.preventDefault();
  post({type: 'wee:pause-toggle', gameId});
}
window.addEventListener('message', receive);
window.addEventListener('keydown', pauseShortcut);
try {
  if (!embedded) { create([{player: 1, name: 'Player 1'}]); el('local-controls').hidden = false; el('help').textContent = 'Choose your aim below, then roll.'; }
  post({type: 'wee:bridge-ready'});
} catch (error) {
  el('frame-label').textContent = 'Lane unavailable';
  el('roll-status').textContent = 'Enable hardware acceleration in your browser, then reload.';
  console.error(error);
}
window.addEventListener('pagehide', event => {
  clearCallout();
  audioEvent('stop');
  pageSuspended = true;
  syncWorldState();
  if (!event.persisted) {
    window.removeEventListener('message', receive);
    window.removeEventListener('keydown', pauseShortcut);
    world?.dispose(); sound?.dispose();
  }
});
window.addEventListener('pageshow', event => {
  if (!event.persisted) return;
  pageSuspended = false;
  if (embedded) lobbyPaused = true;
  syncWorldState();
  if (embedded) post({type: 'wee:bridge-ready'});
});
