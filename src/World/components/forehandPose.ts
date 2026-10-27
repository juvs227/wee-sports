import * as THREE from 'three';

export const DEFAULT_FOREHAND_DROP = 0.22;

// Ease the hand/racket lower during the stroke, returning to the authored pose
// at either end. Backhands retain their original animation.
export function forehandDrop(progress: number, backhand: boolean, amount = DEFAULT_FOREHAND_DROP): number {
    if (backhand || progress <= 0 || progress >= 1) return 0;
    return Math.sin(progress * Math.PI) * amount;
}

export function worldOffsetToLocal(parentMatrix: THREE.Matrix4, offset: THREE.Vector3): THREE.Vector3 {
    return offset.clone().applyMatrix3(new THREE.Matrix3().setFromMatrix4(parentMatrix).invert());
}
