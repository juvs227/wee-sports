// components/world.ts
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
    type BallPlayer,
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

    private readonly courtMinX = -4.115;
    private readonly courtMaxX = 4.115;

    constructor(container: HTMLElement) {
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x202025);

        this.camera = new THREE.PerspectiveCamera(
            60,
            window.innerWidth / window.innerHeight,
            0.1,
            1000
        );

        this.camera.position.set(0, 4, 15);
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

        this.player1 = createPlayer(0, 0.25, 10, 0x3b82f6, {
            minX: this.courtMinX,
            maxX: this.courtMaxX,
            minZ: 1,
            maxZ: 11.5,
        });
        this.scene.add(this.player1.group);

        this.player2 = createPlayer(0, 0.25, -10, 0xef4444, {
            minX: this.courtMinX,
            maxX: this.courtMaxX,
            minZ: -11.5,
            maxZ: -1,
        });
        this.scene.add(this.player2.group);

        this.ball = createBall(0, 0.3, 10.0); 
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
        const key = event.key.toLowerCase();

        // 'K' = Standard Front Hit / Forehand, 'J' = Backhit / Backhand
        if (key === 'k' || key === 'j') {
            const dist1 = this.player1.group.position.distanceTo(this.ball.position);
            const dist2 = this.player2.group.position.distanceTo(this.ball.position);
            const REACH = 1.5;

            const isBackhand = key === 'j';
            const animName = isBackhand ? 'SwingLeft' : 'SwingRight';

            if (dist1 <= REACH) {
                this.player1.playAnimation(animName);

                // Backhit gets slightly wider angle/variance variations
                const xForce = isBackhand ? (Math.random() - 0.5) * 0.12 : (Math.random() - 0.5) * 0.08;
                const randomServe = new THREE.Vector3(
                    xForce,
                    THREE.MathUtils.randFloat(0.18, 0.25),
                    -THREE.MathUtils.randFloat(0.18, 0.28)
                );
                serveBall(this.ball, randomServe, 'player1');

            } else if (dist2 <= REACH) {
                this.player2.playAnimation(animName);

                const xForce = isBackhand ? (Math.random() - 0.5) * 0.12 : (Math.random() - 0.5) * 0.08;
                const randomServe = new THREE.Vector3(
                    xForce,
                    THREE.MathUtils.randFloat(0.15, 0.23),
                    THREE.MathUtils.randFloat(0.20, 0.32)
                );
                serveBall(this.ball, randomServe, 'player2');
            }
        }
    };

    public playerServe(playerNumber: 1 | 2 = 1): void {
        const targetPlayer = playerNumber === 1 ? this.player1 : this.player2;
        const playerPosition = targetPlayer.group.position;

        const distance = playerPosition.distanceTo(this.ball.position);
        const maxServeDistance = 1.5;

        if (distance <= maxServeDistance) {
            const serveVelocity = new THREE.Vector3(0.0, 0.18, playerNumber === 1 ? -0.22 : 0.22);
            serveBall(this.ball, serveVelocity, this.toBallPlayer(playerNumber));
        } else {
            console.log("Too far from the ball to serve!");
        }
    }

    private toBallPlayer(playerNumber: 1 | 2): BallPlayer {
        return playerNumber === 1 ? 'player1' : 'player2';
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

            // Determine which player's racket is active for ball collision checks
            let activeRacket: THREE.Object3D | undefined = undefined;
            if (this.player1.isSwinging && this.player1.racket) {
                activeRacket = this.player1.racket;
            } else if (this.player2.isSwinging && this.player2.racket) {
                activeRacket = this.player2.racket;
            }

            updateBallMotion(this.ball, delta, activeRacket);

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
        window.removeEventListener('keydown', this.handleKeyDown);
    }

    public dispose(): void {
        this.stop();
        this.controls.dispose();
        this.renderer.dispose();
        this.renderer.domElement.remove();
    }
}