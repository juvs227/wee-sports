import * as THREE from 'three';
import {determinePointWinner} from '../scoreSystem';
import {insideCourt, insideServiceBox, netHeightAt, serviceSign, TENNIS_COURT,
    type PointReason, type ServiceSide, type ServeCall} from '../tennisRules';

export const BALL_RADIUS = 0.1;
const COURT_BOUNDS = {width: TENNIS_COURT.halfWidth, length: TENNIS_COURT.halfLength};
export type BallPlayer = 'player1' | 'player2';
export interface BallUserData {
    velocity: THREE.Vector3;
    pendingVelocity: THREE.Vector3;
    gravity: number;
    isWaitingForServe: boolean;
    serveDelayRemaining: number;
    servingPlayer: BallPlayer;
    waitingForRacketHit: boolean;
    servePosition: THREE.Vector3;
    slideTimer?: number;
    bounceCount: number;
    firstBounceInBounds: boolean;
    lastHitBy?: BallPlayer;
    serveAttempt: 1 | 2;
    serviceSide: ServiceSide;
    isServeFlight: boolean;
    serveReturnPending: boolean;
    netTouched: boolean;
    serveStatus: 'ready' | 'first-fault' | 'let' | 'in-play';
}
export type PointCallback = (winner: BallPlayer, loser: BallPlayer, reason?: PointReason) => void;
export type RuleCallback = (call: ServeCall, player: 1 | 2) => void;

export function createBall(x: number, y: number, z: number): THREE.Mesh {
    const ball = new THREE.Mesh(new THREE.SphereGeometry(BALL_RADIUS, 32, 32),
        new THREE.MeshStandardMaterial({color: 0xfacc15, roughness: .2, metalness: .1}));
    ball.position.set(x, y, z);
    ball.castShadow = true;
    ball.userData = {
        velocity: new THREE.Vector3(), pendingVelocity: new THREE.Vector3(), gravity: .006,
        isWaitingForServe: true, serveDelayRemaining: 0, servingPlayer: 'player1',
        waitingForRacketHit: false, servePosition: new THREE.Vector3(x, y, z),
        bounceCount: 0, firstBounceInBounds: false, serveAttempt: 1,
        serviceSide: 'deuce', isServeFlight: false, serveReturnPending: false, netTouched: false, serveStatus: 'ready',
    } satisfies BallUserData;
    return ball;
}

export function serveBall(ball: THREE.Mesh, initialVelocity: THREE.Vector3,
    player?: BallPlayer, waitForRacketHit = true): void {
    const data = ball.userData as BallUserData;
    if (!data.isWaitingForServe) return;
    data.isWaitingForServe = false;
    data.waitingForRacketHit = waitForRacketHit;
    data.velocity.copy(waitForRacketHit ? new THREE.Vector3() : initialVelocity);
    data.pendingVelocity.copy(waitForRacketHit ? initialVelocity : new THREE.Vector3());
    data.lastHitBy = player;
    data.isServeFlight = !waitForRacketHit;
    data.serveReturnPending = true;
    data.netTouched = false;
}

/** The same authored racket contact launches serves and returns. */
export function hitBall(ball: THREE.Mesh, velocity: THREE.Vector3, player: BallPlayer,
    serving = false): void {
    const data = ball.userData as BallUserData;
    data.isWaitingForServe = false;
    data.waitingForRacketHit = false;
    data.velocity.copy(velocity);
    data.pendingVelocity.set(0, 0, 0);
    data.lastHitBy = player;
    data.bounceCount = 0;
    data.firstBounceInBounds = false;
    data.slideTimer = 0;
    data.isServeFlight = serving;
    data.serveReturnPending = serving;
    data.netTouched = false;
    data.serveStatus = 'in-play';
}

/** Reset placement only; a fault or let must not change score or service side. */
export function prepareServe(ball: THREE.Mesh, delay = 1.2): void {
    const data = ball.userData as BallUserData;
    const server = data.servingPlayer === 'player1' ? 1 : 2;
    data.servePosition.set(serviceSign(server, data.serviceSide) * 1.3, .3,
        server === 1 ? TENNIS_COURT.serveDepth : -TENNIS_COURT.serveDepth);
    data.serveDelayRemaining = delay;
    data.isWaitingForServe = true;
    data.velocity.set(0, 0, 0);
    data.pendingVelocity.set(0, 0, 0);
    data.waitingForRacketHit = false;
    data.slideTimer = 0;
    data.bounceCount = 0;
    data.firstBounceInBounds = false;
    data.lastHitBy = undefined;
    data.isServeFlight = false;
    data.serveReturnPending = false;
    data.netTouched = false;
    ball.position.copy(data.servePosition);
}

export function finishPoint(ball: THREE.Mesh, winner: BallPlayer, reason: PointReason,
    onPointScored?: PointCallback): void {
    const data = ball.userData as BallUserData;
    onPointScored?.(winner, winner === 'player1' ? 'player2' : 'player1', reason);
    data.serveAttempt = 1;
    data.serveStatus = 'ready';
    prepareServe(ball);
}

