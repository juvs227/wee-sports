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
