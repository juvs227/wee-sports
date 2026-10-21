// components/net.js
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// export function createNet() {
//     const group = new THREE.Group();

//     const loader = new GLTFLoader();
    
//     // Replace './assets/net.glb' with your teammate's actual file path
//     loader.load('./assets/net.glb', (gltf) => {
//         const netModel = gltf.scene;
        
//         netModel.traverse((child) => {
//             if (child.isMesh) {
//                 child.castShadow = true;
//                 child.receiveShadow = true;
//             }
//         });

//         group.add(netModel);
//     }, undefined, (error) => {
//         console.error('An error occurred loading the net asset:', error);
//     });

//     return group;
// }


export function createNet() {
    const geometry = new THREE.BoxGeometry(8.23, 0.5, 0.1);
    const material = new THREE.MeshStandardMaterial({ 
        color: 0xffffff,
        roughness: 0.5 
    });
    const net = new THREE.Mesh(geometry, material);
    net.position.set(0, 0.3, 0); // Position it on the ground
    net.castShadow = true;

    return net;
}
