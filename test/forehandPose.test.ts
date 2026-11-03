import { test } from 'vitest';
import { strict as assert } from 'node:assert';
import * as THREE from 'three';
import { forehandDrop, worldOffsetToLocal } from '../src/World/components/forehandPose.ts';

test('forehand lowers smoothly by 0.22 units at midstroke and restores endpoints', () => {
    assert.equal(forehandDrop(0, false), 0);
    assert.equal(forehandDrop(1, false), 0);
    assert.ok(Math.abs(forehandDrop(0.5, false) - 0.22) < 1e-8);
    assert.ok(forehandDrop(0.2, false) > 0);
    assert.ok(forehandDrop(0.2, false) < forehandDrop(0.5, false));
});

test('backhands rise from a lower start to a higher finish', () => {
    assert.equal(forehandDrop(0, true), 0.22);
    assert.equal(forehandDrop(0.5, true), 0);
    assert.equal(forehandDrop(1, true), -0.22);
    assert.equal(forehandDrop(0.5, false, 0), 0);
    assert.equal(forehandDrop(0.5, false, 0.3), 0.3);
});

test('scaled and rotated model parents still lower the hand vertically in world space', () => {
    const parent = new THREE.Object3D();
    parent.position.set(2, 1, 3);
    parent.rotation.set(0.5, 0.3, 0.8);
    parent.scale.set(0.2, 0.3, 0.4);
    const hand = new THREE.Object3D();
    hand.position.set(1, 2, 3);
    parent.add(hand);
    parent.updateMatrixWorld(true);
    const before = hand.getWorldPosition(new THREE.Vector3());
    hand.position.add(worldOffsetToLocal(parent.matrixWorld, new THREE.Vector3(0, -0.22, 0)));
    const after = hand.getWorldPosition(new THREE.Vector3());
    assert.ok(after.distanceTo(before.clone().add(new THREE.Vector3(0, -0.22, 0))) < 1e-8);
});
