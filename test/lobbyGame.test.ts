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
