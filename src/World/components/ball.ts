// components/ball.ts
import * as THREE from 'three';
import { determinePointWinner } from '../scoreSystem';
export const BALL_RADIUS = 0.1; // Define the radius of the ball for collision detection
const COURT_BOUNDS = { width: 4.115, length: 11.885 };
// Define an interface for the custom physics properties stored in userData
export interface BallUserData {
    velocity: THREE.Vector3;
    pendingVelocity: THREE.Vector3;
    gravity: number;
    isWaitingForServe: boolean;   // Tracks if the ball is held/waiting
    waitingForRacketHit: boolean;
    servePosition: THREE.Vector3; // Default position to reset to
    slideTimer?: number;
    bounceCount: number;          // How many times ball hit the ground
    firstBounceInBounds: boolean; // Was the 1st bounce inside court bounds?
    lastHitBy?: 'player1' | 'player2'; // Who last hit/served the ball
}
export type BallPlayer = 'player1' | 'player2';
export function createBall(x: number, y: number, z: number): THREE.Mesh {

    const geometry = new THREE.SphereGeometry(BALL_RADIUS, 32, 32);
    const material = new THREE.MeshStandardMaterial({
        color: 0xfacc15, // Bright yellow ball
        roughness: 0.2,
        metalness: 0.1
    });

    const ball = new THREE.Mesh(geometry, material);

    ball.position.set(x, y, z);
    ball.castShadow = true;

    // Initialize velocity, gravity, and serve properties with explicit typing
    ball.userData = {
        velocity: new THREE.Vector3(0, 0, 0), // Starts stationary while waiting for serve
        pendingVelocity: new THREE.Vector3(0, 0, 0),
        gravity: 0.006,                       // Downward pull per frame
        isWaitingForServe: true,
        waitingForRacketHit: false,
        servePosition: new THREE.Vector3(x, y, z),
        bounceCount: 0,
        firstBounceInBounds: false,
    } as BallUserData;

    return ball;
}

export function serveBall(
    ball: THREE.Mesh,
    initialVelocity: THREE.Vector3,
    player?: BallPlayer,
    waitForRacketHit = true
): void {
    const userData = ball.userData as BallUserData;

    // Only serve if the ball is currently waiting
    if (userData.isWaitingForServe) {
        userData.isWaitingForServe = false;
        if (waitForRacketHit) {
            userData.velocity.set(0, 0, 0);
            userData.pendingVelocity.copy(initialVelocity);
            userData.waitingForRacketHit = true;
        } else {
            userData.velocity.copy(initialVelocity);
            userData.pendingVelocity.set(0, 0, 0);
            userData.waitingForRacketHit = false;
        }
        userData.lastHitBy = player;
    }
}

// Used for rally returns as well as releasing a prepared serve. Values retain
// the existing game's velocity units (world units per 60 Hz tick).
export function hitBall(ball: THREE.Mesh, velocity: THREE.Vector3, player: BallPlayer): void {
    const data = ball.userData as BallUserData;
    data.isWaitingForServe = false;
    data.waitingForRacketHit = false;
    data.velocity.copy(velocity);
    data.pendingVelocity.set(0, 0, 0);
    data.lastHitBy = player;
    data.bounceCount = 0;
    data.firstBounceInBounds = false;
    data.slideTimer = 0;
}

export function resetBallForServe(
    ball: THREE.Mesh,
    courtBounds: { width: number; length: number } = COURT_BOUNDS,
    onPointScored?: (winner: BallPlayer) => void,
): void {
    const userData = ball.userData as BallUserData;

    userData.bounceCount = userData.bounceCount ?? 0;
    userData.firstBounceInBounds = userData.firstBounceInBounds ?? false;

    const pointWinner = determinePointWinner(
        userData.firstBounceInBounds, userData.lastHitBy, ball.position.z);
    onPointScored?.(pointWinner);

    // Reset ball state for serve
    userData.isWaitingForServe = true;
    userData.velocity.set(0, 0, 0);
    userData.pendingVelocity.set(0, 0, 0);
    userData.waitingForRacketHit = false;
    userData.slideTimer = 0;
    userData.bounceCount = 0;
    userData.firstBounceInBounds = false;
    userData.lastHitBy = undefined;

    ball.position.copy(userData.servePosition);
}

export function updateBallMotion(
    ball: THREE.Mesh,
    delta: number,
    onPointScored?: (winner: BallPlayer) => void,
): void {
    const userData = ball.userData as BallUserData;

    if (userData.isWaitingForServe) {
        return;
    }

    const frameScale = delta * 60;

    // Contact is handled in World for both players, during the swing window.
    if (userData.waitingForRacketHit) return;

    // 1. Apply gravity to vertical velocity
    userData.velocity.y -= userData.gravity * frameScale;

    // 2. Update position
    ball.position.addScaledVector(userData.velocity, frameScale);

    // 3. Ground Collision, Bouncing, and Sliding
    if (ball.position.y <= BALL_RADIUS) {
        ball.position.y = BALL_RADIUS; // Snap to ground level
        handleGroundBounce(ball);
        // If bounce velocity is low, treat it as sliding/rolling on the floor
        if (Math.abs(userData.velocity.y) < 0.04) {
            userData.velocity.y = 0;

            // Apply stronger friction so it slides to a gradual stop
            userData.velocity.x *= 0.90;
            userData.velocity.z *= 0.90;

            // Initialize slide timer if it doesn't exist yet
            if (userData.slideTimer === undefined) {
                userData.slideTimer = 0;
            }

            // Accumulate time spent sliding
            userData.slideTimer += delta;

            // After sliding for 1.5 seconds, reset the ball for the next serve
            if (userData.slideTimer >= 1.5) {
                resetBallForServe(ball, COURT_BOUNDS, onPointScored);
                return;
            }
        } else {
            // Normal bouncy collision
            const bounceVelocity = -userData.velocity.y * 0.55;
            userData.velocity.y = bounceVelocity;

            userData.velocity.x *= 0.65;
            userData.velocity.z *= 0.65;
        }
    }

}

export function handleGroundBounce(
    ball: THREE.Mesh,
    courtBounds: { width: number; length: number } = COURT_BOUNDS
): void {
    const userData = ball.userData as BallUserData;

    userData.bounceCount = (userData.bounceCount ?? 0) + 1;

    const xPos = ball.position.x;
    const zPos = ball.position.z;

    // Check if the bounce is inside the valid court area
    const isInside = Math.abs(xPos) <= courtBounds.width && Math.abs(zPos) <= courtBounds.length;

    if (userData.bounceCount === 1) {
        // Record whether the first bounce landed inside
        userData.firstBounceInBounds = isInside;
    }
}