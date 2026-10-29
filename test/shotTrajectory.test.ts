import { test } from 'vitest';
import { strict as assert } from 'node:assert';
import * as THREE from 'three';
import { planCourtShot, MIN_NET_HEIGHT } from '../src/World/shotTrajectory.ts';
import { createBall, hitBall, updateBallMotion, type BallUserData } from '../src/World/components/ball.ts';

for (const player of [1, 2] as const) {
    test(`player ${player} shots land in the opponent court and clear the net across contact positions`, () => {
        const ball = createBall(0, 1, 0);
        for (const x of [-4, 0, 4]) for (const depth of [1, 5, 10, 11.5]) {
            for (const y of [0.2, 1.2, 2.5]) for (const backhand of [false, true]) {
                const origin = new THREE.Vector3(x, y, player === 1 ? depth : -depth);
                const plan = planCourtShot(origin, player, backhand);
                if (!plan) throw new Error(`No plan for player ${player}, origin ${origin.toArray()}`);
                ball.position.copy(origin);
                hitBall(ball, plan.velocity, player === 1 ? 'player1' : 'player2');
                const data = ball.userData as BallUserData;
                let crossingHeight: number | null = null;
                for (let i = 0; i < 600 && data.bounceCount === 0; i++) {
                    const previous = ball.position.clone();
                    updateBallMotion(ball, 1 / 120);
                    if (previous.z * ball.position.z <= 0) {
                        const fraction = -previous.z / (ball.position.z - previous.z);
                        crossingHeight = previous.y + fraction * (ball.position.y - previous.y);
                    }
                }
                assert.equal(data.bounceCount, 1);
                assert.equal(data.firstBounceInBounds, true);
                assert.ok(ball.position.z * plan.target.z > 0);
                assert.ok(ball.position.distanceTo(plan.target) < 0.4);
                assert.ok(crossingHeight !== null && crossingHeight >= MIN_NET_HEIGHT);
            }
        }
        ball.geometry.dispose();
        (ball.material as THREE.Material).dispose();
    });
}

test('invalid contact positions do not produce unsafe launch values', () => {
    assert.equal(planCourtShot(new THREE.Vector3(NaN, 1, 10), 1, false), null);
    assert.equal(planCourtShot(new THREE.Vector3(0, 0, 10), 1, false), null);
    assert.equal(planCourtShot(new THREE.Vector3(0, 1, -10), 1, false), null);
});

test('targeted returns tolerate the substeps used at 30, 60, and 144 FPS', () => {
    for (const fps of [30, 60, 144]) {
        const ball = createBall(3.5, 0.8, 10);
        const plan = planCourtShot(ball.position, 1, false);
        if (!plan) throw new Error('Expected a valid shot');
        hitBall(ball, plan.velocity, 'player1');
        const step = (1 / fps) / Math.ceil(120 / fps);
        const data = ball.userData as BallUserData;
        for (let i = 0; i < fps * 5 * Math.ceil(120 / fps) && !data.bounceCount; i++) updateBallMotion(ball, step);
        assert.equal(data.bounceCount, 1);
        assert.equal(data.firstBounceInBounds, true);
        assert.ok(ball.position.distanceTo(plan.target) < 0.4);
        ball.geometry.dispose();
        (ball.material as THREE.Material).dispose();
    }
});


test('phone tilt controls lateral aim, with limited random spread and player perspective', () => {
    const origin = new THREE.Vector3(0, 1, 10);
    const left = planCourtShot(origin, 1, false, 0.006, { aimX: -1, random: () => 0.5 });
    const right = planCourtShot(origin, 1, false, 0.006, { aimX: 1, random: () => 0.5 });
    const varied = planCourtShot(origin, 1, false, 0.006, { aimX: 1, random: () => 1 });
    const opposite = planCourtShot(new THREE.Vector3(0, 1, -10), 2, false, 0.006, { aimX: 1, random: () => 0.5 });
    if (!left || !right || !varied || !opposite) throw new Error('Expected angle-based shot plans');
    assert.equal(left.target.x, -2.5);
    assert.equal(right.target.x, 2.5);
    assert.equal(varied.target.x, 2.75);
    assert.equal(opposite.target.x, -2.5);
    assert.equal(planCourtShot(origin, 1, false, 0.006, { aimX: NaN }), null);
    assert.equal(planCourtShot(origin, 1, false, 0.006, { aimX: 2 }), null);
});

