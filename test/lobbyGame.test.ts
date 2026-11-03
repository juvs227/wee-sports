import { test, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { createPlayer } from '../src/Tennis/components/player';
import { createBall, type BallUserData } from '../src/Tennis/components/ball';
import { GameLogic, type TennisGameEvent, type StrokeResult } from '../src/Tennis/gameLogic';
import { chooseBotStroke, type BotStroke } from '../src/Tennis/botPlayer';
import { ScoreSystem } from '../src/Tennis/scoreSystem';
import { predictBaselineIntercept } from '../src/Tennis/autoPosition';
import { TENNIS_COURT } from '../src/Tennis/tennisRules';

// Load the shipped models without a browser or renderer. Animation/contact are real.
afterEach(() => vi.restoreAllMocks());
async function court() {
    vi.spyOn(GLTFLoader.prototype, 'load').mockImplementation(function (url, onLoad) {
        const file = readFileSync(`public${url}`);
        void new GLTFLoader().parseAsync(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength), '').then(onLoad);
    });
    const scene = new THREE.Scene();
    const player1 = createPlayer(0, .25, 10, 0x3b82f6, {minX: -4.115, maxX: 4.115, minZ: 1, maxZ: TENNIS_COURT.serveDepth + .2});
    const player2 = createPlayer(0, .25, -10, 0xef4444, {minX: -4.115, maxX: 4.115, minZ: -TENNIS_COURT.serveDepth - .2, maxZ: -1});
    player2.group.rotation.y = Math.PI;
    scene.add(player1.group, player2.group);
    await vi.waitFor(() => { expect(player1.hitbox).toBeTruthy(); expect(player2.hitbox).toBeTruthy(); });
    // Never globally stub Math.random here: Three.js uses it to generate unique
    // binding IDs. Repeated UUIDs make different bones share animation bindings.
    const nodeIds: string[] = [];
    scene.traverse(node => nodeIds.push(node.uuid));
    expect(new Set(nodeIds).size).toBe(nodeIds.length);
    const ball = createBall(0, .3, 10);
    (ball.userData as BallUserData).serveDelayRemaining = 0;
    scene.add(ball);
    const feedback: string[] = [];
    const events: TennisGameEvent[] = [];
    const strokes: StrokeResult[] = [];
    const game = new GameLogic({ scene, player1, player2, ball,
        targetMarkers: [new THREE.Mesh(), new THREE.Mesh()], shotTargetMarker: new THREE.Mesh(),
        onSwingFeedback: () => message => feedback.push(message),
        onGameEvent: event => events.push(event), onStrokeResult: result => strokes.push(result) });
    game.botEnabled = false;
    return { game, ball, player1, player2, feedback, events, strokes };
}

for (const hand of ['Right', 'Left'] as const) for (const label of ['Forehand', 'Backhand'] as const) {
    test(`phone ${hand} ${label} serves through actual racket contact`, async () => {
        const { game, ball, feedback } = await court();
        game.swing({ label, hand, player: 1 });
        for (let i = 0; i < 120; i++) game.update(1 / 120);
        expect(feedback.some(message => message.startsWith('Player 1: Hit!'))).toBe(true);
        const data = ball.userData as BallUserData;
        expect(data.waitingForRacketHit).toBe(false);
        expect(data.lastHitBy).toBe('player1');
        expect(data.velocity.z).toBeLessThan(0);
    });
}

test('phone strength changes an actual serve only after racket contact', async () => {
    const speeds: number[] = [];
    for (const power of [.2, 1]) {
        const { game, ball, feedback } = await court();
        game.swing({ label: 'Forehand', hand: 'Right', player: 1, power });
        expect(feedback.some(message => message.startsWith('Player 1: Hit!'))).toBe(false);
        let time = 0;
        while (time < 1 && !(ball.userData as BallUserData).lastHitBy) {
            game.update(1 / 120);
            time += 1 / 120;
        }
        // A prepared serve already has lastHitBy; wait for actual release.
        while (time < 1 && (ball.userData as BallUserData).waitingForRacketHit) {
            game.update(1 / 120);
            time += 1 / 120;
        }
        expect(feedback.some(message => message.startsWith('Player 1: Hit!'))).toBe(true);
        speeds.push(Math.abs((ball.userData as BallUserData).velocity.z));
    }
    expect(speeds[1]).toBeGreaterThan(speeds[0]);
});

