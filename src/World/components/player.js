// components/player.js
import * as THREE from 'three';

// import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
export function createPlayer(x, y, z, color=0x3b82f6) {
    const geometry = new THREE.BoxGeometry(1, 1.5, 0.2);
    const material = new THREE.MeshStandardMaterial({ 
        color: color, 
        roughness: 0.4 
    });
    const player = new THREE.Mesh(geometry, material);
    
    // Save the starting position so they don't overwrite each other
    player.userData.initialX = x; 
    
    player.position.set(x, y, z);
    player.castShadow = true;

    return player;
}

export function updatePlayerMotion(player, offset = 0) {
    const time = Date.now() * 0.002;
    // Moves back and forth starting from their own initial position
    player.position.x = player.userData.initialX + Math.sin(time + offset) * 1.5;
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
