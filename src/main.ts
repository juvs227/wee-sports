import { World, type TennisSettings, type PracticeState } from './Tennis/World';
import { InputController } from './Controllers/inputController';
import type { BallUserData } from './Tennis/components/ball';
import { pointReasonLabel } from './Tennis/tennisRules';
import { connectSwings } from './network/swingConnection.js';
import { createInputId } from './network/inputId.js';
import { shouldTogglePause } from './network/pauseShortcut.js';
import { createSportsAudio } from './audio/sportsAudio';
import { isGameCommand } from '../shared/protocol.js';
import { browserDiagnostics } from '../shared/diagnostics.js';
import '../client/src/styles/tokens.css';
import './play.css';
import './tennisHud.css';
import './gameResults.css';
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
    const diagnostics = browserDiagnostics('game.tennis');
    const embedded = window.parent !== window;
    let lobbyPaused = embedded;
    let publishedCheckpoint = '';
    function publishCheckpoint(): void {
        if (!embedded || !activeGameId || paused) return;
        const payload = world.checkpoint();
        if (!payload) return;
        const key = JSON.stringify(payload);
        if (key === publishedCheckpoint) return;
        publishedCheckpoint = key;
        window.parent.postMessage({type:'wee:game-checkpoint',gameId:activeGameId,sport:'tennis',rulesVersion:1,checkpointVersion:1,payload}, location.origin);
    }
    let pageSuspended = false;
    let manuallyPaused = false;
    let paused = embedded;
    let activeGameId: string | null = null;
    let publishedState = '';
    let publishedOptions = '';
    let lastResult = '';
    let resultUntil = 0;
    let announcedSets = 0;
    let setResultUntil = 0;
    let scoreUpdatedAt = performance.now();
    const deliveredCommands = new Map<string, {ok: boolean; error?: string}>();
    let names = ['Player 1', 'Bot'];
    let humanOpponent = false;
    world.setSplitScreen(false);
    if (!embedded) world.start();
    new InputController(input => world.setPlayerInput(paused ? { moveX: 0, moveZ: 0 } : input, 1));

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
        <div class="tennis-seat" id="seat-1" data-player="1"><span class="tennis-player-name" id="name-1"></span><strong id="points-1" aria-label="Player 1 points">0</strong><span class="tennis-serving" id="server-1" role="img" aria-label="Serving"></span></div>
        <div class="tennis-score-context"><strong id="score-format">Set 1</strong><span id="points-target">First to 7 · win by 2</span><span id="sets-progress">Sets 0–0</span></div>
        <div class="tennis-seat" id="seat-2" data-player="2"><span class="tennis-serving" id="server-2" role="img" aria-label="Not serving" data-serving="false"></span><strong id="points-2" aria-label="Player 2 points">0</strong><span class="tennis-player-name" id="name-2"></span></div>
      </div>
      <p id="completed-sets" class="visually-hidden"></p>
      <p id="coach" class="tennis-coach" hidden role="status" aria-live="polite">Swing as the ball approaches your side.</p>
      <section id="set-result" class="tennis-set-result" role="status" aria-live="polite" hidden><span class="result-eyebrow" id="set-result-label"></span><strong id="set-winner"></strong><span id="set-result-score"></span><p id="set-next"></p></section>
      <section id="match-result" class="game-result-card" role="status" aria-live="polite" hidden>
        <div class="game-result-emblem" aria-hidden="true"><svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 5h12v7c0 5-2.5 8-6 8s-6-3-6-8V5Zm0 2H5v4c0 4 3 6 6 6m11-10h5v4c0 4-3 6-6 6M16 20v6m-5 2h10"/></svg></div>
        <p class="result-eyebrow" id="match-result-label">Match complete</p><p id="final-set-result"></p><h2 id="match-winner"></h2>
        <p class="game-result-score" id="match-result-score"></p><p class="game-result-detail" id="match-result-detail"></p>
        <p class="game-result-replay" id="match-replay-prompt"></p><button id="play-again" class="primary">Play again</button>
      </section>
      <details id="court-options" class="tennis-local-options"><summary>Play options & practice</summary><p id="connection"></p>
      <div class="tennis-options">
      <p>Best of 3 sets · first to 7 points, win by 2. Win 2 sets to win the match.</p>
      <button id="new-match" type="button">Start new match</button>
      <label>Assistance <select id="assist-level"><option value="standard">Standard</option><option value="beginner">Beginner</option></select></label>
      <label>Opponent <select id="bot-level"><option value="standard">Challenge</option><option value="beginner">Rally</option></select></label>
      <label><input id="auto" type="checkbox" checked> Automatic movement</label>
      <label><input id="timing-assist" type="checkbox" checked> Timing assistance</label>
      <label id="split-label" hidden><input id="split-view" type="checkbox"> Show my view and the bot’s view</label>
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
    const setText = (id: string, text: string): void => { if (el(id).textContent !== text) el(id).textContent = text; };
    el('court-options').hidden = embedded;
    el('play-again').hidden = embedded;
    // Homepage audio stays in the TV document that received the Play click.
    // Standalone prototypes retain their own explicit sound control.
    const sound = embedded ? null : createSportsAudio('tennis');
    sound?.mountButton(el('court-options'));
    sound?.setActive(!paused);
    const playSound = (event: string): void => {
        if (paused) return;
        if (embedded && activeGameId) window.parent.postMessage({ type: 'wee:game-audio', sport: 'tennis', gameId: activeGameId, event }, location.origin);
        else sound?.play(event);
    };
    const auto = el('auto') as HTMLInputElement;
    const bot = el('bot') as HTMLInputElement;
    const timing = el('timing-assist') as HTMLInputElement;
    const split = el('split-view') as HTMLInputElement;
    auto.onchange = () => { world.configure({ autoMove: auto.checked }); };
    timing.onchange = () => { world.configure({ timingAssist: timing.checked }); };
    split.onchange = () => { world.setSplitScreen(humanOpponent);
        document.documentElement.dataset.views = humanOpponent ? '2' : '1'; };
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
    world.onBallHit = player => {
        if (embedded && activeGameId && !paused) {
            window.parent.postMessage({ type: 'wee:game-hit', player, gameId: activeGameId }, location.origin);
        }
    };
    const publishOptions = (): void => {
        if (!embedded || !activeGameId || paused) return;
        const practice = world.getPracticeState();
        const options = {type: 'wee:game-options', gameId: activeGameId, sport: 'tennis',
            settings: {...world.getSettings(), splitView: humanOpponent},
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
        const now = performance.now();
        if (paused && setResultUntil > 0) setResultUntil += Math.max(0, now - scoreUpdatedAt);
        scoreUpdatedAt = now;
        if (score.completedSets.length < announcedSets) { announcedSets = score.completedSets.length; setResultUntil = 0; }
        if (score.completedSets.length > announcedSets) {
            announcedSets = score.completedSets.length;
            setResultUntil = now + 3200;
            const finished = score.completedSets[announcedSets - 1];
            const winner = finished.player1 > finished.player2 ? 0 : 1;
            setText('set-result-label', `Set ${announcedSets} complete`);
            setText('set-winner', `${names[winner]} wins the set`);
            setText('set-result-score', winner === 0 ? `${finished.player1}–${finished.player2}` : `${finished.player2}–${finished.player1}`);
            setText('set-next', `Set ${announcedSets + 1} · ${names[score.server === 'player1' ? 0 : 1]} serves next`);
        }
        el('name-1').textContent = names[0];
        el('name-2').textContent = names[1];
        el('points-1').textContent = String(score.player1);
        el('points-2').textContent = String(score.player2);
        const setNumber = Math.min(3, score.completedSets.length + (score.matchWinner ? 0 : 1));
        el('score-format').textContent = practice.active ? 'Practice'
            : score.matchWinner ? 'Final score' : `Set ${setNumber} of 3`;
        el('points-target').textContent = 'First to 7 · win by 2';
        el('sets-progress').textContent = score.matchWinner ? score.completedSets.map(set => `${set.player1}–${set.player2}`).join(' · ')
                : `Sets ${score.setsPlayer1}–${score.setsPlayer2}`;
        el('completed-sets').textContent = score.completedSets.map((set, index) => `Set ${index + 1}: ${set.player1}–${set.player2}`).join(' · ');
        const point = score.lastPoint;
        const pointScore = `${score.player1}–${score.player2}`;
        const result = practice.active ? '' : point ? `${point.kind === 'match' ? 'Set and match' : point.kind[0].toUpperCase() + point.kind.slice(1)} · ${names[point.player - 1]}${point.kind === 'point' ? ` · ${pointScore}` : ''}${point.reason ? ` · ${pointReasonLabel(point.reason)}` : ''}` : '';
        if (result !== lastResult) { lastResult = result; resultUntil = performance.now() + 1800; }
        const ballData = world.ball.userData as BallUserData;
        const servingPlayer = score.server === 'player1' ? 0 : 1;
        const waiting = ballData.isWaitingForServe || ballData.waitingForRacketHit;
        // A set celebration never follows the ball into the next live rally.
        if (!waiting) setResultUntil = 0;
        el('set-result').hidden = paused || practice.active || Boolean(score.matchWinner) || now >= setResultUntil;
        for (const index of [0, 1]) {
            const indicator = el(`server-${index + 1}`);
            const serving = !score.matchWinner && servingPlayer === index;
            indicator.dataset.serving = String(serving);
            indicator.setAttribute('aria-label', `${names[index]}: ${serving ? 'Serving' : 'Not serving'}`);
        }
        const coach = paused ? manuallyPaused ? 'Match paused · resume on your phone or TV' : 'Match paused · waiting for controllers'
            : practice.active ? practice.target ? `Aim for the ring · ${practice.targetHits} targets hit`
                : `Return ${Math.max(0, 3 - (practice.cleanReturns ?? 0))} clean balls to unlock target practice`
            : score.matchWinner ? `${names[score.matchWinner === 'player1' ? 0 : 1]} wins${embedded ? ' · New match on your phone' : ''}`
            : result && performance.now() < resultUntil ? result
            : waiting ? `${serve.status === 'let' ? 'Let · replay serve · ' : serve.status === 'first-fault' ? 'Fault · second serve · ' : ''}${names[servingPlayer]}, ${ballData.serveDelayRemaining > 0 ? 'serve next' : 'serve when ready'} · ${serve.side === 'deuce' ? 'right' : 'left'} side`
            : 'Rally · watch the ball';
        if (el('coach').textContent !== coach) el('coach').textContent = coach;
        el('coach').hidden = !practice.active;
        el('match-result').hidden = practice.active || !score.matchWinner;
        if (score.matchWinner) {
            const winner = score.matchWinner === 'player1' ? 0 : 1;
            setText('match-result-label', 'Match complete');
            const finalSet = score.completedSets[score.completedSets.length - 1];
            setText('final-set-result', `Set ${score.completedSets.length} complete · ${names[winner]} wins the set ${winner === 0 ? finalSet.player1 : finalSet.player2}–${winner === 0 ? finalSet.player2 : finalSet.player1}`);
            setText('match-winner', `${names[winner]} wins the match!`);
            setText('match-result-score', `${winner === 0 ? score.setsPlayer1 : score.setsPlayer2}–${winner === 0 ? score.setsPlayer2 : score.setsPlayer1} in sets`);
            setText('match-result-detail', score.completedSets.map(set => winner === 0 ? `${set.player1}–${set.player2}` : `${set.player2}–${set.player1}`).join(' · '));
            setText('match-replay-prompt', embedded ? 'Play again? Choose on your phone.' : 'Ready for another match?');
        }
        (el('play-again') as HTMLButtonElement).disabled = paused;
        for (const id of ['new-match', 'practice-start', 'practice-stop']) (el(id) as HTMLButtonElement).disabled = paused;
        el('practice-start').hidden = practice.active;
        el('practice-stop').hidden = !practice.active;
        el('practice-progress').textContent = practice.active ? `${practice.cleanReturns ?? 0} clean returns · ${practice.targetHits ?? 0} targets hit · best streak ${practice.bestStreak}` : '';
        if (embedded && activeGameId && !paused) {
            const state = { type: 'wee:tennis-state', gameId: activeGameId,
                phase: practice.active ? 'rally' : score.matchWinner ? 'complete' : waiting
                    ? ballData.serveDelayRemaining > 0 ? 'prepare' : 'serve' : 'rally',
                server: servingPlayer + 1,
                winner: !practice.active && score.matchWinner ? score.matchWinner === 'player1' ? 1 : 2 : null,
                practice: practice.active, serveAttempt: serve.attempt,
                score: [score.player1, score.player2], sets: [score.setsPlayer1, score.setsPlayer2],
                completedSets: score.completedSets, targetPoints: 7, setsToWin: 2 };
            const key = JSON.stringify(state);
            if (key !== publishedState) {
                publishedState = key;
                window.parent.postMessage(state, location.origin);
            }
        }
        publishOptions();
        publishCheckpoint();
    };
    world.onGameEvent = event => {
        if (event.swingId && (event.kind === 'serve' || event.kind === 'hit')) diagnostics.mark(event.swingId, 'contact');
        playSound(event.kind);
        // Point/serve callbacks can run just before the ball finishes its state
        // transition. Publish the settled status without delaying a swing.
        queueMicrotask(updateScore);
    };
    world.onStrokeResult = result => {
        diagnostics.count(`stroke.${result.result}`);
        if (result.receivedToPreparationMs !== undefined) diagnostics.observe('receivedToPreparationMs', result.receivedToPreparationMs);
        if (result.receivedToContactMs !== undefined) diagnostics.observe('receivedToContactMs', result.receivedToContactMs);
        if (embedded && activeGameId && !paused) window.parent.postMessage({
            ...result, type: 'wee:stroke-result', gameId: activeGameId,
        }, location.origin);
    };
    el('new-match').onclick = () => {
        if (paused) return;
        playSound('stop');
        world.stopPractice();
        world.configure({ format: 'full' });
        world.startRound(); playSound('start'); updateScore();
    };
    el('practice-start').onclick = () => {
        if (paused || humanOpponent) return;
        world.startPractice(
            (el('practice-stroke') as HTMLSelectElement).value as 'forehand' | 'backhand' | 'alternate',
            (el('practice-hand') as HTMLSelectElement).value as 'Right' | 'Left',
        );
        updateScore();
    };
    el('practice-stop').onclick = () => { if (!paused) { world.stopPractice(); updateScore(); } };
    el('play-again').onclick = () => {
        if (paused) return;
        playSound('stop');
        world.startRound();
        playSound('start');
        updateScore();
    };
    function runCommand(command: TennisCommand): {ok: boolean; error?: string} {
        if (!isGameCommand(command, 'tennis')) return {ok: false, error: 'bad-game-command'};
        if (!activeGameId || command.gameId !== activeGameId) return {ok: false, error: 'stale-game'};
        if (paused) return {ok: false, error: 'paused'};
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
                split.checked = humanOpponent;
                world.setSplitScreen(humanOpponent);
                document.documentElement.dataset.views = humanOpponent ? '2' : '1';
            }
            const current = world.getSettings();
            auto.checked = current.autoMove;
            timing.checked = current.timingAssist;
            (el('assist-level') as HTMLSelectElement).value = current.assistance;
            (el('bot-level') as HTMLSelectElement).value = current.botDifficulty;
        } else if (command.action === 'new-match') {
            playSound('stop');
            world.stopPractice();
            world.configure({format: 'full'});
            world.startRound();
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
        if (embedded && event.data?.type === 'wee:restore-checkpoint' && event.data.gameId === activeGameId) {
            const ok = world.restoreCheckpoint(event.data.payload);
            publishedState = ''; publishedCheckpoint = '';
            window.parent.postMessage({type:'wee:restore-checkpoint-result',gameId:activeGameId,ok}, location.origin);
            updateScore();
            return;
        }
        if (embedded && event.data?.type === 'wee:checkpoint-request' && event.data.gameId === activeGameId) {
            publishedCheckpoint = ''; publishCheckpoint(); return;
        }
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
        if (nextGameId !== activeGameId) { deliveredCommands.clear(); publishedOptions = ''; publishedCheckpoint = ''; }
        activeGameId = nextGameId;
        names = [p1?.name ?? 'Player 1', p2?.name ?? 'Bot'];
        world.botEnabled = !p2;
        world.setSplitScreen(humanOpponent);
        document.documentElement.dataset.views = humanOpponent ? '2' : '1';
        el('split-label').hidden = true;
        el('practice-controls').hidden = humanOpponent;
        (el('bot-level') as HTMLSelectElement).disabled = humanOpponent;
        el('match-mode').textContent = p2 ? 'Tennis · head to head' : 'Tennis · solo';
        lobbyPaused = event.data.paused || !event.data.connected || event.data.playing === false || !activeGameId;
        manuallyPaused = event.data.manuallyPaused === true;
        syncWorldState();
        updateScore();
    };
    function syncWorldState(): void {
        paused = lobbyPaused || pageSuspended;
        sound?.setActive(!paused);
        if (paused) {
            publishedState = '';
            publishedOptions = '';
            world.setPlayerInput({ moveX: 0, moveZ: 0 }, 1);
            world.setPlayerInput({ moveX: 0, moveZ: 0 }, 2);
            world.stop();
        } else world.start();
    }
    const pauseShortcut = (event: KeyboardEvent): void => {
        if (!embedded || !activeGameId || pageSuspended || !shouldTogglePause(event)) return;
        event.preventDefault();
        // The server owns pause state, including reconnect/setup restrictions.
        window.parent.postMessage({type: 'wee:pause-toggle', gameId: activeGameId}, location.origin);
    };
    window.addEventListener('message', receiveState);
    window.addEventListener('keydown', pauseShortcut);
    updateScore();
    const scoreTimer = window.setInterval(updateScore, 250);
    const connection = connectSwings({ room, role: 'game',
        onStatus: text => { el('connection').textContent = text; },
        onSwing: event => {
            if (!paused) {
                if (event.id) diagnostics.mark(event.id, 'received');
                world.swing(event);
            }
        },
    });
    window.addEventListener('pagehide', event => {
        if (embedded && activeGameId) playSound('stop');
        pageSuspended = true;
        syncWorldState();
        if (event.persisted) return;
        window.clearInterval(scoreTimer);
        window.removeEventListener('message', receiveState);
        window.removeEventListener('keydown', pauseShortcut);
        connection.close();
        world.dispose();
        sound?.dispose();
    });
    window.addEventListener('pageshow', event => {
        if (!event.persisted) return;
        pageSuspended = false;
        // Ignore snapshots received while hidden: restoring must first confirm
        // that this game still exists and that every participant can resume.
        if (embedded) lobbyPaused = true;
        syncWorldState();
        if (embedded) window.parent.postMessage({ type: 'wee:bridge-ready' }, location.origin);
    });
}

main().catch((error: unknown) => { console.error(error); });