test.each(['Right', 'Left'] as const)('P2 %s-hand phone returns a real serve with the bot disabled, scores, and starts the next point', async hand => {
    const { game, ball, player2, feedback } = await court();
    game.swing({ label: 'Forehand', hand: 'Right', player: 2 });
    expect((ball.userData as BallUserData).isWaitingForServe).toBe(true);
    // Left-handed strokes use the opposite animation with their own hand pose.
    // Sample that pose, rather than using the right-handed bot's cached height.
    const strokes: BotStroke[] = hand === 'Right'
        ? Object.entries(player2.strikeOffsets).map(([name, offset]) => ({
            backhand: name === 'SwingLeft', offset, duration: player2.actions[name].getClip().duration }))
        : Object.entries(player2.actions)
        .filter(([name]) => ['SwingLeft', 'SwingRight'].includes(name))
        .map(([name, action]) => {
            const backhand = (name === 'SwingLeft') !== (hand === 'Left');
            player2.stopAnimation();
            player2.swingBackhand = backhand;
            player2.playAnimation(name);
            action.stopFading(); action.setEffectiveWeight(1);
            action.time = action.getClip().duration * .45;
            player2.update(0);
            const offset = player2.hitbox!.bounds.getCenter(new THREE.Vector3())
                .applyMatrix4(player2.hitbox!.pose()).sub(player2.group.position);
            player2.stopAnimation(); player2.update(0);
            return { backhand, offset, duration: action.getClip().duration };
        });
    game.swing({ label: 'Forehand', hand: 'Right', player: 1 });
    let sent = false;
    for (let i = 0; i < 1200; i++) {
        const data = ball.userData as BallUserData;
        if (!sent && data.lastHitBy === 'player1' && !data.waitingForRacketHit) {
            // Timing oracle only: all P2 input goes through the same public swing method as a phone.
            const stroke = chooseBotStroke({ position: ball.position, velocity: data.velocity, gravity: data.gravity }, player2.group.position, strokes);
            const intercept = stroke && predictBaselineIntercept({ position: ball.position, velocity: data.velocity, gravity: data.gravity }, player2.group.position.z + stroke.offset.z);
            if (stroke && intercept && intercept.time <= stroke.duration * .45) { game.swing({ label: stroke.backhand ? 'Backhand' : 'Forehand', hand, player: 2 }); sent = true; }
        }
        game.update(1 / 120);
    }
    expect(sent).toBe(true);
    expect(feedback.some(message => message.startsWith('Player 2: Hit!')), feedback.join('; ')).toBe(true);
    expect(game.getScore().player2).toBe(15);
    expect((ball.userData as BallUserData).isWaitingForServe).toBe(true);
    expect((ball.userData as BallUserData).servingPlayer).toBe('player1');
    expect(ball.position.z).toBe(TENNIS_COURT.serveDepth);
});

test('team scoring handles deuce, advantage reversal, and a completed game', () => {
    const score = new ScoreSystem();
    for (let i = 0; i < 3; i++) { score.awardPoint('player1', 'player2'); score.awardPoint('player2', 'player1'); }
    score.awardPoint('player1', 'player2'); expect(score.getScore().player1).toBe('Adv');
    score.awardPoint('player2', 'player1'); expect(score.getScore().player1).toBe(40);
    score.awardPoint('player2', 'player1'); score.awardPoint('player2', 'player1');
    expect(score.getScore()).toMatchObject({ player1: 0, player2: 0, roundsPlayer1: 0, roundsPlayer2: 1, server: 'player2' });
});

