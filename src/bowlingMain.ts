import {BowlingWorld, BowlingState} from './bowling/World';
import {awaitingBonus, createRollCallouts, frameMarks} from './bowling/scoreboard';
import {isGameCommand} from '../shared/protocol.js';
import {createSportsAudio} from './audio/sportsAudio';
import '../client/src/styles/tokens.css';
import './gameHud.css';
import './bowling.css';
import './theme.js';

const embedded = window.parent !== window;
const el = (id: string): HTMLElement => document.getElementById(id)!;
let world: BowlingWorld | null = null;
let gameId: string | null = null;
let paused = embedded;
let connected = false;
const sound = embedded ? null : createSportsAudio('bowling');
sound?.mountButton(document.querySelector('.bowling-heading') as HTMLElement);
sound?.setActive(!paused);
const delivered = new Set<string>();
const commands = new Set<string>();
const callouts = createRollCallouts();
let calloutTimer: ReturnType<typeof setTimeout> | null = null;
let complete = false;
const post = (message: object): void => { if (embedded) window.parent.postMessage(message, location.origin); };
document.body.classList.toggle('bowling-embedded', embedded);
el('replay').hidden = embedded;
function publishOptions(): void {
  if (gameId) post({type: 'wee:game-options', gameId, sport: 'bowling'});
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

function render(state: BowlingState): void {
  complete = state.complete;
  const call = callouts.observe(state, paused);
  if (paused || state.phase === 'rolling' || !state.lastRoll) clearCallout();
  if (state.phase !== 'rolling') audioEvent('roll-end');
  const player = state.players.find(p => p.player === state.currentPlayer);
  el('frame-label').textContent = state.complete ? 'Final · 10 frames' : `Frame ${state.frame} / 10 · Ball ${state.ball}`;
  const last = state.lastRoll;
  const result = last ? last.strike ? 'Strike!' : last.spare ? 'Spare!' : `${last.pins} ${last.pins === 1 ? 'pin' : 'pins'} down` : '';
  const cue = paused ? 'Paused · waiting for controllers' : state.complete ? 'Final scores' : state.phase === 'rolling' ? `${player?.name} · ball in play` :
    `${result ? `${result} · ` : ''}${player?.name}, ${last?.player === state.currentPlayer ? 'roll again' : 'your turn'}`;
  if (el('roll-status').textContent !== cue) el('roll-status').textContent = cue;
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
  el('ranking').replaceChildren(...state.ranking.map(p => {
    const item = document.createElement('li'); item.textContent = `${p.rank}. ${p.name} · ${p.total} points`; return item;
  }));
  (el('roll') as HTMLButtonElement).disabled = paused || state.phase !== 'ready';
  if (call) showCallout(call);
  post({type: 'wee:bowling-state', gameId, phase: state.phase, currentPlayer: state.currentPlayer, frame: state.frame});
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
  if (!paused) world.start();
  render(world.getState());
  publishOptions();
}
function newMatch(): void {
  audioEvent('stop');
  clearCallout(); callouts.reset();
  delivered.clear(); world?.reset();
  audioEvent('start'); publishOptions();
}
function receive(event: MessageEvent): void {
  if (!embedded || event.source !== window.parent || event.origin !== location.origin) return;
  const data = event.data;
  if (data?.type === 'wee:lobby-state' && data.sport === 'bowling') {
    const wasPaused = paused;
    const wasConnected = connected;
    connected = data.connected === true;
    paused = data.paused || !connected || !data.playing;
    sound?.setActive(!paused);
    if (typeof data.gameId !== 'string') return;
    if (!world || gameId !== data.gameId) {
      const players = (Array.isArray(data.players) ? data.players : []).map((p: {slot: number; name: string}) => ({player: p.slot + 1, name: p.name}));
      if (!players.length) return;
      audioEvent('roll-end');
      world?.dispose(); world = null; gameId = data.gameId; delivered.clear(); commands.clear();
      try { create(players); }
      catch (error) {
        el('frame-label').textContent = 'Lane unavailable';
        el('roll-status').textContent = 'Enable hardware acceleration, then reload the TV page.';
        console.error(error); return;
      }
    }
    if (paused) world!.stop(); else world!.start();
    // Publish after reconnect even when pinfall did not change, without a snapshot feedback loop.
    if (wasPaused !== paused || wasConnected !== connected) render(world!.getState());
    if (wasConnected !== connected) publishOptions();
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
      newMatch(); result = {ok: true};
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
el('roll').onclick = () => {
  const player = world?.getState().currentPlayer;
  if (!world || !player) return;
  const value = (id: string): number => Number((el(id) as HTMLInputElement).value);
  world.roll({player, aim: value('aim'), spin: value('spin'), power: value('power')});
};
el('aim').oninput = () => world?.setAim(Number((el('aim') as HTMLInputElement).value));
window.addEventListener('message', receive);
try {
  if (!embedded) { create([{player: 1, name: 'Player 1'}]); el('local-controls').hidden = false; el('help').textContent = 'Aim, choose your curve and power, then roll. X = strike · / = spare · ten frames to make your mark.'; }
  post({type: 'wee:bridge-ready'});
} catch (error) {
  el('frame-label').textContent = 'Lane unavailable';
  el('roll-status').textContent = 'Enable hardware acceleration in your browser, then reload.';
  console.error(error);
}
window.addEventListener('pagehide', event => {
  clearCallout();
  audioEvent('stop'); sound?.setActive(false);
  if (event.persisted) world?.stop();
  else { window.removeEventListener('message', receive); world?.dispose(); sound?.dispose(); }
});
window.addEventListener('pageshow', event => {
  if (!event.persisted) return;
  if (embedded) post({type: 'wee:bridge-ready'});
  else { sound?.setActive(!paused); if (!paused) world?.start(); }
});
