import { World } from './World/World';
import { InputController } from './Controllers/inputController';
import type { BallUserData } from './World/components/ball';
import { connectSwings } from './network/swingConnection.js';
import { createInputId } from './network/inputId.js';
import { createSportsAudio } from './audio/sportsAudio';
import '../client/src/styles/tokens.css';
import './play.css';

async function main(): Promise<void> {
    const container = document.querySelector('#scene-container');
    if (!container) throw new Error('Could not find scene-container element');
    const world = new World(container as HTMLElement);
    const embedded = window.parent !== window;
    let lobbyPaused = embedded;
    let activeGameId: string | null = null;
    let publishedState = '';
    let names = ['Player 1', 'Bot'];
    if (!embedded) world.start();
    new InputController(input => world.setPlayerInput(lobbyPaused ? { moveX: 0, moveZ: 0 } : input, 1));

    const params = new URLSearchParams(location.search);
    const room = params.get('room') || createInputId().slice(0, 8);
    if (!/^[a-zA-Z0-9-]{6,40}$/.test(room)) throw new Error('Invalid room');
    const url = new URL(location.href);
    url.searchParams.set('room', room);
    history.replaceState(null, '', url);

    const panel = document.createElement('aside');
    panel.className = 'game-panel';
    panel.setAttribute('aria-label', 'Tennis scoreboard');
    panel.innerHTML = `<p class="play-eyebrow" id="match-mode">Tennis · solo</p>
      <p class="score-format" id="score-format">Best of 3 sets · advantage scoring</p>
      <div class="scoreboard">
        <div class="score-row" data-player="1"><span id="name-1"></span><strong id="points-1" aria-label="Player 1 points">0</strong><small id="games-1">Games 0</small><small id="sets-1">Sets 0</small></div>
        <div class="score-row" data-player="2"><span id="name-2"></span><strong id="points-2" aria-label="Player 2 points">0</strong><small id="games-2">Games 0</small><small id="sets-2">Sets 0</small></div>
      </div>
      <p id="completed-sets" class="play-muted"></p>
      <p id="point-result" role="status"></p>
      <p id="serve-status"></p><p id="feedback" role="status">Swing as the ball approaches your side.</p>
      <div id="match-result" hidden><p id="match-winner"></p><button id="play-again" class="primary">Play again</button></div>
      <details><summary>Court controls</summary><p id="connection"></p>
      <label><input id="auto" type="checkbox" checked> Automatic movement</label>
      <label id="bot-label"><input id="bot" type="checkbox" checked> Player 2 bot</label>
      <p>J/K: swing · B: practice feed · N: feed P2 · H: hitboxes. Turn off automatic movement for WASD.</p>
      <a id="phone-link">Open phone controller</a></details>`;
    document.body.append(panel);
    const sound = createSportsAudio('tennis');
    sound.mountButton(panel);
    sound.setActive(!lobbyPaused);
    const el = (id: string): HTMLElement => document.getElementById(id)!;
    const auto = el('auto') as HTMLInputElement;
    const bot = el('bot') as HTMLInputElement;
    auto.onchange = () => { world.autoPositionEnabled = auto.checked; };
    bot.onchange = () => { world.botEnabled = bot.checked; };
    el('bot-label').hidden = embedded;
    const link = el('phone-link') as HTMLAnchorElement;
    const controllerUrl = new URL('/controller.html', __PUBLIC_ORIGIN__ || location.origin);
    controllerUrl.searchParams.set('room', room);
    link.href = controllerUrl.href;
    link.hidden = embedded;
    world.onSwingFeedback = message => {
        el('feedback').textContent = message.replace(/Player ([12])/g, (_, number: string) => names[Number(number) - 1]);
    };
    world.onBallHit = player => {
        if (embedded && activeGameId && !lobbyPaused) {
            window.parent.postMessage({ type: 'wee:game-hit', player, gameId: activeGameId }, location.origin);
        }
    };
    const updateScore = (): void => {
        const score = world.getScore();
        el('name-1').textContent = `P1 · ${names[0]}`;
        el('name-2').textContent = `P2 · ${names[1]}`;
        el('points-1').textContent = String(score.player1);
        el('points-2').textContent = String(score.player2);
        el('games-1').textContent = `Games ${score.roundsPlayer1}`;
        el('games-2').textContent = `Games ${score.roundsPlayer2}`;
        el('sets-1').textContent = `Sets ${score.setsPlayer1}`;
        el('sets-2').textContent = `Sets ${score.setsPlayer2}`;
        el('score-format').textContent = score.tieBreak ? 'Tie-break · first to 7, win by 2'
            : score.player1 === 40 && score.player2 === 40 ? 'Deuce · win two points in a row'
            : score.player1 === 'Adv' || score.player2 === 'Adv'
                ? `Advantage · ${names[score.player1 === 'Adv' ? 0 : 1]}`
                : 'Best of 3 sets · advantage scoring';
        el('completed-sets').textContent = score.completedSets.map((set, index) => `Set ${index + 1}: ${set.player1}–${set.player2}`).join(' · ');
        const point = score.lastPoint;
        const pointScore = !score.tieBreak && score.player1 === 40 && score.player2 === 40 ? 'Deuce'
            : score.player1 === 'Adv' || score.player2 === 'Adv'
                ? `Advantage ${names[score.player1 === 'Adv' ? 0 : 1]}` : `${score.player1}–${score.player2}`;
        const result = point ? `${point.kind === 'match' ? 'Game, set and match' : point.kind[0].toUpperCase() + point.kind.slice(1)} · ${names[point.player - 1]}${point.kind === 'point' ? ` · ${pointScore}` : ''}` : '';
        // Keep the last scoring call visible independently of stroke feedback.
        // Only change live-region text on an actual change, not each score poll.
        if (el('point-result').textContent !== result) el('point-result').textContent = result;
        const ballData = world.ball.userData as BallUserData;
        const servingPlayer = score.server === 'player1' ? 0 : 1;
        const waiting = ballData.isWaitingForServe || ballData.waitingForRacketHit;
        const serveStatus = el('serve-status');
        const statusClass = lobbyPaused ? 'paused' : waiting && !score.matchWinner
            ? servingPlayer === 0 ? 'serving-p1' : 'serving-p2' : 'rally';
        serveStatus.className = statusClass;
        serveStatus.textContent = lobbyPaused ? 'Paused' : score.matchWinner ? 'Match complete'
            : waiting ? `${names[servingPlayer]} · ${ballData.serveDelayRemaining > 0 ? 'serves next' : 'serve when ready'}`
                : `Rally · ${names[servingPlayer]} serving`;
        el('match-result').hidden = !score.matchWinner;
        el('match-winner').textContent = score.matchWinner
            ? `${names[score.matchWinner === 'player1' ? 0 : 1]} wins · ${score.setsPlayer1}–${score.setsPlayer2} sets` : '';
        (el('play-again') as HTMLButtonElement).disabled = lobbyPaused;
        if (embedded && activeGameId && !lobbyPaused) {
            const state = { type: 'wee:tennis-state', gameId: activeGameId,
                phase: score.matchWinner ? 'complete' : waiting
                    ? ballData.serveDelayRemaining > 0 ? 'prepare' : 'serve' : 'rally',
                server: servingPlayer + 1,
                winner: score.matchWinner ? score.matchWinner === 'player1' ? 1 : 2 : null };
            const key = JSON.stringify(state);
            if (key !== publishedState) {
                publishedState = key;
                window.parent.postMessage(state, location.origin);
            }
        }
    };
    world.onGameEvent = event => {
        if (!lobbyPaused) sound.play(event.kind);
        // Point/serve callbacks can run just before the ball finishes its state
        // transition. Publish the settled status without delaying a swing.
        queueMicrotask(updateScore);
    };
    el('play-again').onclick = () => {
        if (lobbyPaused) return;
        world.startRound();
        updateScore();
    };
    const receiveState = (event: MessageEvent): void => {
        if (event.source !== window.parent || event.origin !== location.origin ||
            event.data?.type !== 'wee:lobby-state' || typeof event.data.paused !== 'boolean') return;
        const players = Array.isArray(event.data.players) ? event.data.players : [];
        const p1 = players.find((player: {slot: number}) => player.slot === 0);
        const p2 = players.find((player: {slot: number}) => player.slot === 1);
        activeGameId = typeof event.data.gameId === 'string' ? event.data.gameId : null;
        names = [p1?.name ?? 'Player 1', p2?.name ?? 'Bot'];
        world.botEnabled = !p2;
        world.setSplitScreen?.(Boolean(p2));
        el('match-mode').textContent = p2 ? 'Tennis · head to head' : 'Tennis · solo';
        lobbyPaused = event.data.paused || !event.data.connected;
        sound.setActive(!lobbyPaused);
        if (lobbyPaused) {
            publishedState = '';
            world.setPlayerInput({ moveX: 0, moveZ: 0 }, 1);
            world.setPlayerInput({ moveX: 0, moveZ: 0 }, 2);
            world.stop();
        } else world.start();
        updateScore();
    };
    window.addEventListener('message', receiveState);
    updateScore();
    const scoreTimer = window.setInterval(updateScore, 250);
    const connection = connectSwings({ room, role: 'game',
        onStatus: text => { el('connection').textContent = text; },
        onSwing: event => { if (!lobbyPaused) world.swing(event); },
    });
    window.addEventListener('pagehide', event => {
        sound.setActive(false);
        publishedState = '';
        if (event.persisted) { world.stop(); return; }
        window.clearInterval(scoreTimer);
        window.removeEventListener('message', receiveState);
        connection.close();
        world.dispose();
        sound.dispose();
    });
    window.addEventListener('pageshow', event => {
        if (!event.persisted) return;
        if (embedded) {
            // Restoring from browser history does not reload the iframe. Ask
            // the parent for current pause/connection state before resuming.
            window.parent.postMessage({ type: 'wee:bridge-ready' }, location.origin);
        } else { sound.setActive(true); world.start(); }
    });
}

main().catch((error: unknown) => { console.error(error); });
