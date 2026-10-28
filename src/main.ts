import { World } from './World/World';
import { InputController } from './Controllers/inputController';
import type { BallUserData } from './World/components/ball';
import { connectSwings } from './network/swingConnection.js';
import '../client/src/styles/tokens.css';
import './play.css';

async function main(): Promise<void> {
    const container = document.querySelector('#scene-container');
    if (!container) throw new Error('Could not find scene-container element');
    const world = new World(container as HTMLElement);
    const embedded = window.parent !== window;
    let lobbyPaused = embedded;
    let names = ['Player 1', 'Bot'];
    if (!embedded) world.start();
    new InputController(input => world.setPlayerInput(lobbyPaused ? { moveX: 0, moveZ: 0 } : input, 1));

    const params = new URLSearchParams(location.search);
    const room = params.get('room') || crypto.randomUUID().slice(0, 8);
    if (!/^[a-zA-Z0-9-]{6,40}$/.test(room)) throw new Error('Invalid room');
    const url = new URL(location.href);
    url.searchParams.set('room', room);
    history.replaceState(null, '', url);

    const panel = document.createElement('aside');
    panel.className = 'game-panel';
    panel.setAttribute('aria-label', 'Tennis scoreboard');
    panel.innerHTML = `<p class="play-eyebrow" id="match-mode">Tennis · solo</p>
      <div class="score-row" data-player="1"><span id="name-1"></span><strong id="points-1">0</strong></div>
      <div class="score-row" data-player="2"><span id="name-2"></span><strong id="points-2">0</strong></div>
      <p id="games" class="play-muted"></p><p id="serve-status"></p>
      <p id="feedback" role="status">Swing when the ball reaches your racket.</p>
      <details><summary>Court controls</summary><p id="connection"></p>
      <label><input id="auto" type="checkbox" checked> Automatic movement</label>
      <label id="bot-label"><input id="bot" type="checkbox" checked> Player 2 bot</label>
      <p>J/K: swing · B: practice feed · N: feed P2 · H: hitboxes. Turn off automatic movement for WASD.</p>
      <a id="phone-link">Open phone controller</a></details>`;
    document.body.append(panel);
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
    world.onSwingFeedback = message => { el('feedback').textContent = message; };
    const updateScore = (): void => {
        const score = world.getScore();
        el('name-1').textContent = `P1 · ${names[0]}`;
        el('name-2').textContent = `P2 · ${names[1]}`;
        el('points-1').textContent = String(score.player1);
        el('points-2').textContent = String(score.player2);
        el('games').textContent = `Games ${score.roundsPlayer1} – ${score.roundsPlayer2}`;
        el('serve-status').textContent = lobbyPaused ? 'Match paused' :
            (world.ball.userData as BallUserData).isWaitingForServe ? 'P1 · swing to serve' : 'Rally in play';
    };
    const receiveState = (event: MessageEvent): void => {
        if (event.source !== window.parent || event.origin !== location.origin ||
            event.data?.type !== 'wee:lobby-state' || typeof event.data.paused !== 'boolean') return;
        const players = Array.isArray(event.data.players) ? event.data.players : [];
        const p1 = players.find((player: {slot: number}) => player.slot === 0);
        const p2 = players.find((player: {slot: number}) => player.slot === 1);
        names = [p1?.name ?? 'Player 1', p2?.name ?? 'Bot'];
        world.botEnabled = !p2;
        el('match-mode').textContent = p2 ? 'Tennis · head to head' : 'Tennis · solo';
        lobbyPaused = event.data.paused || !event.data.connected;
        if (lobbyPaused) {
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
        if (event.persisted) { world.stop(); return; }
        window.clearInterval(scoreTimer);
        window.removeEventListener('message', receiveState);
        connection.close();
        world.dispose();
    });
    window.addEventListener('pageshow', event => {
        if (event.persisted && !embedded) world.start();
    });
}

main().catch((error: unknown) => { console.error(error); });
