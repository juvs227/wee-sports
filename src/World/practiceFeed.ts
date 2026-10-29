import * as THREE from 'three';
import { BALL_RADIUS } from './components/ball';

// Solve two half-tick-integrated arcs, including the live bounce's restitution
// (0.55 vertical, 0.65 horizontal), to reach the sampled racket pose after bounce.
export function planPracticeFeed(target: THREE.Vector3, player: 1 | 2, gravity: number) {
    if (![target.x, target.y, target.z, gravity].every(Number.isFinite) ||
        target.y <= BALL_RADIUS || gravity <= 0) return null;
    const before = 30;
    const after = 24;
    const postY = (target.y - BALL_RADIUS + gravity * after * (after + 0.5) / 2) / after;
    const incomingY = -postY / 0.55;
    const velocity = new THREE.Vector3(0, incomingY + gravity * before, player === 1 ? 0.14 : -0.14);
    const bounce = target.clone();
    bounce.y = BALL_RADIUS;
    bounce.z -= velocity.z * 0.65 * after;
    const origin = bounce.clone().addScaledVector(velocity, -before);
    origin.y += gravity * before * (before + 0.5) / 2;
    if (origin.y <= BALL_RADIUS) return null;
    return { origin, velocity, arrivalTime: (before + after) / 60 };
}
