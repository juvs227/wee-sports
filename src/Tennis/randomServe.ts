import * as THREE from 'three';

export type ServePlayer = 1 | 2;

export function calculateRandomServe(
    player: ServePlayer,
    isBackhand: boolean
): THREE.Vector3 {
    const xForce = isBackhand
        ? (Math.random() - 0.5) * 0.12
        : (Math.random() - 0.5) * 0.08;

    if (player === 1) {
        return new THREE.Vector3(
            xForce,
            THREE.MathUtils.randFloat(0.18, 0.25),
            -THREE.MathUtils.randFloat(0.18, 0.28)
        );
    }

    return new THREE.Vector3(
        xForce,
        THREE.MathUtils.randFloat(0.15, 0.23),
        THREE.MathUtils.randFloat(0.20, 0.32)
    );
}
