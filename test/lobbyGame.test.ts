import { test, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { createPlayer } from '../src/World/components/player';
import { createBall, type BallUserData } from '../src/World/components/ball';
import { GameLogic } from '../src/World/gameLogic';
import { chooseBotStroke, type BotStroke } from '../src/World/botPlayer';
import { ScoreSystem } from '../src/World/scoreSystem';
import { predictBaselineIntercept } from '../src/World/autoPosition';

// Load the shipped models without a browser or renderer. Animation/contact are real.
afterEach(() => vi.restoreAllMocks());
async function court() {
    vi.spyOn(GLTFLoader.prototype, 'load').mockImplementation(function (url, onLoad) {
        const file = readFileSync(`public${url}`);
        void new GLTFLoader().parseAsync(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength), '').then(onLoad);
    });
    const scene = new THREE.Scene();
    const player1 = createPlayer(0, .25, 10, 0x3b82f6);
    const player2 = createPlayer(0, .25, -10, 0xef4444, { minZ: -11.5, maxZ: -1 });
    player2.group.rotation.y = Math.PI;
    scene.add(player1.group, player2.group);
    await vi.waitFor(() => { expect(player1.hitbox).toBeTruthy(); expect(player2.hitbox).toBeTruthy(); });
    const ball = createBall(0, .3, 10);
    scene.add(ball);
    const feedback: string[] = [];
    const game = new GameLogic({ scene, player1, player2, ball,
        targetMarkers: [new THREE.Mesh(), new THREE.Mesh()], shotTargetMarker: new THREE.Mesh(),
        onSwingFeedback: () => message => feedback.push(message) });
    game.botEnabled = false;
    return { game, ball, player1, player2, feedback };
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
    feedback.length = 0;
    game.swing({ label: 'Backhand', hand: 'Right', player: 1 });
    for (let i = 0; i < 120; i++) game.update(1 / 120);
    expect(feedback.some(message => message.startsWith('Player 1: Hit!'))).toBe(true);
});

test('team scoring handles deuce, advantage reversal, and a completed game', () => {
    const score = new ScoreSystem();
    for (let i = 0; i < 3; i++) { score.awardPoint('player1', 'player2'); score.awardPoint('player2', 'player1'); }
    score.awardPoint('player1', 'player2'); expect(score.getScore().player1).toBe('Adv');
    score.awardPoint('player2', 'player1'); expect(score.getScore().player1).toBe(40);
    score.awardPoint('player2', 'player1'); score.awardPoint('player2', 'player1');
    expect(score.getScore()).toEqual({ player1: 0, player2: 0, roundsPlayer1: 0, roundsPlayer2: 1 });
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
        test(`P${number} ${hand} ${label} tolerates inputs arriving 0–300 ms early with real model contact`, async () => {
            const random = vi.spyOn(Math, 'random');
            for (const seed of [.2, .5, .8]) for (const lead of [0, .08, .16, .3]) {
                random.mockReturnValue(seed);
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
                    `random=${seed}, lead=${lead}: ${state.feedback.join('; ')}`).toBe(true);
            }
        });
    }
}

test('a late stroke misses, and pausing discards a prepared stroke', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(.5);
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

test('consecutive human returns keep normal contact, then a missed ball scores only once', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(.5);
    const state = await court();
    state.game.swing({ label: 'Forehand', hand: 'Right', player: 1 });
    for (let shot = 0; shot < 8; shot++) {
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
    const random = vi.spyOn(Math, 'random');
    for (const seed of [.2, .5, .8]) {
        random.mockReturnValue(seed);
        const state = await court();
        state.game.botEnabled = true;
        state.game.swing({ label: 'Forehand', hand: 'Right', player: 1 });
        for (let step = 0; step < 480; step++) state.game.update(1 / 120);
        expect(state.feedback.some(message => message.startsWith('Player 2: Hit!')),
            `seed=${seed}: ${state.feedback.join('; ')}`).toBe(true);
    }
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
    vi.spyOn(Math, 'random').mockReturnValue(.5);
    for (const fps of [30, 60, 144]) for (const label of ['Forehand', 'Backhand'] as const) {
        const state = await court();
        state.game.swing({ label: 'Forehand', hand: 'Right', player: 1 });
        swingNearArrival(state, 2, 'Right', label, .16, fps);
        for (let frame = 0; frame < fps; frame++) state.game.update(1 / fps);
        expect(state.feedback.some(message => message.startsWith('Player 2: Hit!')),
            `${fps} FPS ${label}: ${state.feedback.join('; ')}`).toBe(true);
    }
});
