import * as THREE from 'three';
import { insideServiceBox, netHeightAt, serviceSign, TENNIS_COURT, type ServiceSide } from './tennisRules';

export interface ShotPlan {
    velocity: THREE.Vector3;
    target: THREE.Vector3;
    flightTime: number;
    netHeight: number;
}
export interface ShotIntent {
    /** Captured before animation assistance: negative late, positive early. */
    timing?: number;
    /** Optional deliberate placement, relative to the hitter's view. -1 = full left, 1 = full right. */
    aim?: number;
    serve?: ServiceSide;
    beginner?: boolean;
}
const RADIUS = 0.1;
export const MIN_NET_HEIGHT = TENNIS_COURT.netPostHeight + RADIUS + 0.08;

function validate(origin: THREE.Vector3, velocity: THREE.Vector3, target: THREE.Vector3,
    gravity: number, player: 1 | 2, serve?: ServiceSide): {time: number; netHeight: number} | null {
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
            const x = previous.x + (position.x - previous.x) * fraction;
            if (netHeight < netHeightAt(x) + RADIUS + .08) return null;
        }
        if (position.y <= RADIUS + 1e-8) {
            const legal = serve ? insideServiceBox(position.x, position.z, player, serve, RADIUS)
                : Math.abs(position.x) <= 3 && Math.abs(position.z) <= 10;
            return legal && position.z * target.z > 0 && position.distanceTo(target) < .4 &&
                netHeight !== null && netHeight >= MIN_NET_HEIGHT
                ? {time: step / 120, netHeight} : null;
        }
    }
    return null;
}

/**
 * Pure-physics shot from racket face normal. Changing it from target solver — velocity comes directly
 * from the normal's deviation relative to the net-calibration direction.
 * goal of sensitivity is below
 * idea is to squish all likely vectors to most of them on the court, some out
 * if face is angled into net, ball nets
 */
export function planShotFromNormal(
    swingNormal: [number, number, number],
    netNormal: [number, number, number],
    origin: THREE.Vector3,
    player: 1 | 2,
    power: number,
    gravity: number,
    sensitivity: number,
): ShotPlan | null {
    if (![origin.x, origin.y, origin.z, gravity].every(Number.isFinite) || gravity <= 0) return null;
    // Project swingNormal onto the plane perpendicular to netNormal.
    // The perpendicular component encodes lateral (X) and vertical (Y) racket face deviation.
    const dot = swingNormal[0]*netNormal[0] + swingNormal[1]*netNormal[1] + swingNormal[2]*netNormal[2];
    const perpX = swingNormal[0] - dot * netNormal[0];
    const perpY = swingNormal[1] - dot * netNormal[1];
    const fwd = player === 1 ? -1 : 1;
    const speed = THREE.MathUtils.lerp(0.10, 0.17, THREE.MathUtils.clamp(power, 0, 1));
    const velocity = new THREE.Vector3(
        perpX * sensitivity,
        perpY * sensitivity,
        fwd * speed,
    );
    // Simulate forward to populate ShotPlan fields (used by trajectory overlay, not for validation).
    const pos = origin.clone();
    const vel = velocity.clone();
    let netHeight = 0;
    let flightTime = 0;
    let crossedNet = false;
    for (let step = 1; step <= 600; step++) {
        vel.y -= gravity * 0.5;
        pos.addScaledVector(vel, 0.5);
        if (!crossedNet && pos.z * fwd <= 0) { crossedNet = true; netHeight = pos.y; }
        if (pos.y <= RADIUS) { flightTime = step / 240; break; }
    }
    return { velocity, target: pos.clone(), flightTime, netHeight };
}

/** Aim first, then solve in the existing 60-Hz units. No random shot placement. */
export function planCourtShot(origin: THREE.Vector3, player: 1 | 2, backhand: boolean,
    gravity = 0.006, power = 0.5, intent: ShotIntent = {}): ShotPlan | null {
    if (![origin.x, origin.y, origin.z, gravity].every(Number.isFinite) || gravity <= 0 ||
        origin.y < RADIUS || (player === 1 ? origin.z <= 0 : origin.z >= 0)) return null;
    const direction = player === 1 ? -1 : 1;
    const timing = THREE.MathUtils.clamp(intent.timing ?? 0, -1, 1);
    const angle = THREE.MathUtils.lerp(.45, intent.beginner ? 1.4 : 2.1, (timing + 1) / 2);
    const strokeSide = (backhand ? 1 : -1) * (player === 1 ? 1 : -1);
    const placement = intent.aim === undefined ? strokeSide * angle - origin.x * .25
        : intent.aim * (player === 1 ? 1 : -1) * 2.1;
    const x = THREE.MathUtils.clamp(placement, -3, 3);
    const targets = intent.serve
        ? [new THREE.Vector3(-serviceSign(player, intent.serve) * 1.65, RADIUS, direction * 5.3)]
        : [new THREE.Vector3(x, RADIUS, direction * 8.5), new THREE.Vector3(0, RADIUS, direction * 7)];
    const strength = Number.isFinite(power) ? THREE.MathUtils.clamp(power, 0, 1) : .5;
    const firstTicks = Math.round(THREE.MathUtils.lerp(intent.beginner ? 72 : 66, intent.beginner ? 60 : 54, strength));
    for (const target of targets) {
        for (let ticks = firstTicks; ticks <= 150; ticks += 6) {
            const velocity = target.clone().sub(origin).divideScalar(ticks);
            velocity.y += gravity * (ticks + .5) / 2;
            const result = validate(origin, velocity, target, gravity, player, intent.serve);
            if (result) return {velocity, target, flightTime: result.time, netHeight: result.netHeight};
        }
    }
    return null;
}
