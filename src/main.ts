import { World, type TennisSettings, type PracticeState } from './World/World';
import { InputController } from './Controllers/inputController';
import type { BallUserData } from './World/components/ball';
import { pointReasonLabel } from './World/tennisRules';
import { connectSwings } from './network/swingConnection.js';
import { createInputId } from './network/inputId.js';
import { createSportsAudio } from './audio/sportsAudio';
import { isGameCommand } from '../shared/protocol.js';
import '../client/src/styles/tokens.css';
import './play.css';
import './tennisHud.css';
import './theme.js';

type TennisCommand = {id: string; gameId: string} & (
    {action: 'configure'; settings: Partial<Omit<TennisSettings, 'format'>> & {splitView?: boolean}} |
    {action: 'new-match'; format: 'full' | 'quick'} |
    {action: 'practice-start'; stroke: PracticeState['stroke']; hand: PracticeState['hand']} |
    {action: 'practice-stop'}
);

async function main(): Promise<void> {
    const container = document.querySelector('#scene-container');
    if (!container) throw new Error('Could not find scene-container element');
    const world = new World(container as HTMLElement);
    const embedded = window.parent !== window;
    let lobbyPaused = embedded;
    let activeGameId: string | null = null;
    let publishedState = '';
    let publishedOptions = '';
    let lastResult = '';
    let resultUntil = 0;
    let strokeFeedback = '';
    let feedbackUntil = 0;
    const deliveredCommands = new Map<string, {ok: boolean; error?: string}>();
    let names = ['Player 1', 'Bot'];
    let humanOpponent = false;
    world.setSplitScreen(true);
    if (!embedded) world.start();
    new InputController(input => world.setPlayerInput(lobbyPaused ? { moveX: 0, moveZ: 0 } : input, 1));

    const params = new URLSearchParams(location.search);
    const room = params.get('room') || createInputId().slice(0, 8);
    if (!/^[a-zA-Z0-9-]{6,40}$/.test(room)) throw new Error('Invalid room');
    const url = new URL(location.href);
    url.searchParams.set('room', room);
    history.replaceState(null, '', url);

    const panel = document.createElement('aside');
    panel.className = 'game-panel tennis-hud';
    panel.setAttribute('aria-label', 'Tennis scoreboard');
    panel.setAttribute('data-embedded', String(embedded));
    panel.innerHTML = `<div class="tennis-scorestrip"><span class="visually-hidden" id="match-mode">Tennis · solo</span>
        <div class="tennis-seat" id="seat-1" data-player="1"><span class="tennis-player-name" id="name-1"></span><strong id="points-1" aria-label="Player 1 points">0</strong><span class="tennis-serving" id="server-1" aria-label="Serving"></span></div>
        <div class="tennis-score-context"><strong id="score-format">Set 1</strong><span id="games-progress">Games 0–0</span><span id="sets-progress">Sets 0–0</span></div>
        <div class="tennis-seat" id="seat-2" data-player="2"><span class="tennis-serving" id="server-2" aria-label="Serving"></span><strong id="points-2" aria-label="Player 2 points">0</strong><span class="tennis-player-name" id="name-2"></span></div>
      </div>
      <p id="completed-sets" class="visually-hidden"></p>
      <p id="coach" class="tennis-coach" role="status" aria-live="polite">Swing as the ball approaches your side.</p>
      <div id="match-result" class="tennis-result" hidden><p id="match-winner"></p><button id="play-again" class="primary">Play again</button></div>
      <details id="court-options" class="tennis-local-options"><summary>Play options & practice</summary><p id="connection"></p>
      <div class="tennis-options">
      <label>Match <select id="match-format"><option value="full">Full · best of 3 sets</option><option value="quick">Quick · tie-break to 7</option></select></label>
      <button id="new-match" type="button">Start new match</button>
      <label>Assistance <select id="assist-level"><option value="standard">Standard</option><option value="beginner">Beginner</option></select></label>
      <label>Bot challenge <select id="bot-level"><option value="standard">Standard</option><option value="beginner">Beginner</option></select></label>
      <label><input id="auto" type="checkbox" checked> Automatic movement</label>
      <label><input id="timing-assist" type="checkbox" checked> Timing assistance</label>
      <label id="split-label"><input id="split-view" type="checkbox" checked> Show my view and the bot’s view</label>
      <label id="bot-label"><input id="bot" type="checkbox" checked> Player 2 bot</label>
      </div>
      <section id="practice-controls" class="tennis-practice">
        <strong>Practice your returns</strong><p>Easy feeds, clear feedback. Your score is saved; returning replays the current point.</p>
        <label>Feed <select id="practice-stroke"><option value="alternate">Alternate strokes</option><option value="forehand">Forehands</option><option value="backhand">Backhands</option></select></label>
        <label>Playing hand <select id="practice-hand"><option value="Right">Right</option><option value="Left">Left</option></select></label>
        <button id="practice-start" type="button">Start practice</button><button id="practice-stop" type="button" hidden>Return to match</button>
        <p id="practice-progress" role="status"></p>
      </section>
      <p>J/K: swing · B: practice feed · N: feed P2 · H: hitboxes. Turn off automatic movement for WASD.</p>
      <a id="phone-link">Open phone controller</a></details>`;
    document.body.append(panel);
    const el = (id: string): HTMLElement => document.getElementById(id)!;
    el('court-options').hidden = embedded;
    el('play-again').hidden = embedded;
    // Homepage audio stays in the TV document that received the Play click.
    // Standalone prototypes retain their own explicit sound control.
    const sound = embedded ? null : createSportsAudio('tennis');
    sound?.mountButton(el('court-options'));
    sound?.setActive(!lobbyPaused);
    const playSound = (event: string): void => {
        if (lobbyPaused) return;
        if (embedded && activeGameId) window.parent.postMessage({ type: 'wee:game-audio', sport: 'tennis', gameId: activeGameId, event }, location.origin);
        else sound?.play(event);
    };
    const auto = el('auto') as HTMLInputElement;
    const bot = el('bot') as HTMLInputElement;
    const timing = el('timing-assist') as HTMLInputElement;
    const split = el('split-view') as HTMLInputElement;
    auto.onchange = () => { world.configure({ autoMove: auto.checked }); };
    timing.onchange = () => { world.configure({ timingAssist: timing.checked }); };
    split.onchange = () => { world.setSplitScreen(humanOpponent || split.checked); };
    el('assist-level').onchange = () => {
        world.configure({ assistance: (el('assist-level') as HTMLSelectElement).value as 'beginner' | 'standard' });
        const settings = world.getSettings(); auto.checked = settings.autoMove; timing.checked = settings.timingAssist;
    };
    el('bot-level').onchange = () => {
        world.configure({ botDifficulty: (el('bot-level') as HTMLSelectElement).value as 'beginner' | 'standard' });
    };
    bot.onchange = () => { world.botEnabled = bot.checked; };
    el('bot-label').hidden = embedded;
    const link = el('phone-link') as HTMLAnchorElement;
    const controllerUrl = new URL('/controller.html', __PUBLIC_ORIGIN__ || location.origin);
    controllerUrl.searchParams.set('room', room);
    link.href = controllerUrl.href;
    link.hidden = embedded;
    world.onSwingFeedback = message => {
        strokeFeedback = message.replace(/Player ([12])/g, (_, number: string) => names[Number(number) - 1]);
        feedbackUntil = performance.now() + 1400;
    };
    world.onBallHit = player => {
        if (embedded && activeGameId && !lobbyPaused) {
            window.parent.postMessage({ type: 'wee:game-hit', player, gameId: activeGameId }, location.origin);
        }
    };
    const publishOptions = (): void => {
        if (!embedded || !activeGameId || lobbyPaused) return;
        const practice = world.getPracticeState();
        const options = {type: 'wee:game-options', gameId: activeGameId, sport: 'tennis',
            settings: {...world.getSettings(), splitView: humanOpponent || split.checked},
            practice: {active: practice.active, stroke: practice.stroke, hand: practice.hand}, humanOpponent};
        const key = JSON.stringify(options);
        if (key !== publishedOptions) {
            publishedOptions = key;
            window.parent.postMessage(options, location.origin);
        }
    };
    const updateScore = (): void => {
        const score = world.getScore();
        const practice = world.getPracticeState();
        const serve = world.getServeState();
        el('name-1').textContent = names[0];
        el('name-2').textContent = names[1];
        el('points-1').textContent = String(score.player1);
        el('points-2').textContent = String(score.player2);
        const setNumber = Math.min(3, score.completedSets.length + (score.matchWinner ? 0 : 1));
        el('score-format').textContent = practice.active ? 'Practice'
            : score.matchWinner ? 'Final score'
            : score.tieBreak ? score.format === 'quick' ? 'Quick match' : 'Tie-break'
            : score.player1 === 40 && score.player2 === 40 ? 'Deuce'
            : score.player1 === 'Adv' || score.player2 === 'Adv'
                ? 'Advantage' : `Set ${setNumber}`;
        el('games-progress').textContent = score.format === 'quick' ? 'First to 7 · win by 2'
            : score.matchWinner ? `Sets ${score.setsPlayer1}–${score.setsPlayer2}`
                : `Games ${score.roundsPlayer1}–${score.roundsPlayer2}`;
        el('sets-progress').textContent = score.format === 'quick' ? ''
            : score.matchWinner ? score.completedSets.map(set => `${set.player1}–${set.player2}`).join(' · ')
                : `Sets ${score.setsPlayer1}–${score.setsPlayer2}`;
        el('completed-sets').textContent = score.completedSets.map((set, index) => `Set ${index + 1}: ${set.player1}–${set.player2}`).join(' · ');
        const point = score.lastPoint;
        const pointScore = !score.tieBreak && score.player1 === 40 && score.player2 === 40 ? 'Deuce'
            : score.player1 === 'Adv' || score.player2 === 'Adv'
                ? `Advantage ${names[score.player1 === 'Adv' ? 0 : 1]}` : `${score.player1}–${score.player2}`;
        const result = practice.active ? '' : point ? `${point.kind === 'match' ? score.format === 'quick' ? 'Match' : 'Game, set and match' : point.kind[0].toUpperCase() + point.kind.slice(1)} · ${names[point.player - 1]}${point.kind === 'point' ? ` · ${pointScore}` : ''}${point.reason ? ` · ${pointReasonLabel(point.reason)}` : ''}` : '';
        if (result !== lastResult) { lastResult = result; resultUntil = performance.now() + 1800; }
        const ballData = world.ball.userData as BallUserData;
        const servingPlayer = score.server === 'player1' ? 0 : 1;
        const waiting = ballData.isWaitingForServe || ballData.waitingForRacketHit;
        el('server-1').hidden = Boolean(score.matchWinner) || servingPlayer !== 0;
        el('server-2').hidden = Boolean(score.matchWinner) || servingPlayer !== 1;
        const coach = lobbyPaused ? 'Match paused · waiting for controllers'
            : practice.active ? `Practice · return the feed · ${practice.returns}/${practice.attempts} returned · streak ${practice.streak}`
            : score.matchWinner ? `${names[score.matchWinner === 'player1' ? 0 : 1]} wins${embedded ? ' · New match on your phone' : ''}`
            : result && performance.now() < resultUntil ? result
            : waiting ? `${serve.status === 'let' ? 'Let · replay serve · ' : serve.status === 'first-fault' ? 'Fault · second serve · ' : ''}${names[servingPlayer]}, ${ballData.serveDelayRemaining > 0 ? 'serve next' : 'serve when ready'} · ${serve.side === 'deuce' ? 'right' : 'left'} side`
            : performance.now() < feedbackUntil && strokeFeedback ? strokeFeedback : 'Rally · watch the ball';
        if (el('coach').textContent !== coach) el('coach').textContent = coach;
        el('match-result').hidden = embedded || practice.active || !score.matchWinner;
        el('match-winner').textContent = score.matchWinner
            ? `${names[score.matchWinner === 'player1' ? 0 : 1]} wins · ${score.format === 'quick' ? `${score.player1}–${score.player2}` : `${score.setsPlayer1}–${score.setsPlayer2} sets`}` : '';
        (el('play-again') as HTMLButtonElement).disabled = lobbyPaused;
        for (const id of ['new-match', 'practice-start', 'practice-stop']) (el(id) as HTMLButtonElement).disabled = lobbyPaused;
        el('practice-start').hidden = practice.active;
        el('practice-stop').hidden = !practice.active;
        el('practice-progress').textContent = practice.active ? `${practice.returns} / ${practice.attempts} returned · streak ${practice.streak} · best ${practice.bestStreak}` : '';
        if (embedded && activeGameId && !lobbyPaused) {
            const state = { type: 'wee:tennis-state', gameId: activeGameId,
                phase: practice.active ? 'rally' : score.matchWinner ? 'complete' : waiting
                    ? ballData.serveDelayRemaining > 0 ? 'prepare' : 'serve' : 'rally',
                server: servingPlayer + 1,
                winner: !practice.active && score.matchWinner ? score.matchWinner === 'player1' ? 1 : 2 : null,
                practice: practice.active, serveAttempt: serve.attempt };
            const key = JSON.stringify(state);
            if (key !== publishedState) {
                publishedState = key;
                window.parent.postMessage(state, location.origin);
            }
        }
        publishOptions();
    };
    world.onGameEvent = event => {
        playSound(event.kind);
        // Point/serve callbacks can run just before the ball finishes its state
        // transition. Publish the settled status without delaying a swing.
        queueMicrotask(updateScore);
    };
    world.onStrokeResult = result => {
        if (embedded && activeGameId && !lobbyPaused) window.parent.postMessage({
            ...result, type: 'wee:stroke-result', gameId: activeGameId,
        }, location.origin);
    };
    el('new-match').onclick = () => {
        if (lobbyPaused) return;
        playSound('stop');
        world.stopPractice();
        world.configure({ format: (el('match-format') as HTMLSelectElement).value as 'full' | 'quick' });
        world.startRound(); playSound('start'); updateScore();
    };
    el('practice-start').onclick = () => {
        if (lobbyPaused || humanOpponent) return;
        world.startPractice(
            (el('practice-stroke') as HTMLSelectElement).value as 'forehand' | 'backhand' | 'alternate',
            (el('practice-hand') as HTMLSelectElement).value as 'Right' | 'Left',
        );
        updateScore();
    };
    el('practice-stop').onclick = () => { if (!lobbyPaused) { world.stopPractice(); updateScore(); } };
    el('play-again').onclick = () => {
        if (lobbyPaused) return;
        playSound('stop');
        world.startRound();
        playSound('start');
        updateScore();
    };
    function runCommand(command: TennisCommand): {ok: boolean; error?: string} {
        if (!isGameCommand(command, 'tennis')) return {ok: false, error: 'bad-game-command'};
        if (!activeGameId || command.gameId !== activeGameId) return {ok: false, error: 'stale-game'};
        if (lobbyPaused) return {ok: false, error: 'paused'};
        const previous = deliveredCommands.get(command.id);
        if (previous) return previous;
        if (humanOpponent && (command.action.startsWith('practice-') ||
            (command.action === 'configure' && (command.settings.botDifficulty !== undefined || command.settings.splitView !== undefined)))) {
            return {ok: false, error: 'solo-only'};
        }
        if (command.action === 'configure') {
            const {splitView, ...settings} = command.settings;
            world.configure(settings);
            if (typeof splitView === 'boolean') {
                split.checked = splitView;
                world.setSplitScreen(splitView);
            }
            const current = world.getSettings();
            auto.checked = current.autoMove;
            timing.checked = current.timingAssist;
            (el('assist-level') as HTMLSelectElement).value = current.assistance;
            (el('bot-level') as HTMLSelectElement).value = current.botDifficulty;
        } else if (command.action === 'new-match') {
            playSound('stop');
            world.stopPractice();
            const previousFormat = world.getSettings().format;
            world.configure({format: command.format});
            // configure already restarts for a changed format.
            if (previousFormat === command.format) world.startRound();
            (el('match-format') as HTMLSelectElement).value = command.format;
            playSound('start');
        } else if (command.action === 'practice-start') {
            world.startPractice(command.stroke, command.hand);
        } else if (command.action === 'practice-stop') {
            world.stopPractice();
        }
        const result = {ok: true};
        deliveredCommands.set(command.id, result);
        if (deliveredCommands.size > 256) deliveredCommands.delete(deliveredCommands.keys().next().value!);
        updateScore();
        return result;
    }
    const receiveState = (event: MessageEvent): void => {
        if (event.source !== window.parent || event.origin !== location.origin) return;
        if (embedded && event.data?.type === 'wee:game-command') {
            const command = event.data.command;
            if (typeof command?.id !== 'string') return;
            const result = runCommand(command);
            window.parent.postMessage({type: 'wee:game-command-result', id: command.id,
                gameId: command.gameId, result}, location.origin);
            return;
        }
        if (event.data?.type !== 'wee:lobby-state' || typeof event.data.paused !== 'boolean') return;
        const players = Array.isArray(event.data.players) ? event.data.players : [];
        const p1 = players.find((player: {slot: number}) => player.slot === 0);
        const p2 = players.find((player: {slot: number}) => player.slot === 1);
        humanOpponent = Boolean(p2);
        const nextGameId = typeof event.data.gameId === 'string' ? event.data.gameId : null;
        if (nextGameId !== activeGameId) { deliveredCommands.clear(); publishedOptions = ''; }
        activeGameId = nextGameId;
        names = [p1?.name ?? 'Player 1', p2?.name ?? 'Bot'];
        world.botEnabled = !p2;
        world.setSplitScreen(humanOpponent || split.checked);
        el('split-label').hidden = humanOpponent;
        el('practice-controls').hidden = humanOpponent;
        (el('bot-level') as HTMLSelectElement).disabled = humanOpponent;
        el('match-mode').textContent = p2 ? 'Tennis · head to head' : 'Tennis · solo';
        lobbyPaused = event.data.paused || !event.data.connected;
        sound?.setActive(!lobbyPaused);
        if (lobbyPaused) {
            publishedState = '';
            publishedOptions = '';
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
        if (embedded && activeGameId) playSound('stop');
        sound?.setActive(false);
        publishedState = '';
        if (event.persisted) { world.stop(); return; }
        window.clearInterval(scoreTimer);
        window.removeEventListener('message', receiveState);
        connection.close();
        world.dispose();
        sound?.dispose();
    });
    window.addEventListener('pageshow', event => {
        if (!event.persisted) return;
        if (embedded) {
            // Restoring from browser history does not reload the iframe. Ask
            // the parent for current pause/connection state before resuming.
            window.parent.postMessage({ type: 'wee:bridge-ready' }, location.origin);
        } else { sound?.setActive(true); world.start(); }
    });
}

main().catch((error: unknown) => { console.error(error); });
