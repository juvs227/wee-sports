import * as THREE from 'three';
import {TENNIS_COURT} from '../tennisRules';

export function createCourt(): THREE.Group {
    const group = new THREE.Group();
    const court = new THREE.Mesh(new THREE.PlaneGeometry(20, 50),
        new THREE.MeshStandardMaterial({color: 0x15803d, roughness: .8, metalness: .1}));
    court.rotation.x = -Math.PI / 2;
    court.position.y = .02;
    court.receiveShadow = true;
    group.add(court);
    const {halfWidth, halfLength, serviceLine, lineWidth} = TENNIS_COURT;
    const paint = new THREE.MeshBasicMaterial({color: 0xffffff, side: THREE.DoubleSide});
    const line = (x: number, z: number, width: number, depth: number): void => {
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), paint);
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.set(x, .025, z);
        group.add(mesh);
    };
    for (const x of [-1, 1]) line(x * (halfWidth - lineWidth / 2), 0, lineWidth, halfLength * 2);
    for (const z of [-1, 1]) {
        line(0, z * (halfLength - lineWidth / 2), halfWidth * 2, lineWidth);
        line(0, z * (serviceLine - lineWidth / 2), halfWidth * 2, lineWidth);
        line(0, z * (halfLength - .1), lineWidth, .2);
    }
    line(0, 0, lineWidth, serviceLine * 2);
    return group;
}
