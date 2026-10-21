// components/court.ts
import * as THREE from 'three';

export function createCourt() {
    const group = new THREE.Group();

    // Standard Tennis Court dimensions in meters (78 ft x 27 ft)
    const groundWidth = 20;  // 27 feet
    const groundLength = 50; // 78 feet
    const courtWidth = 8.23;
    const courtLength = 23.77;

    // 1. Pure Green Court Placeholder
    const geometry = new THREE.PlaneGeometry(groundWidth, groundLength);
    const material = new THREE.MeshStandardMaterial({ 
        color: 0x15803d, // Professional tennis court green
        roughness: 0.8,
        metalness: 0.1
    });
    const court = new THREE.Mesh(geometry, material);
    court.rotation.x = -Math.PI / 2;
    court.position.y = 0.05;
    court.receiveShadow = true;
    group.add(court);

    // 2. Grid lines for scale
    const grid = new THREE.GridHelper(courtLength, 12, 0xffffff, 0x444444);
    grid.position.y = 0.01;
    group.add(grid);

    // 3. Highlighted Official Court Border Lines (8.23m x 23.77m)
    const halfWidth = courtWidth / 2;   // 4.115 meters
    const halfLength = courtLength / 2; // 11.885 meters

    // Define the 4 corners of the rectangle on the XZ plane
    const points = [
        new THREE.Vector3(-halfWidth, 0.06, -halfLength), // Top-Left
        new THREE.Vector3(halfWidth, 0.06, -halfLength),  // Top-Right
        new THREE.Vector3(halfWidth, 0.06, halfLength),   // Bottom-Right
        new THREE.Vector3(-halfWidth, 0.06, halfLength)   // Bottom-Left
    ];

    const borderGeometry = new THREE.BufferGeometry().setFromPoints(points);
    const borderMaterial = new THREE.LineBasicMaterial({ 
        color: 0xffffff, // Bright white border line
    });

    const courtBorder = new THREE.LineLoop(borderGeometry, borderMaterial);
    group.add(courtBorder);

    return group;
}