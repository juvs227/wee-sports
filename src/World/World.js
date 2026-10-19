import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { createGround } from './components/ground.js';
import { createNet } from './components/net.js';
import { createCourt } from './components/court.js';
import { createPlayer, updatePlayerMotion } from './components/player.js';
import { createBall, updateBallMotion } from './components/ball.js';
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
        const player_Z = 5;
        this.player1 = createPlayer(0, 0.75, player_Z,0x3b82f6); // Blue player block
        this.scene.add(this.player1);

        this.player2 = createPlayer(0, 0.75, -player_Z,0xef4444); // Red player block
        this.scene.add(this.player2);

        // Ball - Spawned in the air above the court
        this.ball = createBall(0, 3.0, 0);
        this.scene.add(this.ball);

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
            updatePlayerMotion(this.player1);
            updateBallMotion(this.ball);
            updatePlayerMotion(this.player2);
            this.controls.update();
            this.renderer.render(this.scene, this.camera);
        };
        animate();
    }
}