test('serve, bounce and point events occur once and polling does not replay them', async () => {
    const { game, events } = await court();
    game.swing({ label: 'Forehand', hand: 'Right', player: 1 });
    expect(events).toEqual([]);
    for (let i = 0; i < 1200; i++) game.update(1 / 120);
    expect(events.filter(event => event.kind === 'serve')).toEqual([{ kind: 'serve', player: 1 }]);
    expect(events.filter(event => event.kind === 'hit')).toEqual([]);
    expect(events.filter(event => event.kind === 'bounce')).toHaveLength(2);
    expect(events.filter(event => event.kind === 'point')).toEqual([{ kind: 'point', player: 1, reason: 'second-bounce' }]);
    const count = events.length;
    for (let i = 0; i < 20; i++) game.getScore();
    expect(events).toHaveLength(count);
});

test('ball reset uses the game server and match completion stops play until a rematch', async () => {
    const { game, ball, events } = await court();
    const data = ball.userData as BallUserData;
    const forceSecondBounce = () => {
        ball.position.set(0, .11, -3);
        data.isWaitingForServe = false;
        data.waitingForRacketHit = false;
        data.velocity.set(0, -.1, 0);
        data.bounceCount = 1;
        data.firstBounceInBounds = true;
        data.lastHitBy = 'player1';
        game.update(1 / 120);
    };
    for (let i = 0; i < 3; i++) {
        forceSecondBounce();
        expect(data.servingPlayer).toBe('player1');
        expect(ball.position.z).toBe(TENNIS_COURT.serveDepth);
    }
    forceSecondBounce();
    expect(data.servingPlayer).toBe('player2');
    expect(ball.position.z).toBe(-TENNIS_COURT.serveDepth);
    expect(events.filter(event => event.kind === 'game')).toEqual([{ kind: 'game', player: 1, reason: 'second-bounce' }]);
    for (let i = 4; i < 48; i++) forceSecondBounce();
    expect(game.getScore().matchWinner).toBe('player1');
    expect(events.filter(event => event.kind === 'match')).toEqual([{ kind: 'match', player: 1, reason: 'second-bounce' }]);
    const final = game.getScore();
    const finalEvents = events.length;
    game.swing({ label: 'Forehand', hand: 'Right', player: 1 });
    game.playerServe();
    game.feedPracticeBall();
    for (let i = 0; i < 300; i++) game.update(1 / 60);
    expect(game.getScore()).toEqual(final);
    expect(events).toHaveLength(finalEvents);
    expect(data.isWaitingForServe).toBe(true);
    game.startRound();
    expect(game.getScore()).toMatchObject({ matchWinner: null, player1: 0, setsPlayer1: 0, server: 'player1' });
    expect(data.serveDelayRemaining).toBe(0);
    game.swing({ label: 'Forehand', hand: 'Right', player: 1 });
    for (let i = 0; i < 120; i++) game.update(1 / 120);
    expect(events.slice(finalEvents).some(event => event.kind === 'serve')).toBe(true);
});

// Choose when a human input arrives, not which stroke will succeed. The public
// swing method must handle both stroke choices with the shipped animations.
function swingNearArrival(state: Awaited<ReturnType<typeof court>>, number: 1 | 2,
    hand: 'Left' | 'Right', label: 'Forehand' | 'Backhand', lead: number, fps = 120) {
    const { game, ball } = state;
    const player = number === 1 ? state.player1 : state.player2;
    const animation = (label === 'Backhand') !== (hand === 'Left') ? 'SwingLeft' : 'SwingRight';
    let delay = Infinity;
    for (let step = 0; step < fps * 5; step++) {
        const data = ball.userData as BallUserData;
        if (data.lastHitBy === (number === 1 ? 'player2' : 'player1') && !data.waitingForRacketHit) {
            const intercept = predictBaselineIntercept({
                position: ball.position, velocity: data.velocity, gravity: data.gravity,
                bounceCount: data.bounceCount,
            }, player.group.position.z + player.strikeOffsets[animation].z);
            if (intercept && intercept.time <= Math.max(0, lead) + 1 / fps && delay === Infinity) {
                delay = Math.max(0, -lead);
            }
        }
        if (delay !== Infinity) delay -= 1 / fps;
        if (delay <= 0) {
            game.swing({ label, hand, player: number });
            return;
        }
        game.update(1 / fps);
    }
    throw new Error(`The live ball did not approach Player ${number}`);
}

