// components/ground.js
import * as THREE from 'three';
// import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

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
    court.position.y = 0.05
    court.receiveShadow = true;
    group.add(court);

    // 2. Grid lines for scale
    const grid = new THREE.GridHelper(24, 12, 0xffffff, 0x444444);
    grid.position.y = 0.01;
    group.add(grid);

    return group;
}


// export function createCourt() {
//     const group = new THREE.Group();
//     const loader = new GLTFLoader();
    
//     loader.load('./assets/court.glb', (gltf) => {
//         const courtModel = gltf.scene;
        
//         courtModel.traverse((child) => {
//             if (child.isMesh) {
//                 child.castShadow = true;
//                 child.receiveShadow = true;
//             }
//         });

//         group.add(courtModel);
//     }, undefined, (error) => {
//         console.error('An error occurred loading the court asset:', error);
//     });

//     return group;
// }