export function resetBallForServe(ball: THREE.Mesh,
    _courtBounds: {width: number; length: number} = COURT_BOUNDS,
    onPointScored?: PointCallback): void {
    const data = ball.userData as BallUserData;
    const winner = determinePointWinner(data.firstBounceInBounds, data.lastHitBy, ball.position.z);
    finishPoint(ball, winner, data.firstBounceInBounds ? 'second-bounce' : 'out', onPointScored);
}

export function recordServeFault(ball: THREE.Mesh, onPointScored?: PointCallback, onRule?: RuleCallback): void {
    const data = ball.userData as BallUserData;
    const player = data.servingPlayer === 'player1' ? 1 : 2;
    if (data.serveAttempt === 2) {
        finishPoint(ball, player === 1 ? 'player2' : 'player1', 'double-fault', onPointScored);
    } else {
        data.serveAttempt = 2;
        data.serveStatus = 'first-fault';
        prepareServe(ball);
        onRule?.('first-fault', player);
    }
}

export function updateBallMotion(ball: THREE.Mesh, delta: number,
    onPointScored?: PointCallback, onBounce?: () => void, onRule?: RuleCallback): void {
    const data = ball.userData as BallUserData;
    if (data.isWaitingForServe || data.waitingForRacketHit) return;
    const previous = ball.position.clone();
    const frameScale = delta * 60;
    data.velocity.y -= data.gravity * frameScale;
    ball.position.addScaledVector(data.velocity, frameScale);

    // Sweep across the net plane so a fast ball cannot tunnel through it.
    if (previous.z !== 0 && previous.z * ball.position.z <= 0 && !data.netTouched) {
        const fraction = -previous.z / (ball.position.z - previous.z);
        const x = previous.x + (ball.position.x - previous.x) * fraction;
        const y = previous.y + (ball.position.y - previous.y) * fraction;
        const height = netHeightAt(x);
        if (Math.abs(x) <= TENNIS_COURT.netHalfWidth + BALL_RADIUS && y - BALL_RADIUS <= height) {
            data.netTouched = true;
            if (y >= height - BALL_RADIUS) {
                // A tape clip can still land legally. Resolve let vs fault at landing.
                data.velocity.x *= .85;
                data.velocity.z *= .85;
                data.velocity.y = Math.max(data.velocity.y, .025);
                ball.position.y = Math.max(ball.position.y, height + BALL_RADIUS);
            } else if (data.isServeFlight) {
                recordServeFault(ball, onPointScored, onRule);
                return;
            } else {
                // Retain a weak rebound: the net does not itself end a rally.
                // A dribbling ball can still be returned before its second bounce.
                data.velocity.z *= -.18;
                data.velocity.x *= .5;
                data.velocity.y = Math.min(data.velocity.y, 0);
                ball.position.z = Math.sign(previous.z) * (BALL_RADIUS + TENNIS_COURT.netThickness / 2);
            }
        }
    }

    if (ball.position.y > BALL_RADIUS) return;
    ball.position.y = BALL_RADIUS;
    if (data.velocity.y < -.01) onBounce?.();
    handleGroundBounce(ball);
    if (data.isServeFlight && data.bounceCount === 1) {
        const server = data.servingPlayer === 'player1' ? 1 : 2;
        const legal = insideServiceBox(ball.position.x, ball.position.z, server, data.serviceSide, BALL_RADIUS);
        if (!legal) { recordServeFault(ball, onPointScored, onRule); return; }
        if (data.netTouched) {
            data.serveStatus = 'let';
            prepareServe(ball);
            onRule?.('let', server);
            return;
        }
        data.isServeFlight = false;
        data.firstBounceInBounds = true;
    }
    if (!data.firstBounceInBounds || data.bounceCount >= 2) {
        const winner = determinePointWinner(data.firstBounceInBounds, data.lastHitBy, ball.position.z);
        finishPoint(ball, winner, data.firstBounceInBounds ? 'second-bounce' : data.netTouched ? 'net' : 'out', onPointScored);
        return;
    }
    if (Math.abs(data.velocity.y) < .04) {
        data.velocity.y = 0;
        data.velocity.x *= .9;
        data.velocity.z *= .9;
    } else {
        data.velocity.y = -data.velocity.y * .55;
        data.velocity.x *= .65;
        data.velocity.z *= .65;
    }
}

export function handleGroundBounce(ball: THREE.Mesh,
    courtBounds: {width: number; length: number} = COURT_BOUNDS): void {
    const data = ball.userData as BallUserData;
    data.bounceCount = (data.bounceCount ?? 0) + 1;
    if (data.bounceCount !== 1) return;
    const opponentSide = !data.lastHitBy || (data.lastHitBy === 'player1' ? ball.position.z < 0 : ball.position.z > 0);
    const inBounds = courtBounds === COURT_BOUNDS ? insideCourt(ball.position.x, ball.position.z, BALL_RADIUS)
        : Math.abs(ball.position.x) - BALL_RADIUS <= courtBounds.width && Math.abs(ball.position.z) - BALL_RADIUS <= courtBounds.length;
    data.firstBounceInBounds = opponentSide && inBounds;
}
