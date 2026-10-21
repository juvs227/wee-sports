import * as THREE from 'three';

// Define an interface for the custom physics properties stored in userData
interface BallUserData {
    velocity: THREE.Vector3;
    gravity: number;
}

export function createBall(x: number, y: number, z: number): THREE.Mesh {
    const geometry = new THREE.SphereGeometry(0.3, 32, 32);
    const material = new THREE.MeshStandardMaterial({ 
        color: 0xfacc15, // Bright yellow ball
        roughness: 0.2,
        metalness: 0.1
    });
    
    const ball = new THREE.Mesh(geometry, material);
    ball.position.set(x, y, z);
    ball.castShadow = true;

    // Initialize velocity and gravity parameters with explicit typing
    ball.userData = {
        velocity: new THREE.Vector3(0.04, 0.15, 0.02), // Initial movement vector (x, y, z)
        gravity: 0.006                              // Downward pull per frame
    } as BallUserData;

    ball.userData.isSwinging = false;

    return ball;
}

export function updateBallMotion(ball: THREE.Mesh, delta: number): void {
    // Cast userData to our interface so TypeScript provides autocomplete and safety
    const userData = ball.userData as BallUserData;
    const frameScale = delta * 60;

    // 1. Apply gravity to the vertical velocity
    userData.velocity.y -= userData.gravity * frameScale;

    // 2. Update the ball's position using its velocity
    ball.position.addScaledVector(userData.velocity, frameScale);

    // 3. Ground Collision & Bounce (Ground is at y = 0, ball radius is 0.3)
    const ballRadius = 0.3;
    if (ball.position.y <= ballRadius) {
        ball.position.y = ballRadius; // Snap to ground level so it doesn't sink
        const bounceVelocity = -userData.velocity.y * 0.75;
        userData.velocity.y = Math.max(bounceVelocity, 0.15);
        
        // Slightly slow down horizontal movement on impact (friction)
        userData.velocity.x *= 0.98;
        userData.velocity.z *= 0.98;
    }

    // 4. Temporary court boundary bounces (keeps the ball inside the play area for now)
    if (Math.abs(ball.position.z) > 6) {
        ball.position.z = THREE.MathUtils.clamp(ball.position.z, -6, 6);
        userData.velocity.z *= -1;
    }
    if (Math.abs(ball.position.x) > 3.5) {
        ball.position.x = THREE.MathUtils.clamp(ball.position.x, -3.5, 3.5);
        userData.velocity.x *= -1;
    }
}