for (const number of [1, 2] as const) for (const hand of ['Right', 'Left'] as const) {
    for (const label of ['Forehand', 'Backhand'] as const) {
        test(`P${number} ${hand} ${label} tolerates inputs arriving 80–550 ms early with real model contact`, async () => {
            for (const lead of [.08, .16, .3, .45, .55]) {
                const state = await court();
                state.game.swing({ label: 'Forehand', hand: 'Right', player: 1 });
                if (number === 1) {
                    swingNearArrival(state, 2, 'Right', 'Forehand', .3);
                    for (let step = 0; step < 70; step++) state.game.update(1 / 120);
                    expect((state.ball.userData as BallUserData).lastHitBy).toBe('player2');
                }
                state.feedback.length = 0;
                swingNearArrival(state, number, hand, label, lead);
                for (let step = 0; step < 90; step++) state.game.update(1 / 120);
                expect(state.feedback.some(message => message.startsWith(`Player ${number}: Hit!`)),
                    `lead=${lead}: ${state.feedback.join('; ')}`).toBe(true);
            }
        });
    }
}

test('a late stroke misses, and pausing discards a prepared stroke', async () => {
    const late = await court();
    late.game.swing({ label: 'Forehand', hand: 'Right', player: 1 });
    swingNearArrival(late, 2, 'Right', 'Forehand', -.08);
    for (let step = 0; step < 120; step++) late.game.update(1 / 120);
    expect(late.feedback.some(message => message.startsWith('Player 2: Hit!'))).toBe(false);
    const paused = await court();
    paused.game.swing({ label: 'Forehand', hand: 'Right', player: 1 });
    swingNearArrival(paused, 2, 'Right', 'Forehand', .3);
    expect(paused.feedback.some(message => message.includes('meeting the incoming ball'))).toBe(true);
    paused.game.clearPendingInputs();
    for (let step = 0; step < 240; step++) paused.game.update(1 / 120);
    expect(paused.feedback.some(message => message.startsWith('Player 2: Hit!'))).toBe(false);
    expect(paused.game.getScore().player1).toBe(15);
});

test('24 consecutive human returns keep normal contact, then a missed ball scores only once', async () => {
    const state = await court();
    state.game.swing({ label: 'Forehand', hand: 'Right', player: 1 });
    for (let shot = 0; shot < 24; shot++) {
        const number = shot % 2 === 0 ? 2 : 1;
        state.feedback.length = 0;
        swingNearArrival(state, number, shot % 3 === 0 ? 'Left' : 'Right',
            shot % 2 === 0 ? 'Forehand' : 'Backhand', .3);
        for (let step = 0; step < 65; step++) state.game.update(1 / 120);
        expect(state.feedback.some(message => message.startsWith(`Player ${number}: Hit!`)),
            `shot=${shot}: ${state.feedback.join('; ')}`).toBe(true);
        expect(state.game.getScore().player1).toBe(0);
        expect(state.game.getScore().player2).toBe(0);
    }
    for (let step = 0; step < 600; step++) state.game.update(1 / 120);
    expect(state.game.getScore().player1).toBe(15);
    expect(state.game.getScore().player2).toBe(0);
});

