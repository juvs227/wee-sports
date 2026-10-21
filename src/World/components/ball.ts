// components/ball.ts
import * as THREE from 'three';
const BALL_RADIUS = 0.1; // Define the radius of the ball for collision detection
// Define an interface for the custom physics properties stored in userData
interface BallUserData {
    velocity: THREE.Vector3;
    gravity: number;
    isWaitingForServe: boolean;   // Tracks if the ball is held/waiting
    servePosition: THREE.Vector3; // Default position to reset to
    slideTimer?: number;
}

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
        gravity: 0.006,                       // Downward pull per frame
        isWaitingForServe: true,
        servePosition: new THREE.Vector3(x, y, z)
    } as BallUserData;

    return ball;
}

export function serveBall(ball: THREE.Mesh, initialVelocity: THREE.Vector3): void {
    const userData = ball.userData as BallUserData;

    // Only serve if the ball is currently waiting
    if (userData.isWaitingForServe) {
        userData.isWaitingForServe = false;
        userData.velocity.copy(initialVelocity);
    }
}

export function resetBallForServe(ball: THREE.Mesh): void {
    const userData = ball.userData as BallUserData;
    userData.isWaitingForServe = true;
    userData.velocity.set(0, 0, 0);
    userData.slideTimer = 0; // Reset the slide timer
    ball.position.copy(userData.servePosition);
}

export function updateBallMotion(ball: THREE.Mesh, delta: number): void {
    const userData = ball.userData as BallUserData;

    if (userData.isWaitingForServe) {
        return;
    }

    const frameScale = delta * 60;

    // 1. Apply gravity to vertical velocity
    userData.velocity.y -= userData.gravity * frameScale;

    // 2. Update position
    ball.position.addScaledVector(userData.velocity, frameScale);

    // 3. Ground Collision, Bouncing, and Sliding
    if (ball.position.y <= BALL_RADIUS) {
        ball.position.y = BALL_RADIUS; // Snap to ground level

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
                resetBallForServe(ball);
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

    // 4. Out of bounds fallback check (if it flies past court edges)
    // if (Math.abs(ball.position.z) > 6 || Math.abs(ball.position.x) > 3.5) {
    //     resetBallForServe(ball);
    // }
}