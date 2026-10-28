import { test } from 'vitest';
import { strict as assert } from 'node:assert';
import { predictBaselineIntercept, lateralSteering } from '../src/World/autoPosition.ts';
import { createBall, hitBall, updateBallMotion } from '../src/World/components/ball.ts';
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
    const predicted = predictBaselineIntercept({ position: ball.position, velocity, gravity: 0.006 }, 1.5);
    if (predicted === null) throw new Error('Expected an intercept after the bounce');
    let previous = ball.position.clone();
    let actualX = 0;
    let actualY = 0;
    for (let i = 0; i < 480; i++) {
        previous.copy(ball.position);
        updateBallMotion(ball, 1 / 120);
        if (ball.position.z >= 1.5) {
            const fraction = (1.5 - previous.z) / (ball.position.z - previous.z);
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

test('prediction does not offer a return after the point-ending second bounce', () => {
    const incoming = { position: { x: 0, y: .4, z: 0 },
        velocity: { x: .08, y: -.04, z: .2 }, gravity: .006 };
    assert.equal(predictBaselineIntercept(incoming, 3), null);
    assert.equal(predictBaselineIntercept({ ...incoming, bounceCount: 1 }, 1.5), null);
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
