import * as THREE from 'three';

export const CONTACT_START = 0.2;
export const CONTACT_END = 0.7;

export function contactWindowCrossed(from: number, to: number, backhand = false): boolean {
    const start = backhand ? 0.1 : CONTACT_START;
    const end = backhand ? 0.8 : CONTACT_END;
    return from <= end && to >= start && to >= from;
}

// Sweep the ball relative to the moving racket. Substeps in World limit the
// rotation between poses; the expanded box is a generous gameplay hitbox.
export function sweptRacketContact(
    bounds: THREE.Box3,
    previousMatrix: THREE.Matrix4,
    currentMatrix: THREE.Matrix4,
    previousBall: THREE.Vector3,
    currentBall: THREE.Vector3,
    radius: number,
): boolean {
    const scale = new THREE.Vector3().setFromMatrixScale(currentMatrix);
    const previousScale = new THREE.Vector3().setFromMatrixScale(previousMatrix);
    const minScale = Math.min(...scale.toArray().map(Math.abs), ...previousScale.toArray().map(Math.abs));
    if (minScale < 1e-6) return false;
    const box = bounds.clone().expandByScalar(radius / minScale);
    const from = previousBall.clone().applyMatrix4(previousMatrix.clone().invert());
    const to = currentBall.clone().applyMatrix4(currentMatrix.clone().invert());
    if (box.containsPoint(from) || box.containsPoint(to)) return true;
    const direction = to.clone().sub(from);
    const length = direction.length();
    if (length < 1e-8) return false;
    const point = new THREE.Ray(from, direction.normalize()).intersectBox(box, new THREE.Vector3());
    return point !== null && point.distanceTo(from) <= length;
}

export class RacketHitbox {
    public readonly racket: THREE.Object3D;
    public readonly bounds: THREE.Box3;
    private readonly overlay: THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial>;
    private readonly padding = new THREE.Vector3();

    constructor(racket: THREE.Object3D) {
        this.racket = racket;
        racket.updateWorldMatrix(true, true);
        const inverse = racket.matrixWorld.clone().invert();
        const bounds = new THREE.Box3();
        racket.traverse(object => {
            if (!(object instanceof THREE.Mesh)) return;
            object.geometry.computeBoundingBox();
            if (object.geometry.boundingBox) {
                bounds.union(object.geometry.boundingBox.clone().applyMatrix4(
                    new THREE.Matrix4().multiplyMatrices(inverse, object.matrixWorld),
                ));
            }
        });
        if (bounds.isEmpty()) throw new Error('Racket has no geometry for its hitbox');
        const size = bounds.getSize(new THREE.Vector3());
        const axis = size.x > size.y ? (size.x > size.z ? 'x' : 'z') : (size.y > size.z ? 'y' : 'z');
        // The grip is at the socket origin. Approximate the head using the outer
        // 55% at the end farthest from that origin. Tune against the debug box.
        if (Math.abs(bounds.min[axis]) > Math.abs(bounds.max[axis])) {
            bounds.max[axis] = bounds.min[axis] + size[axis] * 0.55;
        } else {
            bounds.min[axis] = bounds.max[axis] - size[axis] * 0.55;
        }
        this.bounds = bounds;
        // Small extra forgiveness in world units, independent of model scale.
        const worldScale = new THREE.Vector3().setFromMatrixScale(racket.matrixWorld);
        this.padding.set(0.16 / Math.abs(worldScale.x), 0.16 / Math.abs(worldScale.y), 0.16 / Math.abs(worldScale.z));
        this.bounds.expandByVector(this.padding);
        this.overlay = new THREE.Mesh(
            new THREE.BoxGeometry(...this.bounds.getSize(new THREE.Vector3()).toArray()),
            new THREE.MeshBasicMaterial({ color: 0xf59e0b, transparent: true, opacity: 0.3, depthWrite: false, wireframe: true }),
        );
        this.overlay.position.copy(this.bounds.getCenter(new THREE.Vector3()));
        this.overlay.name = 'RacketContactDebug';
        racket.add(this.overlay);
    }

    public pose(): THREE.Matrix4 {
        this.racket.updateWorldMatrix(true, false);
        return this.racket.matrixWorld.clone();
    }

    public updateDebug(visible: boolean, active: boolean, hit: boolean): void {
        this.overlay.visible = visible;
        this.overlay.material.color.set(hit ? 0x22c55e : active ? 0x38bdf8 : 0xf59e0b);
    }

    public dispose(): void {
        this.overlay.removeFromParent();
        this.overlay.geometry.dispose();
        this.overlay.material.dispose();
    }
}
