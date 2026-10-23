// components/ball.ts
import * as THREE from 'three';
const BALL_RADIUS = 0.1; // Define the radius of the ball for collision detection
const RACKET_HIT_BUFFER = 0.5;
// Define an interface for the custom physics properties stored in userData
interface BallUserData {
    velocity: THREE.Vector3;
    pendingVelocity: THREE.Vector3;
    gravity: number;
    isWaitingForServe: boolean;   // Tracks if the ball is held/waiting
    waitingForRacketHit: boolean;
    servePosition: THREE.Vector3; // Default position to reset to
    slideTimer?: number;
}

function racketTouchesBall(
    racket: THREE.Object3D,
    ballPosition: THREE.Vector3
): boolean {
    racket.updateWorldMatrix(true, true);
    const closestPoint = new THREE.Vector3();
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    const worldMatrix = new THREE.Matrix4();

    let touching = false;
    racket.traverse((object) => {
        if (touching || !(object instanceof THREE.Mesh)) {
            return;
        }

        const position = object.geometry.getAttribute('position');
        const index = object.geometry.getIndex();
        if (!position) {
            return;
        }

        worldMatrix.copy(object.matrixWorld);
        const triangleCount = index ? index.count / 3 : position.count / 3;

        for (let triangle = 0; triangle < triangleCount; triangle++) {
            const first = triangle * 3;
            const indexA = index ? index.getX(first) : first;
            const indexB = index ? index.getX(first + 1) : first + 1;
            const indexC = index ? index.getX(first + 2) : first + 2;

            a.fromBufferAttribute(position, indexA).applyMatrix4(worldMatrix);
            b.fromBufferAttribute(position, indexB).applyMatrix4(worldMatrix);
            c.fromBufferAttribute(position, indexC).applyMatrix4(worldMatrix);

            new THREE.Triangle(a, b, c).closestPointToPoint(
                ballPosition,
                closestPoint
            );

            if (
                ballPosition.distanceToSquared(closestPoint) <=
                RACKET_HIT_BUFFER * RACKET_HIT_BUFFER
            ) {
                touching = true;
                return;
            }
        }
    });

    return touching;
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
        pendingVelocity: new THREE.Vector3(0, 0, 0),
        gravity: 0.006,                       // Downward pull per frame
        isWaitingForServe: true,
        waitingForRacketHit: false,
        servePosition: new THREE.Vector3(x, y, z)
    } as BallUserData;

    return ball;
}

export function serveBall(ball: THREE.Mesh, initialVelocity: THREE.Vector3): void {
    const userData = ball.userData as BallUserData;

    // Only serve if the ball is currently waiting
    if (userData.isWaitingForServe) {
        userData.isWaitingForServe = false;
        userData.velocity.set(0, 0, 0);
        userData.pendingVelocity.copy(initialVelocity);
        userData.waitingForRacketHit = true;
    }
}

export function resetBallForServe(ball: THREE.Mesh): void {
    const userData = ball.userData as BallUserData;
    userData.isWaitingForServe = true;
    userData.velocity.set(0, 0, 0);
    userData.pendingVelocity.set(0, 0, 0);
    userData.waitingForRacketHit = false;
    userData.slideTimer = 0; // Reset the slide timer
    ball.position.copy(userData.servePosition);
}

export function updateBallMotion(
    ball: THREE.Mesh,
    delta: number,
    racket?: THREE.Object3D
): void {
    const userData = ball.userData as BallUserData;

    if (userData.isWaitingForServe) {
        return;
    }

    const frameScale = delta * 60;

    if (userData.waitingForRacketHit) {
        if (!racket || !racketTouchesBall(racket, ball.position)) {
            return;
        }
        userData.velocity.copy(userData.pendingVelocity);
        userData.waitingForRacketHit = false;
    }

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