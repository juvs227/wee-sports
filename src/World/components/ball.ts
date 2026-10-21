import * as THREE from 'three';
const BALL_RADIUS = 0.1; // Define the radius of the ball for collision detection
// Define an interface for the custom physics properties stored in userData
interface BallUserData {
    velocity: THREE.Vector3;
    gravity: number;
    isWaitingForServe: boolean;   // Tracks if the ball is held/waiting
    servePosition: THREE.Vector3; // Default position to reset to
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
    ball.position.copy(userData.servePosition);
}

export function updateBallMotion(ball: THREE.Mesh, delta: number): void {
    // Cast userData to our interface so TypeScript provides autocomplete and safety
    const userData = ball.userData as BallUserData;

    // If the ball is waiting to be served, skip physics updates
    if (userData.isWaitingForServe) {
        return;
    }

    const frameScale = delta * 60;

    // 1. Apply gravity to the vertical velocity
    userData.velocity.y -= userData.gravity * frameScale;

    // 2. Update the ball's position using its velocity
    ball.position.addScaledVector(userData.velocity, frameScale);

    // 3. Ground Collision & Bounce (Ground is at y = 0, ball radius is BALL_RADIUS)
    const ballRadius = BALL_RADIUS;
    if (ball.position.y <= ballRadius) {
        ball.position.y = ballRadius; // Snap to ground level so it doesn't sink
        const bounceVelocity = -userData.velocity.y * 0.75;
        userData.velocity.y = Math.max(bounceVelocity, 0.15);
        
        // Slightly slow down horizontal movement on impact (friction)
        userData.velocity.x *= 0.98;
        userData.velocity.z *= 0.98;
    }

    // 4. Temporary court boundary bounces / resets (keeps the ball inside the play area)
    if (Math.abs(ball.position.z) > 6 || Math.abs(ball.position.x) > 3.5) {
        // Automatically reset for a new serve when it goes out of bounds
        resetBallForServe(ball);
    }
}