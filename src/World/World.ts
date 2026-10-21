import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

import { createGround } from './components/ground';
import { createNet } from './components/net';
import { createCourt } from './components/court';
import {
    createPlayer,
    type PlayerController,
} from './components/player';
import {
    createBall,
    updateBallMotion,
    serveBall,
} from './components/ball';

import {
    NEUTRAL_INPUT,
    type PlayerInput,
} from '../Controllers/playerInput';

export class World {
    public scene: THREE.Scene;
    public camera: THREE.PerspectiveCamera;
    public renderer: THREE.WebGLRenderer;
    public controls: OrbitControls;

    public player1: PlayerController;
    public player2: PlayerController;
    public ball: THREE.Mesh;

    private clock = new THREE.Clock();
    private animationFrameId: number | null = null;

    private player1Input: PlayerInput = { ...NEUTRAL_INPUT };
    private player2Input: PlayerInput = { ...NEUTRAL_INPUT };

    private readonly courtMinX = -4;
    private readonly courtMaxX = 4;

    constructor(container: HTMLElement) {
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x202025);

        this.camera = new THREE.PerspectiveCamera(
            60,
            window.innerWidth / window.innerHeight,
            0.1,
            1000
        );

        this.camera.position.set(0, 5, 10);
        this.camera.lookAt(0, 0, 0);

        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

        container.appendChild(this.renderer.domElement);

        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.target.set(0, 0, 0);

        const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
        this.scene.add(ambientLight);

        const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
        dirLight.position.set(5, 10, 7);
        dirLight.castShadow = true;
        dirLight.shadow.mapSize.set(2048, 2048);
        this.scene.add(dirLight);

        this.scene.add(createGround());
        this.scene.add(createNet());
        this.scene.add(createCourt());

        this.player1 = createPlayer(0, 0.25, 5, 0x3b82f6, {
            minX: this.courtMinX,
            maxX: this.courtMaxX,
            minZ: 1,
            maxZ: 8,
        });
        this.scene.add(this.player1.group);

        this.player2 = createPlayer(0, 0.25, -5, 0xef4444, {
            minX: this.courtMinX,
            maxX: this.courtMaxX,
            minZ: -8,
            maxZ: -1,
        });
        this.scene.add(this.player2.group);

        this.ball = createBall(0, 0.3, 5.0); // Place ball matching its radius on the court floor
        this.scene.add(this.ball);

        window.addEventListener('resize', this.handleResize);
    }

    private handleResize = (): void => {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    };

    public setPlayerInput(input: PlayerInput, player: 1 | 2 = 1): void {
        const normalizedInput: PlayerInput = {
            moveX: THREE.MathUtils.clamp(input.moveX, -1, 1),
            moveZ: THREE.MathUtils.clamp(input.moveZ, -1, 1),
            swing: input.swing,
        };

        if (player === 1) {
            this.player1Input = normalizedInput;
        } else {
            this.player2Input = normalizedInput;
        }
    }

    private updatePlayer(player: PlayerController, input: PlayerInput, delta: number): void {
        player.move(input.moveX, input.moveZ, delta);

        const swing = input.swing;
        input.swing = undefined;
        const moving = Math.abs(input.moveX) + Math.abs(input.moveZ) > 0.01;

        if (player.isSwinging) {
            return;
        }

        if (swing) {
            player.playAnimation(swing === 'left' ? 'SwingLeft' : 'SwingRight');
        } else if (moving) {
            player.playAnimation('WalkCycle');
        } else {
            player.stopAnimation();
        }
    }

    private handleKeyDown = (event: KeyboardEvent): void => {
        if (event.key.toLowerCase() === 'k') {
            this.playerServe();
        }
    };

    public playerServe(): void {
        const serveVelocity = new THREE.Vector3(0.0, 0.18, -0.22);
        serveBall(this.ball, serveVelocity);
    }

    public start(): void {
        if (this.animationFrameId !== null) {
            return;
        }

        this.clock.start();
        window.addEventListener('keydown', this.handleKeyDown);

        const animate = (): void => {
            this.animationFrameId = requestAnimationFrame(animate);

            const delta = Math.min(this.clock.getDelta(), 0.05);

            this.player1.update(delta);
            this.player2.update(delta);

            this.updatePlayer(this.player1, this.player1Input, delta);
            this.updatePlayer(this.player2, this.player2Input, delta);

            updateBallMotion(this.ball, delta);

            this.controls.update();
            this.renderer.render(this.scene, this.camera);
        };

        animate();
    }

    public stop(): void {
        if (this.animationFrameId !== null) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }

        window.removeEventListener('resize', this.handleResize);
        window.removeEventListener('keydown', this.handleKeyDown); // Properly cleaned up
    }

    public dispose(): void {
        this.stop();
        this.controls.dispose();
        this.renderer.dispose();
        this.renderer.domElement.remove();
    }
}