test('extreme aimed shots and random spread still land inside court in actual physics', () => {
    const ball = createBall(0, 1, 0);
    for (const player of [1, 2] as const) for (const aimX of [-1, 0, 1]) for (const random of [0, 1]) for (const aimDepth of [-1, 0, 1]) {
        const origin = new THREE.Vector3(3, 0.6, player === 1 ? 10 : -10);
        const plan = planCourtShot(origin, player, false, 0.006, { aimX, aimDepth, random: () => random });
        if (!plan) throw new Error('Expected safe angle-based shot');
        ball.position.copy(origin);
        hitBall(ball, plan.velocity, player === 1 ? 'player1' : 'player2');
        const data = ball.userData as BallUserData;
        for (let i = 0; i < 600 && !data.bounceCount; i++) updateBallMotion(ball, 1 / 120);
        assert.equal(data.bounceCount, 1);
        assert.equal(data.firstBounceInBounds, true);
        assert.ok(ball.position.distanceTo(plan.target) < 0.4);
        assert.ok(plan.netHeight >= MIN_NET_HEIGHT);
    }
    ball.geometry.dispose();
    (ball.material as THREE.Material).dispose();
});

test('stronger phone swings travel faster and deeper, including long shots', () => {
    const origin = new THREE.Vector3(0, 1, 10);
    const soft = planCourtShot(origin, 1, false, 0.006, { power: 0, aimDepth: 0 });
    const hard = planCourtShot(origin, 1, false, 0.006, { power: 1, aimDepth: 0 });
    const long = planCourtShot(origin, 1, false, 0.006, { power: 1, aimDepth: 1 });
    if (!soft || !hard || !long) throw new Error('Expected powered shots');
    assert.ok(Math.abs(hard.target.z) > Math.abs(soft.target.z));
    assert.ok(hard.flightTime < soft.flightTime);
    assert.ok(hard.velocity.length() > soft.velocity.length());
    assert.ok(Math.abs(long.target.z) > 11.885);
    assert.equal(planCourtShot(origin, 1, false, 0.006, { power: NaN }), null);
    assert.equal(planCourtShot(origin, 1, false, 0.006, { power: 2 }), null);
});

test('opening serves stay in court even with maximum phone power and deep aim', () => {
    for (const player of [1, 2] as const) for (const aimX of [-1, 1]) {
        const origin = new THREE.Vector3(0, 1, player === 1 ? 10 : -10);
        const options = { power: 1, aimDepth: 1, aimX, random: () => 0.5 };
        const serve = planCourtShot(origin, player, false, 0.006, { ...options, serve: true });
        const rally = planCourtShot(origin, player, false, 0.006, options);
        if (!serve || !rally) throw new Error('Expected serve and rally plans');
        assert.ok(Math.abs(serve.target.z) <= 10);
        assert.ok(Math.abs(rally.target.z) > 11.885);
        const ball = createBall(origin.x, origin.y, origin.z);
        hitBall(ball, serve.velocity, player === 1 ? 'player1' : 'player2');
        const data = ball.userData as BallUserData;
        for (let step = 0; step < 600 && !data.bounceCount; step++) updateBallMotion(ball, 1 / 120);
        assert.equal(data.bounceCount, 1);
        assert.equal(data.firstBounceInBounds, true);
        assert.ok(serve.netHeight >= MIN_NET_HEIGHT);
        ball.geometry.dispose();
        (ball.material as THREE.Material).dispose();
    }
});
