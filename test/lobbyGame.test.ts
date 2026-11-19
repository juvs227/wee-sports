import { test, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { createPlayer } from '../src/Tennis/components/player';
import { createBall, type BallUserData } from '../src/Tennis/components/ball';
import { GameLogic, type TennisGameEvent, type StrokeResult } from '../src/Tennis/gameLogic';
import { chooseBotStroke, chooseBotPlacement, type BotStroke } from '../src/Tennis/botPlayer';
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
    const shotTargetMarker = new THREE.Mesh();
    const game = new GameLogic({ scene, player1, player2, ball,
        targetMarkers: [new THREE.Mesh(), new THREE.Mesh()], shotTargetMarker,
        onSwingFeedback: () => message => feedback.push(message),
        onGameEvent: event => events.push(event), onStrokeResult: result => strokes.push(result) });
    game.botEnabled = false;
    return { game, ball, player1, player2, feedback, events, strokes, shotTargetMarker };
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

test('a confirmed phone serve reaches real racket contact within two physics steps', async () => {
    for (const hand of ['Right', 'Left'] as const) for (const label of ['Forehand', 'Backhand'] as const) {
        const {game, ball, strokes} = await court();
        game.swing({id: 'quick-serve', hand, label, player: 1});
        expect((ball.userData as BallUserData).waitingForRacketHit).toBe(true);
        expect(strokes).toEqual([]); // Advancing the animation cannot award a hit.
        for (let step = 0; step < 2; step++) game.update(1 / 120);
        expect(strokes.filter(stroke => stroke.id === 'quick-serve')).toEqual([
            expect.objectContaining({result: 'hit', reason: 'Serve contact'}),
        ]);
        expect((ball.userData as BallUserData).waitingForRacketHit).toBe(false);
    }
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
    expect(game.getScore().player2).toBe(1);
    expect((ball.userData as BallUserData).isWaitingForServe).toBe(true);
    expect((ball.userData as BallUserData).servingPlayer).toBe('player2');
    expect(ball.position.z).toBe(-TENNIS_COURT.serveDepth);
});

test('team scoring uses points directly and 7–6 needs another point', () => {
    const score = new ScoreSystem();
    for (let i = 0; i < 6; i++) {score.awardPoint('player1', 'player2'); score.awardPoint('player2', 'player1');}
    score.awardPoint('player1', 'player2');
    expect(score.getScore()).toMatchObject({player1: 7, player2: 6, setsPlayer1: 0});
    score.awardPoint('player1', 'player2');
    expect(score.getScore()).toMatchObject({player1: 0, player2: 0, setsPlayer1: 1, completedSets: [{player1: 8, player2: 6}]});
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
    for (const server of ['player2', 'player2', 'player1', 'player1', 'player2', 'player2']) {
        forceSecondBounce();
        expect(data.servingPlayer).toBe(server);
        expect(ball.position.z).toBe(server === 'player1' ? TENNIS_COURT.serveDepth : -TENNIS_COURT.serveDepth);
    }
    forceSecondBounce();
    expect(events.filter(event => event.kind === 'set')).toEqual([{kind: 'set', player: 1, reason: 'second-bounce'}]);
    expect(data.serveDelayRemaining).toBe(3.2);
    // Set celebration is simulation time: polling/paused time cannot consume it.
    for (let i = 0; i < 10; i++) {game.getScore(); game.update(0);}
    expect(data.serveDelayRemaining).toBe(3.2);
    game.swing({label: 'Forehand', hand: 'Right', player: 2});
    expect(data.isWaitingForServe).toBe(true);
    for (let i = 0; i < 7; i++) forceSecondBounce();
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
    hand: 'Left' | 'Right', label: 'Forehand' | 'Backhand', lead: number, fps = 120,
    placement: {aim?: number; depth?: number; id?: string} = {}, beforeInput = () => {}) {
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
            beforeInput();
            game.swing({ label, hand, player: number, ...placement });
            return;
        }
        game.update(1 / fps);
    }
    throw new Error(`The live ball did not approach Player ${number}`);
}

