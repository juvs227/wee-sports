import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { createGround } from './components/ground.js';
import { createNet } from './components/net.js';
import { createCourt } from './components/court.js';
import { createPlayer, updatePlayerMotion } from './components/player.js';

export class World {
    constructor(container) {
        // 1. Scene
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x202025);

        // 2. Camera
        this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.camera.position.set(0, 5, 10);

        // 3. Renderer
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        container.appendChild(this.renderer.domElement);

        // 4. Controls
        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;

        // 5. Lighting
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
        this.scene.add(ambientLight);

        const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
        dirLight.position.set(5, 10, 7);
        dirLight.castShadow = true;
        dirLight.shadow.mapSize.width = 2048;
        dirLight.shadow.mapSize.height = 2048;
        this.scene.add(dirLight);

        // 6. Components 
        // Grid ground
        const ground = createGround();
        this.scene.add(ground);

        // Net 
        const net = createNet();
        this.scene.add(net);

        // Court 
        const court = createCourt();
        this.scene.add(court);

        // Player
        this.player = createPlayer();
        this.scene.add(this.player);

        // 7. Resize Handler
        window.addEventListener('resize', () => {
            this.camera.aspect = window.innerWidth / window.innerHeight;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(window.innerWidth, window.innerHeight);
        });
    }

    start() {
        const animate = () => {
            requestAnimationFrame(animate);


            const time = Date.now() * 0.002;
            this.player.position.x = Math.sin(time) * 3;

            this.controls.update();
            this.renderer.render(this.scene, this.camera);
        };
        animate();
    }
}