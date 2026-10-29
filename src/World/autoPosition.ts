export interface BallForecast {
    bounceCount?: number;
    position: { x: number; y: number; z: number };
    velocity: { x: number; y: number; z: number };
    gravity: number;
}

export interface Intercept { x: number; y: number; time: number }

// Match the existing 60-Hz velocity units and ground response. This predicts
// the current free-flight/bounce model, not future opponent shots or net impacts.
export function predictBaselineIntercept(ball: BallForecast, targetZ: number, maxTime = 4): Intercept | null {
    let { x, y, z } = ball.position;
    let { x: vx, y: vy, z: vz } = ball.velocity;
    if (![x, y, z, vx, vy, vz, ball.gravity, targetZ, maxTime].every(Number.isFinite) ||
        maxTime <= 0 || ball.gravity < 0 || Math.abs(vz) < 1e-5 || (targetZ - z) * vz < 0) return null;
    if (Math.abs(targetZ - z) < 1e-5) return { x, y, time: 0 };
    const dt = 1 / 120;
    const frameScale = dt * 60;
    for (let time = dt; time <= Math.min(maxTime, 4) + 1e-8; time += dt) {
        const previous = { x, y, z };
        vy -= ball.gravity * frameScale;
        x += vx * frameScale;
        y += vy * frameScale;
        z += vz * frameScale;
        if (y <= 0.1) {
            y = 0.1;
            if (Math.abs(vy) < 0.04) { vy = 0; vx *= 0.9; vz *= 0.9; }
            else { vy = -vy * 0.55; vx *= 0.65; vz *= 0.65; }
        }
        if ((previous.z - targetZ) * (z - targetZ) <= 0 && z !== previous.z) {
            const fraction = (targetZ - previous.z) / (z - previous.z);
            return { x: previous.x + (x - previous.x) * fraction,
                y: previous.y + (y - previous.y) * fraction, time: time - dt + fraction * dt };
        }
        if (Math.abs(vz) < 1e-5) return null;
    }
    return null;
}

export function lateralSteering(currentX: number, targetX: number): number {
    const error = targetX - currentX;
    return Math.abs(error) <= 0.04 ? 0 : Math.max(-1, Math.min(1, error / 0.6));
}

// First ground contact using the same half-tick integration as live physics.
export function predictFirstLanding(ball: BallForecast): { x: number; z: number } | null {
    let { x, y, z } = ball.position;
    const { x: vx, z: vz } = ball.velocity;
    let vy = ball.velocity.y;
    if (![x, y, z, vx, vy, vz, ball.gravity].every(Number.isFinite) || ball.gravity <= 0) return null;
    for (let step = 0; step < 1200; step++) {
        vy -= ball.gravity * 0.5;
        x += vx * 0.5; y += vy * 0.5; z += vz * 0.5;
        if (y <= 0.1) return { x, z };
    }
    return null;
}

export interface TrackingTarget { x: number; z: number; time: number }

// Search incoming flight and the flight after one bounce for a strike pose.
// A fixed baseline intercept misses short balls that bounce twice before it.
export function chooseTrackingTarget(ball: BallForecast,
    player: { x: number; y: number; z: number },
    offsets: { x: number; y: number; z: number }[], side: 1 | 2,
    alreadyBounced = false): TrackingTarget | null {
    let { x, y, z } = ball.position;
    let { x: vx, y: vy, z: vz } = ball.velocity;
    if (![x, y, z, vx, vy, vz, ball.gravity, player.x, player.y, player.z].every(Number.isFinite) ||
        ball.gravity < 0 || (side === 1 ? vz <= 0 : vz >= 0)) return null;
    let bounces = alreadyBounced ? 1 : 0;
    let best: TrackingTarget | null = null;
    let bestScore = Infinity;
    let bounceTime = alreadyBounced ? 0 : Infinity;
    for (let step = 1; step <= 480; step++) {
        const time = step / 120;
        vy -= ball.gravity * 0.5;
        x += vx * 0.5; y += vy * 0.5; z += vz * 0.5;
        if (y <= 0.1) {
            if (++bounces >= 2) break;
            bounceTime = time;
            y = 0.1;
            if (Math.abs(vy) < 0.04) { vy = 0; vx *= 0.9; vz *= 0.9; }
            else { vy = -vy * 0.55; vx *= 0.65; vz *= 0.65; }
        }
        if (time < 0.15 || (bounces === 1 && time - bounceTime < 0.15)) continue;
        for (const offset of offsets) {
            const idealX = x - offset.x;
            const idealZ = z - offset.z;
            const targetX = Math.max(-4.115, Math.min(4.115, idealX));
            const targetZ = side === 1 ? Math.max(1, Math.min(11.5, idealZ))
                : Math.max(-11.5, Math.min(-1, idealZ));
            if (![offset.x, offset.y, offset.z].every(Number.isFinite) ||
                Math.abs(y - player.y - offset.y) > 0.5 ||
                Math.abs(idealX - targetX) > 0.45 || Math.abs(idealZ - targetZ) > 0.35) continue;
            const distance = Math.hypot(targetX - player.x, targetZ - player.z);
            const requiredSpeed = distance / time;
            const target = { x: targetX, z: targetZ, time };
            // Prefer a reachable, centered strike that needs little movement,
            // rather than the earliest low point immediately after the bounce.
            const score = (requiredSpeed > 3.6 ? 100 + requiredSpeed : 0) + distance +
                Math.abs(y - player.y - offset.y) * 4 + time * 0.1;
            if (score < bestScore) { best = target; bestScore = score; }
        }
    }
    return best;
}
