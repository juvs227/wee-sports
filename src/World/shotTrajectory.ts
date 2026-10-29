import * as THREE from 'three';

export interface ShotPlan {
    velocity: THREE.Vector3;
    target: THREE.Vector3;
    flightTime: number;
    netHeight: number;
}

export interface ShotAim {
    aimX?: number;
    aimDepth?: number;
    power?: number;
    serve?: boolean;
    random?: () => number;
}

const RADIUS = 0.1;
// Current visible net top is 0.55. Include ball radius and extra forgiveness.
export const MIN_NET_HEIGHT = 0.9;

function validate(origin: THREE.Vector3, velocity: THREE.Vector3, target: THREE.Vector3,
    gravity: number, allowOut = false): { time: number; netHeight: number } | null {
    const position = origin.clone();
    const speed = velocity.clone();
    let netHeight: number | null = null;
    for (let step = 1; step <= 600; step++) {
        const previous = position.clone();
        speed.y -= gravity * 0.5;
        position.addScaledVector(speed, 0.5);
        if ((previous.z > 0 && position.z <= 0) || (previous.z < 0 && position.z >= 0)) {
            const fraction = -previous.z / (position.z - previous.z);
            netHeight = previous.y + (position.y - previous.y) * fraction;
        }
        if (position.y <= RADIUS + 1e-8) {
            const inTargetArea = (allowOut || (Math.abs(position.x) <= 3 && Math.abs(position.z) <= 10)) &&
                position.z * target.z > 0 && position.distanceTo(target) < 0.4;
            return inTargetArea && netHeight !== null && netHeight >= MIN_NET_HEIGHT
                ? { time: step / 120, netHeight } : null;
        }
    }
    return null;
}

// Aim first, then solve for velocity in the game's units per 60-Hz tick.
// Semi-implicit gravity uses a 0.5-tick substep in World, hence the correction.
export function planCourtShot(origin: THREE.Vector3, player: 1 | 2, backhand: boolean,
    gravity = 0.006, aim: ShotAim = {}): ShotPlan | null {
    if (![origin.x, origin.y, origin.z, gravity].every(Number.isFinite) || gravity <= 0 ||
        origin.y < RADIUS || (player === 1 ? origin.z <= 0 : origin.z >= 0)) return null;
    if (aim.power !== undefined && (!Number.isFinite(aim.power) || aim.power < 0 || aim.power > 1)) return null;
    // Opening serves keep assisted placement; rally power may intentionally go long.
    const power = aim.serve ? undefined : aim.power;
    const direction = player === 1 ? -1 : 1;
    if (aim.aimX !== undefined && (!Number.isFinite(aim.aimX) || Math.abs(aim.aimX) > 1)) return null;
    if (aim.aimDepth !== undefined && (!Number.isFinite(aim.aimDepth) || Math.abs(aim.aimDepth) > 1)) return null;
    const randomValue = aim.aimX === undefined ? 0.5 : (aim.random ?? Math.random)();
    const spread = (THREE.MathUtils.clamp(Number.isFinite(randomValue) ? randomValue : 0.5, 0, 1) - 0.5) * 0.5;
    const angleTarget = aim.aimX === undefined ? null : aim.aimX * 2.5 * (player === 1 ? 1 : -1) + spread;
    const x = angleTarget ?? THREE.MathUtils.clamp(-origin.x * 0.3 + (backhand ? -0.8 : 0.8), -2.8, 2.8);
    const depth = (aim.aimDepth === undefined ? 8.5 : 7.25 + aim.aimDepth * 2.25) +
        (power === undefined ? 0 : power * 5 - 1);
    const targets = [new THREE.Vector3(x, RADIUS, direction * depth),
        ...(power === undefined ? [new THREE.Vector3(0, RADIUS, direction * 7)] : [])];
    for (const target of targets) {
        for (let ticks = power === undefined ? 60 : 96 - Math.round(power * 60); ticks <= 150; ticks += 6) {
            const velocity = target.clone().sub(origin).divideScalar(ticks);
            velocity.y += gravity * (ticks + 0.5) / 2;
            const result = validate(origin, velocity, target, gravity, power !== undefined);
            if (result) return { velocity, target, flightTime: result.time, netHeight: result.netHeight };
        }
    }
    return null;
}