test('cached racket poses match the live authored backhand animation', async () => {
    const { player1 } = await court();
    player1.stopAnimation();
    player1.swingBackhand = true;
    player1.playAnimation('SwingRight');
    const action = player1.actions['SwingRight'];
    action.stopFading();
    action.setEffectiveWeight(1);
    for (let sample = 1; sample <= 15; sample++) {
        player1.update(action.getClip().duration * .05);
        const actual = player1.group.matrixWorld.clone().invert().multiply(player1.hitbox!.pose());
        const cached = player1.swingPoses['SwingRight:true'][sample];
        const difference = Math.max(...actual.elements.map((value, index) => Math.abs(value - cached.elements[index])));
        expect(difference, `pose ${sample}`).toBeLessThan(.00001);
    }
});

test('the solo bot returns a phone serve using the shipped racket and normal contact', async () => {
    const state = await court();
    state.game.botEnabled = true;
    state.game.swing({ label: 'Forehand', hand: 'Right', player: 1 });
    for (let step = 0; step < 480; step++) state.game.update(1 / 120);
    expect(state.feedback.some(message => message.startsWith('Player 2: Hit!')),
        state.feedback.join('; ')).toBe(true);
});

test('a prepared keyboard serve can still be released by a phone swing', async () => {
    const state = await court();
    state.game.playerServe();
    expect((state.ball.userData as BallUserData).waitingForRacketHit).toBe(true);
    state.game.swing({ label: 'Forehand', hand: 'Right', player: 1 });
    for (let step = 0; step < 80; step++) state.game.update(1 / 120);
    expect(state.feedback.some(message => message.startsWith('Player 1: Hit!'))).toBe(true);
});

test('phone timing assistance remains playable at 30, 60, and 144 FPS', async () => {
    for (const fps of [30, 60, 144]) for (const label of ['Forehand', 'Backhand'] as const) {
        const state = await court();
        state.game.swing({ label: 'Forehand', hand: 'Right', player: 1 });
        swingNearArrival(state, 2, 'Right', label, .16, fps);
        for (let frame = 0; frame < fps; frame++) state.game.update(1 / fps);
        expect(state.feedback.some(message => message.startsWith('Player 2: Hit!')),
            `${fps} FPS ${label}: ${state.feedback.join('; ')}`).toBe(true);
    }
});


test('stroke diagnostics correlate accepted, rejected and paused inputs without borrowing a later hit', async () => {
    const state = await court();
    const {game, strokes} = state;
    game.swing({id: 'wrong-server', label: 'Forehand', hand: 'Right', player: 2});
    expect(strokes).toEqual([{id: 'wrong-server', player: 2, result: 'rejected', reason: 'Player 1 serves next'}]);
    game.swing({id: 'serve-a', label: 'Forehand', hand: 'Right', player: 1});
    game.swing({id: 'too-soon', label: 'Backhand', hand: 'Right', player: 1});
    expect(strokes.at(-1)).toMatchObject({id: 'too-soon', result: 'rejected'});
    for (let i = 0; i < 120; i++) game.update(1 / 120);
    expect(strokes.find(result => result.id === 'serve-a')).toMatchObject({result: 'hit', reason: 'Serve contact'});
    expect(strokes.find(result => result.id === 'serve-a')!.receivedToContactMs).toBeGreaterThanOrEqual(0);
    expect(strokes.filter(result => result.id === 'serve-a')).toHaveLength(1);
    game.swing({id: 'cancelled', label: 'Forehand', hand: 'Right', player: 2});
    game.clearPendingInputs();
    expect(strokes.find(result => result.id === 'cancelled')).toMatchObject({result: 'rejected'});
    expect(strokes.find(result => result.id === 'cancelled')!.receivedToContactMs).toBeUndefined();
});