for (const number of [1, 2] as const) {
    test(`P${number} can return short, normal and deep angled rallies with either stroke and hand`, async () => {
        for (const aim of [-1, 0, 1]) for (const depth of [-1, 0, 1]) {
            for (const hand of ['Right', 'Left'] as const) for (const label of ['Forehand', 'Backhand'] as const) {
                const state = await court();
                const opponent = number === 1 ? 2 : 1;
                // Begin with a legal held serve from the receiving player's side,
                // then generate the varied incoming shot through the public API.
                (state.ball.userData as BallUserData).servingPlayer = number === 1 ? 'player1' : 'player2';
                state.game.swing({label: 'Forehand', hand: 'Right', player: number});
                swingNearArrival(state, opponent, 'Right', 'Forehand', .3, 120, {id: 'opponent', aim, depth});
                for (let step = 0; step < 70; step++) state.game.update(1 / 120);
                expect(state.strokes.find(stroke => stroke.id === 'opponent')?.result).toBe('hit');
                swingNearArrival(state, number, hand, label, .08, 120, {id: 'return'});
                const player = number === 1 ? state.player1 : state.player2;
                const feet = player.group.position.clone();
                expect(Math.abs(player.swingHeightOffset)).toBeLessThanOrEqual(.7);
                state.game.update(1 / 120);
                expect(player.group.position.distanceTo(feet)).toBeLessThanOrEqual(player.movementSpeed / 120 + 1e-8);
                for (let step = 0; step < 100; step++) state.game.update(1 / 120);
                expect(state.strokes.filter(stroke => stroke.id === 'return'),
                    `P${number} ${hand} ${label}, aim=${aim}, depth=${depth}`).toEqual([
                    expect.objectContaining({result: 'hit'}),
                ]);
            }
        }
    }, 15000);
}

for (const number of [1, 2] as const) for (const hand of ['Right', 'Left'] as const) {
    for (const label of ['Forehand', 'Backhand'] as const) {
        test(`P${number} ${hand} ${label} contacts at 80–450 ms early but misses a 550 ms early swing`, async () => {
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
                    `lead=${lead}: ${state.feedback.join('; ')}`).toBe(lead <= .45);
            }
        });
    }
}

test('early acceptance immediately prepares a non-contact pose and still needs real contact', async () => {
    const state = await court();
    state.game.swing({label: 'Forehand', hand: 'Right', player: 1});
    swingNearArrival(state, 2, 'Right', 'Forehand', .3, 120, {id: 'prepared-return'});
    expect(state.player2.isPreparing).toBe(true);
    expect(state.player2.isSwinging).toBe(false);
    expect(state.player2.contactActive).toBe(false);
    expect(state.player2.actions[state.player2.currentAnimation!].time).toBeGreaterThan(0);
    expect(state.strokes.some(result => result.id === 'prepared-return')).toBe(false);
    expect((state.ball.userData as BallUserData).lastHitBy).toBe('player1');
    for (let step = 0; step < 90; step++) state.game.update(1 / 120);
    const result = state.strokes.find(result => result.id === 'prepared-return')!;
    expect(result.result).toBe('hit');
    expect(result.receivedToPreparationMs).toBeGreaterThanOrEqual(0);
    expect(result.receivedToContactMs!).toBeGreaterThanOrEqual(result.receivedToPreparationMs!);
    expect(state.player2.isPreparing).toBe(false);
});

test('timing assistance chooses an earlier reachable backhand instead of a wider later contact window', async () => {
    const state = await court();
    state.game.swing({label: 'Forehand', hand: 'Right', player: 1});
    swingNearArrival(state, 2, 'Left', 'Backhand', .3, 120, {id: 'responsive-backhand'});
    expect(state.player2.isPreparing).toBe(true);
    expect(state.strokes.some(stroke => stroke.id === 'responsive-backhand')).toBe(false);
    for (let step = 0; step < 30; step++) state.game.update(1 / 120);
    expect(state.strokes.find(stroke => stroke.id === 'responsive-backhand')).toMatchObject({result: 'hit'});
    expect((state.ball.userData as BallUserData).lastHitBy).toBe('player2');
});

