import { test } from 'vitest';
import { strict as assert } from 'node:assert';
import { predictBaselineIntercept, lateralSteering, predictFirstLanding, chooseTrackingTarget } from '../src/World/autoPosition.ts';
import { createBall, hitBall, updateBallMotion, type BallUserData } from '../src/World/components/ball.ts';
import * as THREE from 'three';

test('predicts an approaching ball at either baseline instead of chasing current X', () => {
    const incoming = { position: { x: 0, y: 2, z: 0 }, velocity: { x: 0.1, y: 0, z: 0.2 }, gravity: 0 };
    const result = predictBaselineIntercept(incoming, 6);
    if (result === null) throw new Error('Expected an intercept for the approaching ball');
    assert.ok(Math.abs(result.x - 3) < 1e-6);
    assert.ok(Math.abs(result.time - 0.5) < 1e-6);
    assert.equal(predictBaselineIntercept(incoming, -6), null);
    assert.equal(predictBaselineIntercept({ ...incoming, velocity: { x: 0.1, y: 0, z: -0.2 } }, -6)?.x.toFixed(2), '3.00');
});

test('forecast matches actual ball integration through a bounce', () => {
    const ball = createBall(0, 0.4, 0);
    const velocity = new THREE.Vector3(0.08, -0.04, 0.2);
    hitBall(ball, velocity, 'player2');
    const predicted = predictBaselineIntercept({ position: ball.position, velocity, gravity: 0.006 }, 3);
    if (predicted === null) throw new Error('Expected an intercept after the bounce');
    let previous = ball.position.clone();
    let actualX = 0;
    let actualY = 0;
    for (let i = 0; i < 480; i++) {
        previous.copy(ball.position);
        updateBallMotion(ball, 1 / 120);
        if (ball.position.z >= 3) {
            const fraction = (3 - previous.z) / (ball.position.z - previous.z);
            actualX = previous.x + fraction * (ball.position.x - previous.x);
            actualY = previous.y + fraction * (ball.position.y - previous.y);
            break;
        }
    }
    assert.ok(Math.abs(predicted.x - actualX) < 1e-6);
    assert.ok(Math.abs(predicted.y - actualY) < 1e-6);
    ball.geometry.dispose();
    (ball.material as THREE.Material).dispose();
});