test('practice feeds repeat without scoring, records real contact, and restores the match', async () => {
    const state = await court();
    const {game, ball} = state;
    game.botEnabled = true; // Lobby snapshots may leave this flag on.
    game.startPractice('forehand');
    const score = game.getScore();
    for (let i = 0; i < 40; i++) game.update(1 / 120);
    expect(game.getPracticeState()).toMatchObject({active: true, attempts: 1, returns: 0});
    swingNearArrival(state, 1, 'Right', 'Forehand', .12);
    for (let i = 0; i < 120; i++) game.update(1 / 120);
    expect(game.getPracticeState()).toMatchObject({returns: 1, streak: 1});
    for (let i = 0; i < 1400; i++) game.update(1 / 120);
    expect(game.getPracticeState().attempts).toBeGreaterThan(1);
    expect(game.getScore()).toEqual(score);
    game.stopPractice();
    expect(game.getPracticeState().active).toBe(false);
    expect((ball.userData as BallUserData).isWaitingForServe).toBe(true);
    expect(game.getScore()).toMatchObject({player1: 0, player2: 0, server: 'player1'});
});

test('difficulty, timing assistance and movement are independent; changing the format starts its new match', async () => {
    const {game, ball} = await court();
    game.configure({assistance: 'beginner', botDifficulty: 'standard', autoMove: false, timingAssist: true});
    expect(game.getSettings()).toMatchObject({assistance: 'beginner', botDifficulty: 'standard', autoMove: false, timingAssist: true});
    game.configure({botDifficulty: 'beginner'});
    expect(game.getSettings()).toMatchObject({autoMove: false, timingAssist: true, botDifficulty: 'beginner'});
    game.configure({format: 'quick'});
    expect(game.getScore()).toMatchObject({format: 'quick', tieBreak: true});
    const data = ball.userData as BallUserData;
    ball.position.set(0, .11, -3);
    hitForPoint();
    function hitForPoint() {
        data.isWaitingForServe = false; data.waitingForRacketHit = false;
        data.velocity.set(0, -.1, 0); data.bounceCount = 1;
        data.firstBounceInBounds = true; data.lastHitBy = 'player1';
        game.update(1 / 120);
    }
    expect(game.getScore().player1).toBe(1);
    game.configure({format: 'quick'});
    expect(game.getScore().player1).toBe(1); // Identical selection never erases a match.
});

test.each([false, true])('serve returned before bounce: net touch=%s resolves point or let', async netTouched => {
    const {game, ball, player2, events} = await court();
    const action = player2.actions.SwingRight;
    player2.swingBackhand = false;
    player2.playAnimation('SwingRight');
    action.stopFading(); action.setEffectiveWeight(1);
    action.time = action.getClip().duration * .45;
    player2.update(0);
    ball.position.copy(player2.hitbox!.bounds.getCenter(new THREE.Vector3()).applyMatrix4(player2.hitbox!.pose()));
    const data = ball.userData as BallUserData;
    data.isWaitingForServe = false; data.waitingForRacketHit = false;
    data.isServeFlight = true; data.serveReturnPending = true;
    data.servingPlayer = 'player1'; data.lastHitBy = 'player1';
    data.velocity.set(0, 0, 0); data.bounceCount = 0;
    data.netTouched = netTouched;
    data.serveAttempt = 2;
    game.update(1 / 120);
    if (netTouched) {
        expect(game.getScore()).toMatchObject({player1: 0, player2: 0, lastPoint: null});
        expect(events.filter(event => event.kind === 'let')).toHaveLength(1);
        expect(data.serveAttempt).toBe(2);
    } else {
        expect(game.getScore()).toMatchObject({player1: 15, player2: 0,
            lastPoint: {player: 1, reason: 'serve-volley'}});
        expect(events.filter(event => event.kind === 'point')).toHaveLength(1);
    }
    expect(data.isWaitingForServe).toBe(true);
});


