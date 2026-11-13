import * as THREE from 'three';

export const DEFAULT_FOREHAND_DROP = 0.22;

/** A bounded arm adjustment follows the incoming ball without moving the feet
 * or enlarging collision bounds. Ease back to the authored pose at the ends. */
export function strokeHeightOffset(progress: number, offset: number): number {
    const blend = Math.min(1, Math.max(0, progress / .1), Math.max(0, (1 - progress) / .2));
    return THREE.MathUtils.clamp(offset, -.7, .7) * blend;
}

// Forehands dip during the stroke. Backhands start below the authored pose and
// rise above it through the finish.
export function forehandDrop(progress: number, backhand: boolean, amount = DEFAULT_FOREHAND_DROP): number {
    if (backhand) return THREE.MathUtils.lerp(amount, -amount, THREE.MathUtils.clamp(progress, 0, 1));
    if (progress <= 0 || progress >= 1) return 0;
    return Math.sin(progress * Math.PI) * amount;
}

export function worldOffsetToLocal(parentMatrix: THREE.Matrix4, offset: THREE.Vector3): THREE.Vector3 {
    return offset.clone().applyMatrix3(new THREE.Matrix3().setFromMatrix4(parentMatrix).invert());
}
