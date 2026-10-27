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
    hitBall,
    BALL_RADIUS,
    type BallUserData,
    type BallPlayer,
} from './components/ball';

import {
    NEUTRAL_INPUT,
    type PlayerInput,
} from '../Controllers/playerInput';
import { chooseBotStroke, type BotStroke } from './botPlayer';
import { predictBaselineIntercept, lateralSteering } from './autoPosition';
import { sweptRacketContact } from './components/racketContact';

export class World {
    public scene: THREE.Scene;
    public camera: THREE.PerspectiveCamera;
    public renderer: THREE.WebGLRenderer;
    public controls: OrbitControls;

    public player1: PlayerController;
    public player2: PlayerController;
    public ball: THREE.Mesh;

    public onSwingFeedback: (message: string) => void = () => {};
    private showHitboxes = true;
    public autoPositionEnabled = true;
    public botEnabled = true;
    private botAttempted = false;
    private autoTargets: [number, number] = [0, 0];
    private readonly targetMarkers: THREE.Mesh[] = [];
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

        for (const color of [0x60a5fa, 0xf87171]) {
            const marker = new THREE.Mesh(new THREE.RingGeometry(0.22, 0.3, 24),
                new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: 0.8, depthWrite: false }));
            marker.rotation.x = -Math.PI / 2;
            this.scene.add(marker);
            this.targetMarkers.push(marker);
        }
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

    private updatePlayer(player: PlayerController, input: PlayerInput, delta: number, number: 1 | 2): void {
        const swing = input.swing;
        input.swing = undefined;
        // Hold position during the complete stroke, including a newly requested one.
        if (player.isSwinging) return;
        const assisted = this.autoPositionEnabled || (number === 2 && this.botEnabled);
        const moveX = assisted
            ? lateralSteering(player.group.position.x, this.autoTargets[number - 1]) : input.moveX;
        const moveZ = assisted ? 0 : input.moveZ;
        if (!swing) player.move(moveX, moveZ, delta);
        const moving = !swing && Math.abs(moveX) + Math.abs(moveZ) > 0.01;

        if (swing) {
            this.performSwing(swing === 'left', number);
        } else if (moving) {
            player.playAnimation('WalkCycle');
        } else {
            player.stopAnimation();
        }
    }

    private updateAutoTargets(): void {
        const data = this.ball.userData as BallUserData;
        for (const [player, number] of [[this.player1, 1], [this.player2, 2]] as const) {
            let target = player.group.position.x;
            if (!data.isWaitingForServe && !data.waitingForRacketHit && !player.isSwinging) {
                const approaching = number === 1 ? data.velocity.z > 0 : data.velocity.z < 0;
                if (approaching && data.lastHitBy !== this.toBallPlayer(number)) {
                    const offsets = Object.values(player.strikeOffsets);
                    let bestDistance = Infinity;
                    for (const offset of offsets) {
                        const intercept = predictBaselineIntercept({ position: this.ball.position,
                            velocity: data.velocity, gravity: data.gravity }, player.group.position.z + offset.z);
                        if (!intercept) continue;
                        const candidate = THREE.MathUtils.clamp(intercept.x - offset.x, this.courtMinX, this.courtMaxX);
                        const distance = Math.abs(candidate - player.group.position.x);
                        if (distance < bestDistance) { bestDistance = distance; target = candidate; }
                    }
                } else {
                    target = 0; // Recover toward center while the ball travels away.
                }
            }
            this.autoTargets[number - 1] = target;
            const marker = this.targetMarkers[number - 1];
            marker.visible = (this.autoPositionEnabled || (number === 2 && this.botEnabled)) && this.showHitboxes && !data.isWaitingForServe;
            marker.position.set(target, 0.075, player.group.position.z);
        }
    }

    private updateBot(): void {
        const data = this.ball.userData as BallUserData;
        if (data.isWaitingForServe || data.waitingForRacketHit || data.lastHitBy !== 'player1') {
            this.botAttempted = false;
            return;
        }
        if (!this.botEnabled || this.botAttempted || this.player2.isSwinging || !this.player2.hitbox) return;
        const strokes: BotStroke[] = [];
        for (const [name, backhand] of [['SwingRight', false], ['SwingLeft', true]] as const) {
            const action = this.player2.actions[name];
            const offset = this.player2.strikeOffsets[name];
            if (action && offset) strokes.push({ backhand, offset, duration: action.getClip().duration });
        }
        const stroke = chooseBotStroke({ position: this.ball.position, velocity: data.velocity, gravity: data.gravity },
            this.player2.group.position, strokes);
        if (!stroke) return;
        this.performSwing(stroke.backhand, 2);
        this.botAttempted = this.player2.isSwinging;
    }

    private handleKeyDown = (event: KeyboardEvent): void => {
        if (event.repeat || (event.target instanceof HTMLElement &&
            (event.target.isContentEditable || ['INPUT', 'SELECT', 'BUTTON', 'TEXTAREA'].includes(event.target.tagName)))) return;
        const key = event.key.toLowerCase();
        if (key === 'h') this.showHitboxes = !this.showHitboxes;
        if (key === 'b') this.feedPracticeBall(event.shiftKey);
        if (key === 'n') this.feedPracticeBall(event.shiftKey, 2);
        if (event.code === 'Space') {
            event.preventDefault();
            this.playerServe();
        }
    };

    private performSwing(isBackhand: boolean, number: 1 | 2 = 1, hand: 'Left' | 'Right' = 'Right'): void {
        const player = number === 1 ? this.player1 : this.player2;
        if (player.isSwinging) return;
        const leftAnimation = isBackhand !== (hand === 'Left');
        const animation = leftAnimation ? 'SwingLeft' : 'SwingRight';
        if (!player.actions[animation] || !player.hitbox) {
            this.onSwingFeedback('Player/racket still loading or missing swing animation');
            return;
        }
        player.swingBackhand = isBackhand;
        player.playAnimation(animation);
        this.onSwingFeedback(`Player ${number}: ${isBackhand ? 'Backhand' : 'Forehand'} · swinging`);
    }

    public swing(event: {
        label: 'Forehand' | 'Backhand';
        hand: 'Left' | 'Right';
        player?: 1 | 2;
    }): void {
        this.performSwing(event.label === 'Backhand', event.player ?? 1, event.hand);
    }

    // B launches a predictable incoming ball toward player 1's current racket
    // position. This is an explicit practice reset and never awards a point.
    public feedPracticeBall(backhand = false, number: 1 | 2 = 1): void {
        const player = number === 1 ? this.player1 : this.player2;
        const hitbox = player.hitbox;
        if (!hitbox) { this.onSwingFeedback('Wait for the racket to load'); return; }
        player.stopAnimation();
        player.update(0);
        // Sample the middle of the chosen stroke before rendering, then restore
        // idle. Aim the practice feed at the strike pose, not the resting racket.
        const animation = backhand ? 'SwingLeft' : 'SwingRight';
        player.playAnimation(animation);
        const action = player.actions[animation];
        if (!action) { this.onSwingFeedback('Swing animation is unavailable'); return; }
        action.stopFading();
        action.setEffectiveWeight(1);
        action.time = action.getClip().duration * 0.45;
        player.update(0);
        const target = hitbox.bounds.getCenter(new THREE.Vector3()).applyMatrix4(hitbox.pose());
        player.stopAnimation();
        player.update(0);
        const origin = target.clone().add(new THREE.Vector3(0, 1, number === 1 ? -4 : 4));
        const ticks = 45;
        const velocity = target.clone().sub(origin).divideScalar(ticks);
        const data = this.ball.userData as BallUserData;
        velocity.y += data.gravity * (ticks + 1) / 2;
        this.ball.position.copy(origin);
        hitBall(this.ball, velocity, number === 1 ? 'player2' : 'player1');
        this.botAttempted = false;
        this.onSwingFeedback(`Player ${number} practice ${backhand ? 'backhand' : 'forehand'} feed · swing as the ball reaches your racket`);
    }

    private checkRacketContact(player: PlayerController, number: 1 | 2,
        previousPose: THREE.Matrix4 | undefined, previousBall: THREE.Vector3): void {
        const hitbox = player.hitbox;
        if (!hitbox || !previousPose || !player.contactActive || player.hitConsumed) return;
        const id = this.toBallPlayer(number);
        const data = this.ball.userData as BallUserData;
        // Prevent the same player repeatedly returning their own outgoing shot.
        if (!data.isWaitingForServe && !data.waitingForRacketHit && data.lastHitBy === id) return;
        if (data.waitingForRacketHit && data.lastHitBy && data.lastHitBy !== id) return;
        if (!sweptRacketContact(hitbox.bounds, previousPose, hitbox.pose(),
            previousBall, this.ball.position, BALL_RADIUS)) return;
        const direction = number === 1 ? -1 : 1;
        const velocity = data.waitingForRacketHit ? data.pendingVelocity.clone()
            : new THREE.Vector3(player.swingBackhand ? -0.04 : 0.04, 0.22, direction * 0.24);
        hitBall(this.ball, velocity, id);
        player.hitConsumed = true;
        player.contactActive = false;
        this.onSwingFeedback(`Player ${number}: Hit!`);
    }

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

            this.updateAutoTargets();

            // Substep animation and ball together, at most 1/120 s per step.
            const steps = Math.max(1, Math.ceil(delta * 120));
            const step = delta / steps;
            for (let i = 0; i < steps; i++) {
                const previousBall = this.ball.position.clone();
                const pose1 = this.player1.hitbox?.pose();
                const pose2 = this.player2.hitbox?.pose();
                this.updateBot();
                this.updatePlayer(this.player1, this.player1Input, step, 1);
                this.updatePlayer(this.player2, this.player2Input, step, 2);
                const swinging1 = this.player1.isSwinging;
                const swinging2 = this.player2.isSwinging;
                this.player1.update(step);
                this.player2.update(step);
                this.scene.updateMatrixWorld(true);
                const wasWaiting = (this.ball.userData as BallUserData).isWaitingForServe;
                updateBallMotion(this.ball, step);
                const resetDuringStep = !wasWaiting && (this.ball.userData as BallUserData).isWaitingForServe;
                // A point reset teleports the ball; that is not a swept contact.
                if (!resetDuringStep) {
                    this.checkRacketContact(this.player1, 1, pose1, previousBall);
                    this.checkRacketContact(this.player2, 2, pose2, previousBall);
                }
                for (const [player, wasSwinging, number] of [
                    [this.player1, swinging1, 1], [this.player2, swinging2, 2],
                ] as const) {
                    player.hitbox?.updateDebug(this.showHitboxes, player.contactActive, player.hitConsumed);
                    if (wasSwinging && !player.isSwinging && !player.hitConsumed) {
                        this.onSwingFeedback(`Player ${number}: Miss · no racket contact during the strike window`);
                    }
                }
            }

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
