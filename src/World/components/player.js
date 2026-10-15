// components/player.js
import * as THREE from 'three';
// import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export function createPlayer() {
    const geometry = new THREE.BoxGeometry(1, 1.5, 0.2);
    const material = new THREE.MeshStandardMaterial({ 
        color: 0x3b82f6, // Blue player block
        roughness: 0.4 
    });
    const player = new THREE.Mesh(geometry, material);
    player.position.set(0, 0.75, 5); // Positioned at the back of the court
    player.castShadow = true;

    return player;
}

export function updatePlayerMotion(player) {
    const time = Date.now() * 0.002;
    player.position.x = Math.sin(time) * 3;
}


// export function createPlayer() {
//     const group = new THREE.Group();
//     const loader = new GLTFLoader();
    
//     loader.load('./assets/player.glb', (gltf) => {
//         const playerModel = gltf.scene;
        
//         playerModel.traverse((child) => {
//             if (child.isMesh) {
//                 child.castShadow = true;
//                 child.receiveShadow = true;
//             }
//         });

//         group.add(playerModel);
//     }, undefined, (error) => {
//         console.error('An error occurred loading the player asset:', error);
//     });

//     return group;
// }
