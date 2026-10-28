import {BowlingWorld, BowlingState} from './bowling/World';
import {formatFrame} from './bowling/match';
import '../client/src/styles/tokens.css';
import './bowling.css';

const embedded = window.parent !== window;
const el = (id: string): HTMLElement => document.getElementById(id)!;
let world: BowlingWorld | null = null;
let gameId: string | null = null;
let paused = embedded;
let connected = false;
const delivered = new Set<string>();
const post = (message: object): void => { if (embedded) window.parent.postMessage(message, location.origin); };

function render(state: BowlingState): void {
  const player = state.players.find(p => p.player === state.currentPlayer);
  el('turn').textContent = state.complete ? 'Every pin counts.' : `P${player?.player} · ${player?.name}`;
  el('frame-label').textContent = `Frame ${state.frame} / 10 · Ball ${state.ball}`;
  const last = state.lastRoll;
  el('roll-status').textContent = paused ? 'Match paused. Waiting for controllers.' : state.phase === 'rolling' ? 'Ball in play…' : state.complete ? 'Final scores are in.' :
    last ? `${last.strike ? 'Strike!' : last.spare ? 'Spare!' : `${last.pins} ${last.pins === 1 ? 'pin' : 'pins'} down.`} ${last.player !== state.currentPlayer ? 'Next player, your turn.' : 'Ready for your next roll.'}` : 'Your lane is ready. Line up and roll.';
  el('pin-status').textContent = state.complete ? '' : `${state.pinsStanding.length} pins standing`;
  const body = el('score-body'); body.replaceChildren();
  for (const score of state.players) {
    const row = document.createElement('tr');
    row.dataset.active = String(score.player === state.currentPlayer);
    row.style.setProperty('--player-color', `var(--p${score.player})`);
    const name = document.createElement('th'); name.scope = 'row'; name.textContent = `P${score.player} · ${score.name}`; row.append(name);
    score.frames.forEach((rolls, index) => {
      const cell = document.createElement('td');
      const deliveries = document.createElement('span'); deliveries.className = 'bowling-marks'; deliveries.textContent = formatFrame(rolls, index) || '·';
      const total = document.createElement('strong'); total.textContent = score.frameScores[index] === null ? '' : String(score.frameScores[index]);
      cell.append(deliveries, total); row.append(cell);
    });
    const total = document.createElement('td'); total.className = 'bowling-total'; total.textContent = String(score.total); row.append(total); body.append(row);
  }
  el('results').hidden = !state.complete;
  el('ranking').replaceChildren(...state.ranking.map(p => {
    const item = document.createElement('li'); item.textContent = `${p.rank}. ${p.name} · ${p.total} points`; return item;
  }));
  (el('roll') as HTMLButtonElement).disabled = paused || state.phase !== 'ready';
  post({type: 'wee:bowling-state', gameId, phase: state.phase, currentPlayer: state.currentPlayer, frame: state.frame});
}
function create(players: Array<{player: number; name: string}>): void {
  world = new BowlingWorld(el('lane'), players);
  world.onState = render;
  if (!paused) world.start();
  render(world.getState());
}
function receive(event: MessageEvent): void {
  if (!embedded || event.source !== window.parent || event.origin !== location.origin) return;
  const data = event.data;
  if (data?.type === 'wee:lobby-state' && data.sport === 'bowling') {
    const wasPaused = paused;
    const wasConnected = connected;
    connected = data.connected === true;
    paused = data.paused || !connected || !data.playing;
    if (typeof data.gameId !== 'string') return;
    if (!world || gameId !== data.gameId) {
      const players = (Array.isArray(data.players) ? data.players : []).map((p: {slot: number; name: string}) => ({player: p.slot + 1, name: p.name}));
      if (!players.length) return;
      world?.dispose(); world = null; gameId = data.gameId; delivered.clear();
      try { create(players); }
      catch (error) {
        el('turn').textContent = 'Could not open the lane';
        el('roll-status').textContent = 'Enable hardware acceleration, then reload the TV page.';
        console.error(error); return;
      }
    }
    if (paused) world!.stop(); else world!.start();
    // Publish after reconnect even when pinfall did not change, without a snapshot feedback loop.
    if (wasPaused !== paused || wasConnected !== connected) render(world!.getState());
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
el('replay').onclick = () => { if (!paused) { delivered.clear(); world?.reset(); } };
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
  el('turn').textContent = 'Could not open the lane';
  el('roll-status').textContent = 'Enable hardware acceleration in your browser, then reload.';
  console.error(error);
}
window.addEventListener('pagehide', event => { if (event.persisted) world?.stop(); else { window.removeEventListener('message', receive); world?.dispose(); } });
window.addEventListener('pageshow', event => { if (event.persisted && !paused) world?.start(); });
