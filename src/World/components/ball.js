import * as THREE from 'three';

export function createBall(x, y, z) {
    const geometry = new THREE.SphereGeometry(0.3, 32, 32);
    const material = new THREE.MeshStandardMaterial({ 
        color: 0xfacc15, // Bright yellow ball
        roughness: 0.2,
        metalness: 0.1
    });
    
    const ball = new THREE.Mesh(geometry, material);
    ball.position.set(x, y, z);
    ball.castShadow = true;

    // Initialize velocity and gravity parameters
    ball.userData = {
        velocity: new THREE.Vector3(0.04, 0.15, 0.02), // Initial movement vector (x, y, z)
        gravity: 0.006                                  // Downward pull per frame
    };

    return ball;
}

export function updateBallMotion(ball) {
    // 1. Apply gravity to the vertical velocity
    ball.userData.velocity.y -= ball.userData.gravity;

    // 2. Update the ball's position using its velocity
    ball.position.add(ball.userData.velocity);

    // 3. Ground Collision & Bounce (Ground is at y = 0, ball radius is 0.3)
    const ballRadius = 0.3;
    if (ball.position.y <= ballRadius) {
        ball.position.y = ballRadius; // Snap to ground level so it doesn't sink
        ball.userData.velocity.y = -ball.userData.velocity.y * 0.75; // Reverse and dampen (bounce loss)
        
        // Slightly slow down horizontal movement on impact (friction)
        ball.userData.velocity.x *= 0.98;
        ball.userData.velocity.z *= 0.98;
    }

    // 4. Temporary court boundary bounces (keeps the ball inside the play area for now)
    if (Math.abs(ball.position.z) > 6) {
        ball.userData.velocity.z *= -1;
    }
    if (Math.abs(ball.position.x) > 3.5) {
        ball.userData.velocity.x *= -1;
    }
}