import * as THREE from 'three';

/** Cosmetic surroundings only. Nothing here participates in tennis collision. */
export function createParkClub(): {group: THREE.Group; dispose: () => void} {
    const group = new THREE.Group();
    group.name = 'Park Club surroundings';
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
    geometries.add(boxGeometry);
    const paint = (color: number): THREE.MeshStandardMaterial => {
        const material = new THREE.MeshStandardMaterial({color, roughness: 1});
        materials.add(material);
        return material;
    };
    const grass = paint(0x96b586);
    const path = paint(0xd3cdb5);
    const hedge = paint(0x315b41);
    const wood = paint(0xb6a17b);
    const trunk = paint(0x66543f);
    const leaf = paint(0x517849);
    const box = (x: number, y: number, z: number, w: number, h: number, d: number,
        material: THREE.MeshStandardMaterial): void => {
        const mesh = new THREE.Mesh(boxGeometry, material);
        mesh.position.set(x, y, z);
        mesh.scale.set(w, h, d);
        mesh.receiveShadow = true;
        group.add(mesh);
    };
    // The existing 20 × 50 m court surface and all painted bounds stay untouched.
    box(0, -.12, 0, 160, .2, 160, grass);
    box(0, -.014, 0, 29, .02, 56, path);
    for (const side of [-1, 1]) {
        box(0, .8, side * 28, 30, 1.6, .8, hedge);
        box(side * 15, .8, 0, .8, 1.6, 56, hedge);
        for (const z of [-7, 7]) {
            box(side * 12.2, .65, z, .9, .16, 3, wood);
            box(side * 12.6, 1, z, .15, .7, 3, wood);
            for (const end of [-1, 1]) box(side * 12.2, .3, z + end, .6, .6, .12, hedge);
        }
    }
    const crownGeometry = new THREE.IcosahedronGeometry(1, 1);
    geometries.add(crownGeometry);
    // Instanced, stationary trees: no textures, animation loop, or extra shadows.
    const crowns = new THREE.InstancedMesh(crownGeometry, leaf, 12);
    const trunks = new THREE.InstancedMesh(boxGeometry, trunk, 12);
    const transform = new THREE.Object3D();
    for (let index = 0; index < 12; index++) {
        const x = (index % 6 - 2.5) * 9;
        const z = index < 6 ? -35 : 35;
        transform.position.set(x, 2, z);
        transform.scale.set(.55, 4, .55);
        transform.updateMatrix(); trunks.setMatrixAt(index, transform.matrix);
        transform.position.set(x, 5.1, z);
        transform.scale.set(3.3, 4.5 + (index % 3) * .25, 3.3);
        transform.updateMatrix(); crowns.setMatrixAt(index, transform.matrix);
        crowns.setColorAt(index, new THREE.Color().setHSL(.27 + (index % 3) * .014, .16, .76 + (index % 2) * .08));
    }
    group.add(crowns, trunks);
    // Low-detail distant landscaping gives depth without moving scenery or
    // adding shadow passes. Instancing keeps this to one extra draw call.
    const hills = new THREE.InstancedMesh(crownGeometry, paint(0x91b5a7), 8);
    for (let index = 0; index < 8; index++) {
        transform.position.set((index % 4 - 1.5) * 27, 1, index < 4 ? -69 : 69);
        transform.scale.set(22, 12 + (index % 3) * 4, 14);
        transform.updateMatrix(); hills.setMatrixAt(index, transform.matrix);
    }
    group.add(hills);
    return {group, dispose: () => {
        group.removeFromParent();
        crowns.dispose(); trunks.dispose(); hills.dispose();
        for (const geometry of geometries) geometry.dispose();
        for (const material of materials) material.dispose();
    }};
}