test('40–120 ms delivery delays use the arriving ball state without adding another full wind-up', async () => {
    for (const fps of [30, 60, 144]) for (const delay of [.04, .08, .12]) {
        for (const label of ['Forehand', 'Backhand'] as const) {
            const state = await court();
            state.game.swing({label: 'Forehand', hand: 'Right', player: 1});
            // The player responds 160 ms before the baseline arrival. Delivery
            // consumes part of that lead while the live simulation continues.
            swingNearArrival(state, 2, 'Right', label, .16 - delay, fps, {id: 'delayed-input'});
            let elapsed = 0;
            const deadline = .16 - delay + 1 / fps;
            while (elapsed < deadline && !state.strokes.some(stroke => stroke.id === 'delayed-input')) {
                state.game.update(1 / fps); elapsed += 1 / fps;
            }
            expect(state.strokes.find(stroke => stroke.id === 'delayed-input'),
                `${fps} FPS ${label}, ${delay * 1000} ms delivery delay`).toMatchObject({result: 'hit'});
            expect(state.strokes.filter(stroke => stroke.id === 'delayed-input')).toHaveLength(1);
        }
    }
});

test.each([30, 60, 144])('visually timed phone returns tolerate 40–160 ms late delivery at %i FPS', async fps => {
    for (const number of [1, 2] as const) for (const hand of ['Right', 'Left'] as const) {
        for (const label of ['Forehand', 'Backhand'] as const) for (const late of [0, .04, .08, .12, .16]) {
            const state = await court();
            state.game.swing({label: 'Forehand', hand: 'Right', player: 1});
            if (number === 1) {
                swingNearArrival(state, 2, 'Right', 'Forehand', .3);
                for (let step = 0; step < 70; step++) state.game.update(1 / 120);
            }
            swingNearArrival(state, number, hand, label, -late, fps, {id: 'late-phone'});
            for (let frame = 0; frame < fps / 2 && !state.strokes.some(stroke => stroke.id === 'late-phone'); frame++) state.game.update(1 / fps);
            expect(state.strokes.filter(stroke => stroke.id === 'late-phone'),
                `P${number} ${hand} ${label} ${late * 1000}ms late at ${fps}FPS`).toEqual([
                expect.objectContaining({result: 'hit', reason: 'Racket contact'}),
            ]);
            expect(state.events.filter(event => event.kind === 'hit' && event.swingId === 'late-phone')).toHaveLength(1);
            expect((state.ball.userData as BallUserData).lastHitBy).toBe(number === 1 ? 'player1' : 'player2');
            expect((state.ball.userData as BallUserData).velocity.z * (number === 1 ? -1 : 1)).toBeGreaterThan(0);
            expect(state.game.getScore()).toMatchObject({player1: 0, player2: 0});
        }
    }
}, 30000);

test('a compensated return retains locked placement, lands legally and consumes the stroke once', async () => {
    const state = await court();
    state.game.swing({label: 'Forehand', hand: 'Right', player: 1});
    swingNearArrival(state, 2, 'Right', 'Forehand', -.12, 120, {id: 'late-placed', aim: .7, depth: -.6});
    expect(state.strokes.find(stroke => stroke.id === 'late-placed')).toMatchObject({result: 'hit'});
    const target = state.shotTargetMarker.position.clone();
    state.game.swing({label: 'Backhand', hand: 'Right', player: 2, id: 'duplicate', aim: -.8, depth: 1});
    expect(state.strokes.find(stroke => stroke.id === 'duplicate')).toMatchObject({result: 'rejected'});
    expect(state.shotTargetMarker.position).toEqual(target);
    expect(target.x).toBeCloseTo(-.7 * 2.1);
    expect(target.z).toBeCloseTo(8.5 - .6 * 3);
    const data = state.ball.userData as BallUserData;
    for (let step = 0; step < 240 && data.bounceCount === 0; step++) state.game.update(1 / 120);
    expect(data).toMatchObject({lastHitBy: 'player2', bounceCount: 1, firstBounceInBounds: true});
    expect(state.ball.position.x).toBeCloseTo(target.x, 1);
    expect(state.ball.position.z).toBeCloseTo(target.z, 1);
    expect(state.events.filter(event => event.kind === 'hit' && event.player === 2)).toHaveLength(1);
});

