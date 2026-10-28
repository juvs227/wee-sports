import { test } from 'vitest';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { contactWindowCrossed, sweptRacketContact, RacketHitbox } from '../src/World/components/racketContact.ts';
import { createBall, hitBall, serveBall, updateBallMotion, type BallUserData } from '../src/World/components/ball.ts';

const box = new THREE.Box3(new THREE.Vector3(-0.4, -0.3, -0.04), new THREE.Vector3(0.4, 0.3, 0.04));
const identity = new THREE.Matrix4();

test('ball crossing a thin racket hits even if both endpoints lie outside', () => {
    assert.equal(sweptRacketContact(box, identity, identity,
        new THREE.Vector3(0, 0, -2), new THREE.Vector3(0, 0, 2), 0.1), true);
    assert.equal(sweptRacketContact(box, identity, identity,
        new THREE.Vector3(2, 0, -2), new THREE.Vector3(2, 0, 2), 0.1), false);
});

test('moving racket can cross a stationary ball, including scaled racket poses', () => {
    const before = new THREE.Matrix4().makeTranslation(-2, 0, 0);
    const after = new THREE.Matrix4().makeTranslation(2, 0, 0);
    const ball = new THREE.Vector3();
    assert.equal(sweptRacketContact(box, before, after, ball, ball, 0.1), true);
    const small = new THREE.Matrix4().makeScale(0.1, 0.1, 0.1);
    assert.equal(sweptRacketContact(box, small, small,
        new THREE.Vector3(0, 0, 0.05), new THREE.Vector3(0, 0, 0.05), 0.1), true);
    assert.equal(sweptRacketContact(box, small, small,
        new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, 1), 0.1), false);
});

test('contact window excludes wind-up and recovery, and catches a crossed boundary', () => {
    assert.equal(contactWindowCrossed(0, 0.1), false);
    assert.equal(contactWindowCrossed(0.1, 0.25), true);
    assert.equal(contactWindowCrossed(0.3, 0.4), true);
    assert.equal(contactWindowCrossed(0.8, 0.9), false);
});

test('rally hit updates velocity and resets shot state; serve still waits for contact', () => {
    const ball = createBall(0, 1, 0);
    serveBall(ball, new THREE.Vector3(0, 0.2, -0.24), 'player1');
    const start = ball.position.clone();
    updateBallMotion(ball, 1 / 120);
    assert.deepEqual(ball.position, start);
    const data = ball.userData as BallUserData;
    data.bounceCount = 2;
    data.firstBounceInBounds = true;
    hitBall(ball, new THREE.Vector3(0, 0.22, 0.24), 'player2');
    assert.equal(data.lastHitBy, 'player2');
    assert.equal(data.waitingForRacketHit, false);
    assert.equal(data.bounceCount, 0);
    assert.equal(data.firstBounceInBounds, false);
    assert.equal(data.velocity.z, 0.24);
    updateBallMotion(ball, 1 / 120);
    assert.ok(ball.position.z > 0);
    // An already-moving rally ball can be returned again.
    hitBall(ball, new THREE.Vector3(0, 0.22, -0.24), 'player1');
    assert.equal(data.velocity.z, -0.24);
    ball.geometry.dispose();
    (ball.material as THREE.Material).dispose();
});

test('hitbox fits the bundled racket asset without browser or mesh-triangle collision', async () => {
    const data = readFileSync('public/assets/racket.glb');
    const bytes = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    const asset = await new GLTFLoader().parseAsync(bytes, '');
    const hitbox = new RacketHitbox(asset.scene);
    assert.equal(hitbox.bounds.isEmpty(), false);
    assert.ok(hitbox.bounds.getSize(new THREE.Vector3()).length() > 0);
    const center = hitbox.bounds.getCenter(new THREE.Vector3()).applyMatrix4(hitbox.pose());
    assert.equal(sweptRacketContact(hitbox.bounds, hitbox.pose(), hitbox.pose(), center, center, 0.1), true);
    hitbox.dispose();
});

test('second bounce ends a valid point immediately and cannot award it again', () => {
    const ball = createBall(0, .4, -5);
    hitBall(ball, new THREE.Vector3(0, .04, -.03), 'player1');
    const data = ball.userData as BallUserData;
    const winners: string[] = [];
    let firstBounceSeen = false;
    for (let step = 0; step < 600; step++) {
        updateBallMotion(ball, 1 / 120, winner => winners.push(winner));
        firstBounceSeen ||= data.bounceCount === 1 && data.firstBounceInBounds;
    }
    assert.equal(firstBounceSeen, true);
    assert.deepEqual(winners, ['player1']);
    assert.equal(data.isWaitingForServe, true);
    assert.equal(data.waitingForRacketHit, false);
});

test('a first bounce out of court or on the hitter side awards the opponent', () => {
    for (const [x, z] of [[5, -5], [0, 5]]) {
        const ball = createBall(x, .12, z);
        hitBall(ball, new THREE.Vector3(0, -.1, 0), 'player1');
        const winners: string[] = [];
        updateBallMotion(ball, 1 / 120, winner => winners.push(winner));
        assert.deepEqual(winners, ['player2']);
        assert.equal((ball.userData as BallUserData).isWaitingForServe, true);
    }
});
