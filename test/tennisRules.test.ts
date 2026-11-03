import {expect, test} from 'vitest';
import * as THREE from 'three';
import {createBall, hitBall, updateBallMotion, BALL_RADIUS, type BallUserData} from '../src/Tennis/components/ball';
import {insideCourt, insideServiceBox, netHeightAt, TENNIS_COURT} from '../src/Tennis/tennisRules';
import {planCourtShot} from '../src/Tennis/shotTrajectory';
import {ScoreSystem} from '../src/Tennis/scoreSystem';
import {predictBaselineIntercept} from '../src/Tennis/autoPosition';

const dispose = (ball: THREE.Mesh): void => {ball.geometry.dispose(); (ball.material as THREE.Material).dispose();};
function droppingServe(attempt: 1 | 2 = 1) {
    const ball = createBall(1, BALL_RADIUS + .001, -4);
    const data = ball.userData as BallUserData;
    hitBall(ball, new THREE.Vector3(0, -.1, -.01), 'player1', true);
    data.serveAttempt = attempt;
    return {ball, data};
}

test('diagonal boxes and painted boundary contact are legal on both sides', () => {
    for (const server of [1, 2] as const) for (const side of ['deuce', 'ad'] as const) {
        const z = server === 1 ? -4 : 4;
        const x = (server === 1 ? -1 : 1) * (side === 'deuce' ? 2 : -2);
        expect(insideServiceBox(x, z, server, side, BALL_RADIUS)).toBe(true);
        expect(insideServiceBox(-x, z, server, side, BALL_RADIUS)).toBe(false);
        expect(insideServiceBox(x, -z, server, side, BALL_RADIUS)).toBe(false);
        expect(insideServiceBox(x, Math.sign(z) * 6.49, server, side, BALL_RADIUS)).toBe(true);
        expect(insideServiceBox(x, Math.sign(z) * 6.51, server, side, BALL_RADIUS)).toBe(false);
    }
    expect(insideCourt(TENNIS_COURT.halfWidth + .09, 3, BALL_RADIUS)).toBe(true);
    expect(insideCourt(TENNIS_COURT.halfWidth + .11, 3, BALL_RADIUS)).toBe(false);
});

test('a first fault preserves server/side, a second fault awards exactly one point', () => {
    const {ball, data} = droppingServe();
    const points: unknown[] = [], calls: unknown[] = [];
    const point = (...args: unknown[]): void => {points.push(args);};
    const call = (...args: unknown[]): void => {calls.push(args);};
    updateBallMotion(ball, 1 / 120, point, undefined, call);
    expect(points).toEqual([]);
    expect(calls).toEqual([['first-fault', 1]]);
    expect(data).toMatchObject({serveAttempt: 2, serviceSide: 'deuce', servingPlayer: 'player1', isWaitingForServe: true});
    ball.position.set(1, BALL_RADIUS + .001, -4);
    hitBall(ball, new THREE.Vector3(0, -.1, -.01), 'player1', true);
    updateBallMotion(ball, 1 / 120, point, undefined, call);
    expect(points).toEqual([['player2', 'player1', 'double-fault']]);
    expect(data.serveAttempt).toBe(1);
    for (let i = 0; i < 50; i++) updateBallMotion(ball, 1 / 120, point, undefined, call);
    expect(points).toHaveLength(1);
    dispose(ball);
});

test('a net-touch serve landing in the correct box repeats the same attempt; a wrong landing is a fault', () => {
    for (const attempt of [1, 2] as const) {
        const {ball, data} = droppingServe(attempt);
        ball.position.x = -1;
        data.netTouched = true;
        const calls: unknown[] = [], points: unknown[] = [];
        updateBallMotion(ball, 1 / 120, (...args) => points.push(args), undefined, (...args) => calls.push(args));
        expect(calls).toEqual([['let', 1]]);
        expect(points).toEqual([]);
        expect(data).toMatchObject({serveAttempt: attempt, serviceSide: 'deuce', serveStatus: 'let', isWaitingForServe: true});
        dispose(ball);
    }
    const {ball, data} = droppingServe(2);
    data.netTouched = true;
    const points: unknown[] = [];
    updateBallMotion(ball, 1 / 120, (...args) => points.push(args));
    expect(points).toEqual([['player2', 'player1', 'double-fault']]);
    dispose(ball);
});