test.each(['expired', 'disabled', 'paused', 'stalled', 'new-round'] as const)('recent contact cannot cross the %s boundary', async boundary => {
    const state = await court();
    state.game.swing({label: 'Forehand', hand: 'Right', player: 1});
    if (boundary === 'disabled') state.game.configure({timingAssist: false});
    swingNearArrival(state, 2, 'Right', 'Forehand', boundary === 'expired' ? -.4 : -.12, 120, {id: 'stale-phone'}, () => {
        if (boundary === 'paused') state.game.clearPendingInputs();
        if (boundary === 'new-round') state.game.startRound();
        if (boundary === 'stalled') vi.spyOn(performance, 'now').mockReturnValue(performance.now() + 1000);
    });
    for (let step = 0; step < 120; step++) state.game.update(1 / 120);
    expect(state.strokes.find(stroke => stroke.id === 'stale-phone')?.result).not.toBe('hit');
    expect(state.events.some(event => event.kind === 'hit' && event.swingId === 'stale-phone')).toBe(false);
});

test.each([false, true])('late assistance cannot invent a historical reach after moving the player: %s', async moveAfter => {
    const state = await court();
    state.game.configure({autoMove: false});
    state.player2.group.position.x = 4;
    state.game.swing({label: 'Forehand', hand: 'Right', player: 1});
    swingNearArrival(state, 2, 'Right', 'Forehand', -.12, 120, {id: 'out-of-reach'}, () => {
        if (moveAfter) state.player2.group.position.x = state.ball.position.x;
    });
    for (let step = 0; step < 120; step++) state.game.update(1 / 120);
    expect(state.strokes.find(stroke => stroke.id === 'out-of-reach')?.result).not.toBe('hit');
    expect(state.events.some(event => event.kind === 'hit' && event.player === 2)).toBe(false);
});

test('a late return after a decided point cannot revive the rally, change the score or serve', async () => {
    const state = await court();
    state.game.swing({label: 'Forehand', hand: 'Right', player: 1});
    for (let step = 0; step < 1200 && state.game.getScore().player1 === 0; step++) state.game.update(1 / 120);
    const score = state.game.getScore(), position = state.ball.position.clone();
    state.game.swing({label: 'Forehand', hand: 'Right', player: 2, id: 'after-point'});
    expect(state.strokes.find(stroke => stroke.id === 'after-point')).toMatchObject({result: 'rejected'});
    expect(state.game.getScore()).toEqual(score);
    expect(state.ball.position).toEqual(position);
    expect((state.ball.userData as BallUserData).isWaitingForServe).toBe(true);
    expect(state.events.filter(event => event.kind === 'point')).toHaveLength(1);
    expect(state.events.filter(event => event.kind === 'serve')).toHaveLength(1);
});

test.each([false, true])('recent contact validates whether that historical flight was a serve: %s', async serve => {
    const state = await court(), player = state.player2;
    state.game.configure({autoMove: false});
    player.group.position.z = -4.5;
    player.playAnimation('SwingRight');
    const action = player.actions.SwingRight;
    action.stopFading(); action.setEffectiveWeight(1);
    action.time = action.getClip().duration * .35;
    player.update(0);
    const target = player.hitbox!.bounds.getCenter(new THREE.Vector3()).applyMatrix4(player.hitbox!.pose());
    player.group.position.x += -1.65 - target.x;
    target.x = -1.65;
    player.stopAnimation(); player.update(0);
    state.ball.position.copy(target).add(new THREE.Vector3(0, .05, .05));
    const data = state.ball.userData as BallUserData;
    data.isWaitingForServe = false; data.waitingForRacketHit = false;
    data.lastHitBy = 'player1'; data.servingPlayer = 'player1';
    data.isServeFlight = serve; data.serveReturnPending = serve;
    data.velocity.set(0, -.06, -.14);
    for (let step = 0; step < 100 && data.bounceCount === 0 && !data.isWaitingForServe; step++) state.game.update(1 / 120);
    expect(data).toMatchObject({bounceCount: 1, firstBounceInBounds: true, isWaitingForServe: false});
    // The current states now have the same legal first bounce. Only the
    // earlier ordinary rally volley was legal at the racket's actual position.
    for (let step = 0; step < 2; step++) state.game.update(1 / 120);
    state.game.swing({label: 'Forehand', hand: 'Right', player: 2, id: 'history-legality'});
    for (let step = 0; step < 40 && !state.strokes.some(stroke => stroke.id === 'history-legality'); step++) state.game.update(1 / 120);
    expect(state.strokes.find(stroke => stroke.id === 'history-legality')?.result === 'hit').toBe(!serve);
});

