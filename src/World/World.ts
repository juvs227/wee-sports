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
} from './components/ball';

import { GameLogic } from './gameLogic';
import type { Score } from './scoreSystem';
import type { PlayerInput } from '../Controllers/playerInput';
import { WorldCamera } from './camera';

const COURT_MIN_X = -4.115;
const COURT_MAX_X = 4.115;

export class World {
    public scene: THREE.Scene;
    public camera: THREE.PerspectiveCamera;
    public renderer: THREE.WebGLRenderer;
    public controls: OrbitControls;

    public player1: PlayerController;
    public player2: PlayerController;
    public ball: THREE.Mesh;

    public onSwingFeedback: (message: string) => void = () => { };
    public onBallHit: (player: 1 | 2) => void = () => { };
    private readonly targetMarkers: THREE.Mesh[] = [];
    private readonly shotTargetMarker: THREE.Mesh;
    private readonly gameLogic: GameLogic;
    private readonly worldCamera: WorldCamera;
    private clock = new THREE.Clock();
    private animationFrameId: number | null = null;

    public get autoPositionEnabled(): boolean {
        return this.gameLogic.autoPositionEnabled;
    }

    public set autoPositionEnabled(value: boolean) {
        this.gameLogic.autoPositionEnabled = value;
    }

    public get botEnabled(): boolean {
        return this.gameLogic.botEnabled;
    }

    public set botEnabled(value: boolean) {
        this.gameLogic.botEnabled = value;
    }

    public getScore(): Score {
        return this.gameLogic.getScore();
    }

    constructor(container: HTMLElement) {
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x87ceeb);

        this.worldCamera = new WorldCamera();
        this.camera = this.worldCamera.primary;

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
            minX: COURT_MIN_X,
            maxX: COURT_MAX_X,
            minZ: 1,
            maxZ: 11.5,
        });
        this.scene.add(this.player1.group);

        this.player2 = createPlayer(0, 0.25, -10, 0xef4444, {
            minX: COURT_MIN_X,
            maxX: COURT_MAX_X,
            minZ: -11.5,
            maxZ: -1,
        });
        this.player2.group.rotation.y = Math.PI;
        this.scene.add(this.player2.group);

        this.ball = createBall(0, 0.3, 10.0);
        this.scene.add(this.ball);

        for (const color of [0x60a5fa, 0xf87171]) {
            const marker = new THREE.Mesh(new THREE.RingGeometry(0.22, 0.3, 24),
                new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: 0.8, depthWrite: false }));
            marker.rotation.x = -Math.PI / 2;
            this.scene.add(marker);
            this.targetMarkers.push(marker);
        }
        this.shotTargetMarker = new THREE.Mesh(new THREE.RingGeometry(0.16, 0.23, 24),
            new THREE.MeshBasicMaterial({ color: 0xfacc15, side: THREE.DoubleSide, depthWrite: false }));
        this.shotTargetMarker.rotation.x = -Math.PI / 2;
        this.shotTargetMarker.visible = false;
        this.scene.add(this.shotTargetMarker);
        this.gameLogic = new GameLogic({
            scene: this.scene,
            player1: this.player1,
            player2: this.player2,
            ball: this.ball,
            targetMarkers: this.targetMarkers,
            shotTargetMarker: this.shotTargetMarker,
            onSwingFeedback: () => this.onSwingFeedback,
            onHit: player => this.onBallHit(player),
        });
        window.addEventListener('resize', this.handleResize);
    }

    private handleResize = (): void => {
        this.worldCamera.resize(window.innerWidth, window.innerHeight);
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    };

    public setSplitScreen(enabled: boolean): void {
        this.worldCamera.setSplitScreen(enabled, window.innerWidth, window.innerHeight);
        this.controls.enabled = !enabled;
    }

    public get isSplitScreen(): boolean {
        return this.worldCamera.isSplitScreen;
    }

    public setPlayerInput(input: PlayerInput, player: 1 | 2 = 1): void {
        this.gameLogic.setPlayerInput(input, player);
    }

    public swing(event: {
        label: 'Forehand' | 'Backhand';
        hand: 'Left' | 'Right';
        player?: 1 | 2;
    }): void {
        this.gameLogic.swing(event);
    }

    public feedPracticeBall(backhand = false, number: 1 | 2 = 1): void {
        this.gameLogic.feedPracticeBall(backhand, number);
    }

    public playerServe(playerNumber: 1 | 2 = 1): void {
        this.gameLogic.playerServe(playerNumber);
    }

    public startRound(): void {
        this.gameLogic.startRound();
    }

    public start(): void {
        if (this.animationFrameId !== null) {
            return;
        }

        this.clock.start();
        // A paused or restored iframe may have changed size without a resize
        // listener. Refresh its camera and canvas before the first resumed frame.
        this.handleResize();
        window.addEventListener('resize', this.handleResize);
        window.addEventListener('keydown', this.gameLogic.handleKeyDown);

        const animate = (): void => {
            this.animationFrameId = requestAnimationFrame(animate);

            const delta = Math.min(this.clock.getDelta(), 0.05);

            this.gameLogic.update(delta);

            this.controls.update();
            this.worldCamera.render(this.renderer, this.scene,
                window.innerWidth, window.innerHeight);
        };

        animate();
    }

    public stop(): void {
        this.gameLogic.clearPendingInputs();
        if (this.animationFrameId !== null) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }

        window.removeEventListener('resize', this.handleResize);
        window.removeEventListener('keydown', this.gameLogic.handleKeyDown);
    }

    public dispose(): void {
        this.stop();
        this.shotTargetMarker.geometry.dispose();
        (this.shotTargetMarker.material as THREE.Material).dispose();
        this.shotTargetMarker.removeFromParent();
        for (const marker of this.targetMarkers) {
            marker.geometry.dispose();
            (marker.material as THREE.Material).dispose();
            marker.removeFromParent();
        }
        this.player1.hitbox?.dispose();
        this.player2.hitbox?.dispose();
        this.controls.dispose();
        this.renderer.dispose();
        this.renderer.domElement.remove();
    }
}
