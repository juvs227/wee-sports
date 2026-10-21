// components/court.ts
import * as THREE from 'three';

export function createCourt() {
    const group = new THREE.Group();

    // 1. Pure Green Court Placeholder
    const geometry = new THREE.PlaneGeometry(12, 24);
    const material = new THREE.MeshStandardMaterial({ 
        color: 0x00ff00, // Pure green
        roughness: 0.8,
        metalness: 0.1
    });
    const court = new THREE.Mesh(geometry, material);
    court.rotation.x = -Math.PI / 2;
    court.position.y = 0.05;
    court.receiveShadow = true;
    group.add(court);

    // 2. Grid lines for scale
    const grid = new THREE.GridHelper(24, 12, 0xffffff, 0x444444);
    grid.position.y = 0.01;
    group.add(grid);

    // 3. Highlighted 12 x 7 Rectangle Border
    const halfWidth = 3.5;  // 12 total width / 2
    const halfLength = 6; // 7 total length / 2

    // Define the 4 corners of the rectangle on the XZ plane (laying flat on the ground)
    const points = [
        new THREE.Vector3(-halfWidth, 0.06, -halfLength), // Top-Left
        new THREE.Vector3(halfWidth, 0.06, -halfLength),  // Top-Right
        new THREE.Vector3(halfWidth, 0.06, halfLength),   // Bottom-Right
        new THREE.Vector3(-halfWidth, 0.06, halfLength)   // Bottom-Left
    ];

    const borderGeometry = new THREE.BufferGeometry().setFromPoints(points);
    const borderMaterial = new THREE.LineBasicMaterial({ 
        color: 0xffffff, // Bright white border line
        linewidth: 3     // Note: linewidth > 1 may not work on some platforms due to WebGL limitations
    });

    const courtBorder = new THREE.LineLoop(borderGeometry, borderMaterial);
    group.add(courtBorder);

    return group;
}