test('shorter standard assistance rejects a very early stroke while beginner retains more help', async () => {
    for (const assistance of ['standard', 'beginner'] as const) {
        const state = await court();
        state.game.configure({assistance});
        state.game.swing({label: 'Forehand', hand: 'Right', player: 1});
        swingNearArrival(state, 2, 'Right', 'Forehand', .55);
        for (let step = 0; step < 120; step++) state.game.update(1 / 120);
        expect(state.feedback.some(message => message.startsWith('Player 2: Hit!'))).toBe(assistance === 'beginner');
    }
});

test('a queued stroke expires after a wall-clock stall without releasing a stale hit', async () => {
    const state = await court();
    state.game.swing({label: 'Forehand', hand: 'Right', player: 1});
    swingNearArrival(state, 2, 'Right', 'Forehand', .3, 120, {id: 'stalled-return'});
    expect(state.player2.isPreparing).toBe(true);
    const stalledAt = performance.now() + 1000;
    vi.spyOn(performance, 'now').mockReturnValue(stalledAt);
    for (let step = 0; step < 120; step++) state.game.update(1 / 120);
    expect(state.strokes.find(result => result.id === 'stalled-return')).toMatchObject({result: 'miss'});
    expect(state.feedback.some(message => message.startsWith('Player 2: Hit!'))).toBe(false);
    expect(state.player2.isPreparing).toBe(false);
});

test('a waiting stroke captures explicit lateral and depth placement before contact', async () => {
    const state = await court();
    state.game.swing({label: 'Forehand', hand: 'Right', player: 1});
    const placement = {aim: .7, depth: -.6, id: 'placed-return'};
    swingNearArrival(state, 2, 'Right', 'Backhand', .3, 120, placement);
    expect(state.player2.isPreparing).toBe(true);
    placement.aim = -.9; placement.depth = 1;
    for (let step = 0; step < 90; step++) state.game.update(1 / 120);
    expect(state.strokes.find(result => result.id === 'placed-return')).toMatchObject({result: 'hit'});
    expect(state.shotTargetMarker.position.x).toBeCloseTo(-.7 * 2.1);
    expect(state.shotTargetMarker.position.z).toBeCloseTo(8.5 - .6 * 3);
});

test('an active phone stroke keeps its target and trace when a different placement arrives before contact', async () => {
    const state = await court();
    state.game.swing({label: 'Forehand', hand: 'Right', player: 1});
    swingNearArrival(state, 2, 'Right', 'Forehand', .08, 120, {aim: .7, depth: -.6, id: 'first-return'});
    expect(state.player2.isSwinging).toBe(true);
    expect(state.player2.hitConsumed).toBe(false);
    state.game.swing({label: 'Backhand', hand: 'Right', player: 2, aim: -.9, depth: 1, id: 'second-return'});
    expect(state.strokes.find(result => result.id === 'second-return')).toMatchObject({result: 'rejected', reason: 'Finish the current stroke'});
    expect(state.strokes.some(result => result.id === 'first-return')).toBe(false);
    for (let step = 0; step < 90; step++) state.game.update(1 / 120);
    expect(state.strokes.filter(result => result.id === 'first-return')).toHaveLength(1);
    expect(state.strokes.find(result => result.id === 'first-return')).toMatchObject({result: 'hit'});
    expect(state.shotTargetMarker.position.x).toBeCloseTo(-.7 * 2.1);
    expect(state.shotTargetMarker.position.z).toBeCloseTo(8.5 - .6 * 3);
});

