import * as THREE from 'three';

function createGround() {
    const geometry = new THREE.PlaneGeometry(50, 50);
    const material = new THREE.MeshStandardMaterial({ 
        color: 0x505050,
        roughness: 0.8,
        metalness: 0.2
    });
    const ground = new THREE.Mesh(geometry, material);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;

    const grid = new THREE.GridHelper(50, 50, 0x00ffff, 0x444444);
    grid.position.y = 0.01;

    const group = new THREE.Group();
    group.add(ground);
    group.add(grid);

    return group;
}

export { createGround };