test('returning from practice preserves 15–30, the format, service side and second-serve attempt', async () => {
    const {game, ball} = await court();
    const data = ball.userData as BallUserData;
    for (const winner of ['player1', 'player2', 'player2'] as const) {
        ball.position.set(0, .11, winner === 'player1' ? -3 : 3);
        data.isWaitingForServe = false; data.waitingForRacketHit = false;
        data.velocity.set(0, -.1, 0); data.bounceCount = 1;
        data.firstBounceInBounds = true; data.lastHitBy = winner;
        game.update(1 / 120);
    }
    expect(game.getScore()).toMatchObject({player1: 15, player2: 30, serviceSide: 'ad'});
    data.serveAttempt = 2; data.serveStatus = 'first-fault';
    const before = game.getScore();
    game.startPractice();
    for (let frame = 0; frame < 1200; frame++) game.update(1 / 120);
    expect(game.getPracticeState().attempts).toBeGreaterThan(1);
    game.stopPractice();
    expect(game.getScore()).toEqual(before);
    expect(game.getServeState()).toMatchObject({attempt: 2, status: 'first-fault', side: 'ad'});
});


test.each(['Forehand', 'Backhand'] as const)('left-handed practice feeds reach the authored %s contact pose', async label => {
    const state = await court();
    state.game.startPractice(label === 'Forehand' ? 'forehand' : 'backhand', 'Left');
    for (let i = 0; i < 40; i++) state.game.update(1 / 120);
    expect(state.game.getPracticeState()).toMatchObject({hand: 'Left', attempts: 1});
    swingNearArrival(state, 1, 'Left', label, .16);
    for (let i = 0; i < 120; i++) state.game.update(1 / 120);
    expect(state.game.getPracticeState().returns, state.feedback.join('; ')).toBe(1);
});


test('a completed service swing missing its held ball consumes an attempt, but rejection and pause do not', async () => {
    const {game, ball, strokes, events} = await court();
    const data = ball.userData as BallUserData;
    const miss = (id: string) => {
        data.serveDelayRemaining = 0;
        game.swing({id, label: 'Forehand', hand: 'Right', player: 1});
        // Preserve the authored animation but put the held ball beyond its path.
        ball.position.x = -20;
        for (let i = 0; i < 120; i++) game.update(1 / 120);
    };
    game.swing({id: 'wrong-seat', label: 'Forehand', hand: 'Right', player: 2});
    expect(data.serveAttempt).toBe(1);
    data.serveDelayRemaining = 1;
    game.swing({id: 'not-ready', label: 'Forehand', hand: 'Right', player: 1});
    expect(data.serveAttempt).toBe(1);
    data.serveDelayRemaining = 0;
    game.swing({id: 'paused-serve', label: 'Forehand', hand: 'Right', player: 1});
    game.clearPendingInputs();
    for (let i = 0; i < 120; i++) game.update(1 / 120);
    expect(data.serveAttempt).toBe(1);
    expect(game.getScore().player2).toBe(0);
    miss('miss-first');
    expect(data).toMatchObject({serveAttempt: 2, serveStatus: 'first-fault', isWaitingForServe: true});
    expect(game.getScore().player2).toBe(0);
    expect(strokes.find(result => result.id === 'miss-first')).toMatchObject({result: 'miss', reason: 'Service swing missed the ball'});
    expect(events.filter(event => event.kind === 'fault')).toHaveLength(1);
    miss('miss-second');
    expect(game.getScore()).toMatchObject({player2: 15, lastPoint: {reason: 'double-fault'}});
    expect(events.filter(event => event.kind === 'point')).toHaveLength(1);
});


test.each([
    ['Right', 'Backhand', -.02],
    ['Left', 'Forehand', -.04],
] as const)('%s %s can meet the remaining racket path after the nominal strike plane', async (hand, label, lead) => {
    const state = await court();
    state.game.swing({label: 'Forehand', hand: 'Right', player: 1});
    swingNearArrival(state, 2, hand, label, lead);
    for (let step = 0; step < 120; step++) state.game.update(1 / 120);
    expect(state.feedback.some(message => message.startsWith('Player 2: Hit!')), state.feedback.join('; ')).toBe(true);
});