test('stationary, invalid, and beyond-horizon balls produce no intercept', () => {
    const ball = { position: { x: 0, y: 2, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, gravity: 0 };
    assert.equal(predictBaselineIntercept(ball, 10), null);
    assert.equal(predictBaselineIntercept({ ...ball, velocity: { x: 0, y: 0, z: NaN } }, 10), null);
    assert.equal(predictBaselineIntercept({ ...ball, velocity: { x: 0, y: 0, z: 0.001 } }, 10), null);
});

test('steering slows near the target, stays bounded, and does not overshoot at normal frame rates', () => {
    assert.equal(lateralSteering(0, 10), 1);
    assert.equal(lateralSteering(0, -10), -1);
    assert.equal(lateralSteering(0.98, 1), 0);
    let x = 0;
    for (let i = 0; i < 240; i++) {
        const input = lateralSteering(x, 1);
        x += input * 4 / 60;
        assert.ok(x <= 1);
    }
    assert.ok(Math.abs(1 - x) <= 0.04);
});

 test('first-landing forecast distinguishes playable and long shots using actual physics', () => {
    for (const vz of [-0.15, -0.5]) {
        const ball = createBall(0, 1, 5);
        const velocity = new THREE.Vector3(0, 0.2, vz);
        const landing = predictFirstLanding({ position: ball.position, velocity, gravity: 0.006 });
        if (!landing) throw new Error('Expected first landing');
        hitBall(ball, velocity, 'player1');
        const data = ball.userData as BallUserData;
        for (let i = 0; i < 1200 && !data.bounceCount; i++) updateBallMotion(ball, 1 / 120);
        assert.ok(Math.abs(ball.position.z - landing.z) < 1e-6);
        assert.equal(Math.abs(landing.z) <= 11.885, data.firstBounceInBounds);
        assert.equal(data.firstBounceInBounds, vz === -0.15);
        ball.geometry.dispose();
        (ball.material as THREE.Material).dispose();
    }
});

 test('tracking moves forward for short in-bounds balls and mirrors court sides', () => {
    for (const side of [1, 2] as const) {
        const sign = side === 1 ? 1 : -1;
        const ball = { position: { x: 1, y: 1.5, z: sign * 3 },
            velocity: { x: 0, y: 0.08, z: sign * 0.09 }, gravity: 0.006 };
        const player = { x: 0, y: 0.25, z: sign * 10 };
        const offsets = [{ x: 0.5, y: 0.75, z: 0 }];
        assert.equal(predictBaselineIntercept(ball, player.z), null);
        const target = chooseTrackingTarget(ball, player, offsets, side);
        if (!target) throw new Error('Expected a forward tracking target');
        assert.ok(Math.abs(target.z) < 9);
        assert.ok(target.time > 0);
        assert.equal(target.x, 0.5);
        assert.equal(chooseTrackingTarget(ball, player, [], side), null);
        assert.equal(chooseTrackingTarget({ ...ball, velocity: { ...ball.velocity, z: -sign * 0.09 } }, player, offsets, side), null);
    }
});

test('tracking chooses an airborne strike before the second bounce', () => {
    const ball = createBall(0, 2, -2);
    const velocity = new THREE.Vector3(0.02, 0.1, -0.12);
    const forecast = { position: ball.position, velocity, gravity: 0.006 };
    const target = chooseTrackingTarget(forecast, { x: 0, y: 0.25, z: -9 },
        [{ x: 0, y: 0.65, z: 0 }], 2);
    if (!target) throw new Error('Expected post-bounce target');
    hitBall(ball, velocity, 'player1');
    const data = ball.userData as BallUserData;
    for (let step = 0; step < Math.round(target.time * 120); step++) updateBallMotion(ball, 1 / 120);
    assert.ok(data.bounceCount <= 1);
    assert.ok(ball.position.y > 0.1);
    assert.ok(Math.abs(ball.position.z - target.z) < 1e-6);
    ball.geometry.dispose();
    (ball.material as THREE.Material).dispose();
});

test('sideline targets use racket reach instead of rejecting a playable right or left shot', () => {
    for (const sign of [-1, 1]) {
        const ball = { position: { x: sign * 3.9, y: 0.9, z: -7 },
            velocity: { x: 0, y: 0.08, z: -0.1 }, gravity: 0.006 };
        const player = { x: sign * 3, y: 0.25, z: -9 };
        // Exact center alignment would put the player's feet outside the court.
        const offsets = [{ x: -sign * 0.5, y: 0.75, z: 0 }];
        const target = chooseTrackingTarget(ball, player, offsets, 2, true);
        if (!target) throw new Error('Expected reachable sideline target');
        assert.ok(Math.abs(target.x) <= 4.115);
        assert.ok(Math.abs(ball.position.x - target.x - offsets[0].x) <= 0.45);
        const unreachable = { ...ball, position: { ...ball.position, x: sign * 5 } };
        assert.equal(chooseTrackingTarget(unreachable, player, offsets, 2, true), null);
    }
});

 test('tracking can intercept a volley before any bounce on either court side', () => {
    for (const side of [1, 2] as const) {
        const sign = side === 1 ? 1 : -1;
        const ball = { position: { x: 0.5, y: 1, z: sign * 8 },
            velocity: { x: 0, y: 0, z: sign * 0.15 }, gravity: 0 };
        const target = chooseTrackingTarget(ball, { x: 0, y: 0.25, z: sign * 10 },
            [{ x: 0.5, y: 0.75, z: 0 }], side);
        if (!target) throw new Error('Expected volley target without a bounce');
        assert.ok(target.time >= 0.15);
        assert.ok(Math.abs(target.z) > 8);
    }
});
