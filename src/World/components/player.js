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

export function triggerPlayerSwing(player, { label, hand }) {
    if (!['Forehand', 'Backhand'].includes(label)) return;
    player.userData.swing = { started: performance.now(), label, hand };
}

export function updatePlayerMotion(player, now = performance.now()) {
    const swing = player.userData.swing;
    if (!swing) return;
    const progress = Math.min((now - swing.started) / 650, 1);
    const side = (swing.label === 'Forehand' ? 1 : -1) * (swing.hand === 'Left' ? -1 : 1);
    player.rotation.y = side * Math.sin(progress * Math.PI * 2) * 0.9;
    player.rotation.z = side * Math.sin(progress * Math.PI) * 0.12;
    player.material.color.set(swing.label === 'Forehand' ? 0x22c55e : 0xa78bfa);
    if (progress === 1) {
        player.rotation.set(0, 0, 0);
        player.material.color.set(0x3b82f6);
        delete player.userData.swing;
    }
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