test('swept net collision catches a fast low serve and a rally net ball cannot tunnel through', () => {
    const ball = createBall(0, .4, .2);
    const data = ball.userData as BallUserData;
    hitBall(ball, new THREE.Vector3(0, 0, -1), 'player1', true);
    updateBallMotion(ball, 1 / 120);
    expect(data.serveStatus).toBe('first-fault');
    expect(data.serveAttempt).toBe(2);
    ball.position.set(0, .4, .2);
    hitBall(ball, new THREE.Vector3(0, 0, -1), 'player1');
    const points: unknown[] = [];
    updateBallMotion(ball, 1 / 120, (...args) => points.push(args));
    expect(data.netTouched).toBe(true);
    expect(ball.position.z).toBeGreaterThan(0);
    for (let i = 0; i < 300 && !data.isWaitingForServe; i++) updateBallMotion(ball, 1 / 120, (...args) => points.push(args));
    expect(points).toEqual([['player2', 'player1', 'net']]);
    expect(predictBaselineIntercept({position: {x: 0, y: .4, z: .2}, velocity: {x: 0, y: 0, z: -1}, gravity: .006}, -3)).toBeNull();
    dispose(ball);
});

test('a net-tape clip stays live until its landing determines let or fault', () => {
    const ball = createBall(-1, netHeightAt(-1), .15);
    const data = ball.userData as BallUserData;
    hitBall(ball, new THREE.Vector3(0, 0, -.5), 'player1', true);
    updateBallMotion(ball, 1 / 120);
    expect(data.netTouched).toBe(true);
    expect(data.isWaitingForServe).toBe(false);
    expect(data.isServeFlight).toBe(true);
    expect(data.velocity.z).toBeLessThan(0);
    dispose(ball);
});

test('assisted serves land in alternating diagonal boxes through the real ball rules', () => {
    for (const player of [1, 2] as const) for (const side of ['deuce', 'ad'] as const) for (const power of [.2, .5, 1]) {
        const origin = new THREE.Vector3(player === 1 ? 1.3 : -1.3, 1.2, player === 1 ? 12 : -12);
        const plan = planCourtShot(origin, player, false, .006, power, {serve: side});
        expect(plan).not.toBeNull();
        const ball = createBall(origin.x, origin.y, origin.z);
        const data = ball.userData as BallUserData;
        data.servingPlayer = player === 1 ? 'player1' : 'player2';
        data.serviceSide = side;
        hitBall(ball, plan!.velocity, data.servingPlayer, true);
        for (let i = 0; i < 600 && data.bounceCount === 0 && !data.isWaitingForServe; i++) updateBallMotion(ball, 1 / 120);
        expect(data.isWaitingForServe).toBe(false);
        expect(data.bounceCount).toBe(1);
        expect(data.isServeFlight).toBe(false);
        expect(insideServiceBox(ball.position.x, ball.position.z, player, side, BALL_RADIUS)).toBe(true);
        dispose(ball);
    }
});

test('identical intent is repeatable while early and late intent produce controlled different placement', () => {
    const origin = new THREE.Vector3(.4, 1.2, 10);
    const first = planCourtShot(origin, 1, false, .006, .5, {timing: .8})!;
    for (let i = 0; i < 20; i++) expect(planCourtShot(origin, 1, false, .006, .5, {timing: .8})).toEqual(first);
    const late = planCourtShot(origin, 1, false, .006, .5, {timing: -.8})!;
    expect(Math.abs(first.target.x)).toBeGreaterThan(Math.abs(late.target.x));
    for (const aim of [-1, 0, 1] as const) {
        const plan = planCourtShot(origin, 1, false, .006, .5, {aim})!;
        expect(Math.sign(plan.target.x)).toBe(aim);
    }
});

test('quick match uses a seven-point tie-break, win by two, and freezes at completion', () => {
    const score = new ScoreSystem('quick');
    for (let i = 0; i < 6; i++) {
        score.awardPoint('player1', 'player2'); score.awardPoint('player2', 'player1');
    }
    expect(score.getScore()).toMatchObject({format: 'quick', player1: 6, player2: 6, matchWinner: null, serviceSide: 'deuce'});
    score.awardPoint('player1', 'player2');
    expect(score.getScore()).toMatchObject({player1: 7, player2: 6, matchWinner: null, serviceSide: 'ad'});
    expect(score.awardPoint('player1', 'player2')?.kind).toBe('match');
    expect(score.getScore()).toMatchObject({player1: 8, player2: 6, matchWinner: 'player1'});
    expect(score.awardPoint('player2', 'player1')).toBeNull();
    score.reset();
    expect(score.getScore()).toMatchObject({format: 'quick', tieBreak: true, player1: 0, player2: 0, server: 'player1'});
});
