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
    /** Optional deliberate placement, relative to the hitter's view. */
    aim?: number;
    /** Captured pitch: -1 short, 0 normal, +1 deep. */
    depth?: number;
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

/** Aim first, then solve in the existing 60-Hz units. No random shot placement. */
export function planCourtShot(origin: THREE.Vector3, player: 1 | 2, backhand: boolean,
    gravity = 0.006, power = 0.5, intent: ShotIntent = {}): ShotPlan | null {
    if (![origin.x, origin.y, origin.z, gravity].every(Number.isFinite) || gravity <= 0 ||
        origin.y < RADIUS || (player === 1 ? origin.z <= 0 : origin.z >= 0)) return null;
    const direction = player === 1 ? -1 : 1;
    const timing = THREE.MathUtils.clamp(intent.timing ?? 0, -1, 1);
    const angle = THREE.MathUtils.lerp(.45, intent.beginner ? 1.4 : 2.1, (timing + 1) / 2);
    const strokeSide = (backhand ? 1 : -1) * (player === 1 ? 1 : -1);
    const aim = Number.isFinite(intent.aim) ? THREE.MathUtils.clamp(intent.aim!, -1, 1) : undefined;
    const depth = Number.isFinite(intent.depth) ? THREE.MathUtils.clamp(intent.depth!, -1, 1) : 0;
    const placement = aim === undefined ? strokeSide * angle - origin.x * .25
        : aim * (player === 1 ? 1 : -1) * 2.1;
    const x = THREE.MathUtils.clamp(placement, -3, 3);
    const targetDepth = depth < 0 ? 8.5 + depth * 3 : 8.5 + depth * .7;
    const targets = intent.serve
        ? [new THREE.Vector3(-serviceSign(player, intent.serve) * 1.65, RADIUS, direction * 5.3)]
        : [new THREE.Vector3(x, RADIUS, direction * targetDepth), new THREE.Vector3(aim === undefined ? 0 : x, RADIUS, direction * Math.min(targetDepth, 7))];
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
