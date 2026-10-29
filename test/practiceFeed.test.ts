import { chooseTrackingTarget, lateralSteering } from '../src/World/autoPosition';
import { planCourtShot } from '../src/World/shotTrajectory';
import { test, expect } from 'vitest';
import * as THREE from 'three';
import { planPracticeFeed } from '../src/World/practiceFeed';
import { createBall, hitBall, updateBallMotion, type BallUserData } from '../src/World/components/ball';
import { chooseBotStroke } from '../src/World/botPlayer';

test('practice feeds bounce in court and reach both strike poses after one bounce', () => {
    for (const player of [1, 2] as const) for (const x of [-0.6, 0.6]) {
        const target = new THREE.Vector3(x, 1, player === 1 ? 10 : -10);
        const feed = planPracticeFeed(target, player, 0.006);
        if (!feed) throw new Error('Expected feed');
        const ball = createBall(feed.origin.x, feed.origin.y, feed.origin.z);
        hitBall(ball, feed.velocity, player === 1 ? 'player2' : 'player1');
        const data = ball.userData as BallUserData;
        let botRequested = false;
        for (let step = 0; step < Math.round(feed.arrivalTime * 120); step++) {
            updateBallMotion(ball, 1 / 120);
            if (player === 2) botRequested ||= chooseBotStroke({ position: ball.position,
                velocity: data.velocity, gravity: data.gravity, bounceCount: data.bounceCount },
                { x: 0, y: 0.25, z: -10 },
                [{ backhand: x < 0, duration: 0.3, offset: { x, y: 0.75, z: 0 } }]) !== null;
        }
        expect(data.bounceCount).toBe(1);
        expect(data.firstBounceInBounds).toBe(true);
        expect(ball.position.distanceTo(target)).toBeLessThan(0.03);
        if (player === 2) expect(botRequested).toBe(true);
        ball.geometry.dispose();
        (ball.material as THREE.Material).dispose();
    }
});

test('practice tracking preserves the stance the feed was solved for', () => {
    const position = { x: 0, y: 0.25, z: 10 };
    const offset = { x: 0.6, y: 0.75, z: 0 };
    const target = new THREE.Vector3(position.x + offset.x, position.y + offset.y, position.z);
    const feed = planPracticeFeed(target, 1, 0.006)!;
    const planned = chooseTrackingTarget({ position: feed.origin, velocity: feed.velocity, gravity: 0.006 },
        position, [offset], 1);
    expect(planned).not.toBeNull();
    expect(Math.hypot(planned!.x - position.x, planned!.z - position.z)).toBeLessThan(0.15);
});

test('movement and bot timing together pursue short and deep shots on both sides', () => {
    for (const aimX of [-0.7, 0.7]) for (const aimDepth of [-1, 0.5]) {
        const origin = new THREE.Vector3(0, 1, 10);
        const plan = planCourtShot(origin, 1, false, 0.006, { aimX, aimDepth, random: () => 0.5 })!;
        const ball = createBall(origin.x, origin.y, origin.z);
        hitBall(ball, plan.velocity, 'player1');
        const data = ball.userData as BallUserData;
        const position = { x: 0, y: 0.25, z: -10 };
        const strokes = [-0.6, 0.6].map(x => ({ backhand: x < 0, duration: 0.3,
            offset: { x, y: 0.75, z: 0 } }));
        const target = chooseTrackingTarget({ position: ball.position, velocity: data.velocity, gravity: data.gravity },
            position, strokes.map(s => s.offset), 2);
        expect(target).not.toBeNull();
        let swung = false;
        for (let step = 0; step < 500 && data.bounceCount < 2; step++) {
            const dx = lateralSteering(position.x, target!.x);
            const dz = lateralSteering(position.z, target!.z);
            const norm = Math.max(1, Math.hypot(dx, dz));
            position.x += dx / norm * 4 / 120;
            position.z += dz / norm * 4 / 120;
            if (chooseBotStroke({ position: ball.position, velocity: data.velocity, gravity: data.gravity,
                bounceCount: data.bounceCount }, position, strokes)) { swung = true; break; }
            updateBallMotion(ball, 1 / 120);
        }
        expect(swung, `aim ${aimX}, depth ${aimDepth}`).toBe(true);
        ball.geometry.dispose();
        (ball.material as THREE.Material).dispose();
    }
});
