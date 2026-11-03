import * as THREE from 'three';
import {netHeightAt, TENNIS_COURT} from '../tennisRules';

/** Visual net uses exactly the top profile checked by ball/trajectory code. */
export function createNet(): THREE.Group {
    const group = new THREE.Group();
    const points: THREE.Vector3[] = [];
    const width = TENNIS_COURT.netHalfWidth;
    for (let index = 0; index <= 50; index++) {
        const x = -width + 2 * width * index / 50;
        points.push(new THREE.Vector3(x, .03, 0), new THREE.Vector3(x, netHeightAt(x), 0));
    }
    for (let row = 1; row <= 10; row++) {
        for (let index = 0; index < 50; index++) {
            const x = -width + 2 * width * index / 50;
            const next = -width + 2 * width * (index + 1) / 50;
            points.push(new THREE.Vector3(x, netHeightAt(x) * row / 10, 0),
                new THREE.Vector3(next, netHeightAt(next) * row / 10, 0));
        }
    }
    group.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(points),
        new THREE.LineBasicMaterial({color: 0x33443c, transparent: true, opacity: .8})));
    const tape = Array.from({length: 51}, (_, index) => {
        const x = -width + 2 * width * index / 50;
        return new THREE.Vector3(x, netHeightAt(x), 0);
    });
    group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(tape),
        new THREE.LineBasicMaterial({color: 0xffffff})));
    for (const x of [-width, width]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(.045, .045, TENNIS_COURT.netPostHeight, 8),
            new THREE.MeshStandardMaterial({color: 0x254336, roughness: .8}));
        post.position.set(x, TENNIS_COURT.netPostHeight / 2, 0);
        post.castShadow = true;
        group.add(post);
    }
    return group;
}