test('an active bot stroke without a phone trace also rejects placement changes before contact', async () => {
    const state = await court();
    state.game.botEnabled = true;
    state.game.swing({label: 'Forehand', hand: 'Right', player: 1});
    for (let step = 0; step < 480 && !state.player2.isSwinging; step++) state.game.update(1 / 120);
    expect(state.player2.isSwinging).toBe(true);
    expect(state.player2.hitConsumed).toBe(false);
    const original = chooseBotPlacement(state.player1.group.position.x, 0, 'standard');
    state.game.swing({label: 'Backhand', hand: 'Right', player: 2, aim: -original.aim, depth: -1, id: 'interrupt-bot'});
    expect(state.strokes.find(result => result.id === 'interrupt-bot')).toMatchObject({result: 'rejected', reason: 'Finish the current stroke'});
    for (let step = 0; step < 90; step++) state.game.update(1 / 120);
    expect(state.feedback.some(message => message.startsWith('Player 2: Hit!'))).toBe(true);
    expect(state.shotTargetMarker.position.x).toBeCloseTo(-original.aim * 2.1);
    expect(state.shotTargetMarker.position.z).toBeCloseTo(8.5 + original.depth * .7);
    expect(state.strokes.filter(result => result.id === 'interrupt-bot')).toHaveLength(1);
});

test('untracked late input keeps strict contact timing, and pausing discards a prepared stroke', async () => {
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
    expect(paused.game.getScore().player1).toBe(1);
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
    expect(state.game.getScore().player1).toBe(1);
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
    expect(strokes.find(result => result.id === 'serve-a')!.receivedToPreparationMs).toBeGreaterThanOrEqual(0);
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

test('optional practice unlocks a visible placement target after three legal returns', async () => {
    const state = await court();
    state.game.startPractice('forehand');
    const score = state.game.getScore();
    for (let returned = 1; returned <= 3; returned++) {
        swingNearArrival(state, 1, 'Right', 'Forehand', .12);
        for (let step = 0; step < 240 && state.game.getPracticeState().cleanReturns < returned; step++) {
            state.game.update(1 / 120);
        }
        expect(state.game.getPracticeState().cleanReturns).toBe(returned);
        expect(Boolean(state.game.getPracticeState().target)).toBe(returned === 3);
    }
    state.game.update(1 / 120);
    expect(state.shotTargetMarker.visible).toBe(true);
    expect(state.shotTargetMarker.scale.x).toBe(4);
    expect(state.game.getScore()).toEqual(score);
    const target = state.game.getPracticeState().target!;
    target.x = 99;
    expect(state.game.getPracticeState().target!.x).not.toBe(99);
    state.game.stopPractice();
    state.game.update(1 / 120);
    expect(state.shotTargetMarker.visible).toBe(false);
    expect(state.shotTargetMarker.scale.x).toBe(1);
});

test('difficulty, timing assistance and movement are independent; legacy formats preserve the current match', async () => {
    const {game, ball} = await court();
    game.configure({assistance: 'beginner', botDifficulty: 'standard', autoMove: false, timingAssist: true});
    expect(game.getSettings()).toMatchObject({assistance: 'beginner', botDifficulty: 'standard', autoMove: false, timingAssist: true});
    game.configure({botDifficulty: 'beginner'});
    expect(game.getSettings()).toMatchObject({autoMove: false, timingAssist: true, botDifficulty: 'beginner'});
    game.configure({format: 'quick'});
    expect(game.getScore()).toMatchObject({format: 'full', targetPoints: 7, setsToWin: 2});
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
        expect(game.getScore()).toMatchObject({player1: 1, player2: 0,
            lastPoint: {player: 1, reason: 'serve-volley'}});
        expect(events.filter(event => event.kind === 'point')).toHaveLength(1);
    }
    expect(data.isWaitingForServe).toBe(true);
});


test('returning from practice preserves 1–2, the format, service side and second-serve attempt', async () => {
    const {game, ball} = await court();
    const data = ball.userData as BallUserData;
    for (const winner of ['player1', 'player2', 'player2'] as const) {
        ball.position.set(0, .11, winner === 'player1' ? -3 : 3);
        data.isWaitingForServe = false; data.waitingForRacketHit = false;
        data.velocity.set(0, -.1, 0); data.bounceCount = 1;
        data.firstBounceInBounds = true; data.lastHitBy = winner;
        game.update(1 / 120);
    }
    expect(game.getScore()).toMatchObject({player1: 1, player2: 2, serviceSide: 'ad'});
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
    expect(game.getScore()).toMatchObject({player2: 1, lastPoint: {reason: 'double-fault'}});
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
