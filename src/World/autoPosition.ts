export interface BallForecast {
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
