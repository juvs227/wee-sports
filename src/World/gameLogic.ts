import * as THREE from 'three';

import {
    updateBallMotion,
    serveBall,
    hitBall,
    BALL_RADIUS,
    type BallUserData,
    type BallPlayer,
} from './components/ball';
import {
    type PlayerController,
} from './components/player';
import {
    NEUTRAL_INPUT,
    type PlayerInput,
} from '../Controllers/playerInput';
import { planCourtShot } from './shotTrajectory';
import { chooseBotStroke, type BotStroke } from './botPlayer';
import { predictBaselineIntercept, lateralSteering } from './autoPosition';
import { sweptRacketContact } from './components/racketContact';
import { ScoreSystem, type Score } from './scoreSystem';

const AUTO_TRACKING_SPEED = 0.75;

export interface GameLogicOptions {
    scene: THREE.Scene;
    player1: PlayerController;
    player2: PlayerController;
    ball: THREE.Mesh;
    targetMarkers: THREE.Mesh[];
    shotTargetMarker: THREE.Mesh;
    onSwingFeedback: () => (message: string) => void;
}

export class GameLogic {
    private readonly scene: THREE.Scene;
    private readonly player1: PlayerController;
    private readonly player2: PlayerController;
    private readonly ball: THREE.Mesh;
    private readonly targetMarkers: THREE.Mesh[];
    private readonly shotTargetMarker: THREE.Mesh;
    private readonly getSwingFeedback: () => (message: string) => void;
    private readonly scoreSystem = new ScoreSystem();
    private showHitboxes = false;
    private botAttempted = false;
    private autoTargets: [number, number] = [0, 0];
    private player1Input: PlayerInput = { ...NEUTRAL_INPUT };
    private player2Input: PlayerInput = { ...NEUTRAL_INPUT };
    private readonly courtMinX = -4.115;
    private readonly courtMaxX = 4.115;

    public autoPositionEnabled = true;
    public botEnabled = true;

    public getScore(): Score {
        return this.scoreSystem.getScore();
    }

    public constructor(options: GameLogicOptions) {
        this.scene = options.scene;
        this.player1 = options.player1;
        this.player2 = options.player2;
        this.ball = options.ball;
        this.targetMarkers = options.targetMarkers;
        this.shotTargetMarker = options.shotTargetMarker;
        this.getSwingFeedback = options.onSwingFeedback;
    }

    public setPlayerInput(input: PlayerInput, player: 1 | 2): void {
        const normalizedInput: PlayerInput = {
            moveX: THREE.MathUtils.clamp(input.moveX, -1, 1),
            moveZ: THREE.MathUtils.clamp(input.moveZ, -1, 1),
            swing: input.swing,
        };
        if (player === 1) this.player1Input = normalizedInput;
        else this.player2Input = normalizedInput;
    }

    public handleKeyDown = (event: KeyboardEvent): void => {
        if (event.repeat || (event.target instanceof HTMLElement &&
            (event.target.isContentEditable ||
                ['INPUT', 'SELECT', 'BUTTON', 'TEXTAREA'].includes(event.target.tagName)))) return;
        const key = event.key.toLowerCase();
        if (key === 'h') this.showHitboxes = !this.showHitboxes;
        if (key === 'b') this.feedPracticeBall(event.shiftKey);
        if (key === 'n') this.feedPracticeBall(event.shiftKey, 2);
        if (event.code === 'Space') {
            event.preventDefault();
            this.playerServe();
        };
    }

    public update(delta: number): void {
        this.updateAutoTargets();
        const steps = Math.max(1, Math.ceil(delta * 120));
        const step = delta / steps;
        for (let i = 0; i < steps; i++) this.updateStep(step);
    }

    public swing(event: {
        label: 'Forehand' | 'Backhand';
        hand: 'Left' | 'Right';
        player?: 1 | 2;
    }): void {
        // The lobby has no keyboard serve button. Place a held serve at the
        // existing animation's strike pose, then let normal contact release it.
        const data = this.ball.userData as BallUserData;
        if (data.isWaitingForServe) {
            if ((event.player ?? 1) !== 1) {
                this.feedback('Player 1 serves next');
                return;
            }
            const player = this.player1;
            const backhand = event.label === 'Backhand';
            const animation = backhand !== (event.hand === 'Left') ? 'SwingLeft' : 'SwingRight';
            const action = player.actions[animation];
            if (player.isSwinging) return;
            if (!action || !player.hitbox) {
                this.feedback('Wait for the racket to load');
                return;
            }
            player.stopAnimation();
            player.swingBackhand = backhand;
            player.playAnimation(animation);
            action.stopFading();
            action.setEffectiveWeight(1);
            action.time = action.getClip().duration * 0.45;
            player.update(0);
            this.ball.position.copy(player.hitbox.bounds.getCenter(new THREE.Vector3())
                .applyMatrix4(player.hitbox.pose()));
            player.stopAnimation();
            player.update(0);
            serveBall(this.ball, new THREE.Vector3(), 'player1');
        }
        this.performSwing(event.label === 'Backhand', event.player ?? 1, event.hand);
    }

    public feedPracticeBall(backhand = false, number: 1 | 2 = 1): void {
        const player = number === 1 ? this.player1 : this.player2;
        const hitbox = player.hitbox;
        if (!hitbox) {
            this.feedback('Wait for the racket to load');
            return;
        }
        player.stopAnimation();
        player.update(0);
        const animation = backhand ? 'SwingLeft' : 'SwingRight';
        player.swingBackhand = backhand;
        player.playAnimation(animation);
        const action = player.actions[animation];
        if (!action) {
            this.feedback('Swing animation is unavailable');
            return;
        }
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
        this.feedback(`Player ${number} practice ${backhand ? 'backhand' : 'forehand'} feed · swing as the ball reaches your racket`);
    }

    public playerServe(playerNumber: 1 | 2 = 1): void {
        const targetPlayer = playerNumber === 1 ? this.player1 : this.player2;
        if (targetPlayer.group.position.distanceTo(this.ball.position) > 1.5) {
            console.log('Too far from the ball to serve!');
            return;
        }
        const velocity = new THREE.Vector3(0, 0.18, playerNumber === 1 ? -0.22 : 0.22);
        serveBall(this.ball, velocity, this.toBallPlayer(playerNumber));
    }

    public startRound(): void {
        const data = this.ball.userData as BallUserData;
        data.isWaitingForServe = true;
        data.waitingForRacketHit = false;
        data.velocity.set(0, 0, 0);
        data.pendingVelocity.set(0, 0, 0);
        data.bounceCount = 0;
        data.firstBounceInBounds = false;
        data.lastHitBy = undefined;
        data.slideTimer = 0;
        this.ball.position.copy(data.servePosition);
        this.botAttempted = false;
        this.hasShotTarget = false;
        this.feedback('Round started · Player 1 serve');
        this.playerServe();
    }

    private hasShotTarget = false;

    private updateStep(step: number): void {
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
        const data = this.ball.userData as BallUserData;
        const wasWaiting = data.isWaitingForServe;
        updateBallMotion(this.ball, step, (winner, loser) =>
            this.scoreSystem.awardPoint(winner, loser));
        const resetDuringStep = !wasWaiting && data.isWaitingForServe;
        if (!resetDuringStep) {
            this.checkRacketContact(this.player1, 1, pose1, previousBall);
            this.checkRacketContact(this.player2, 2, pose2, previousBall);
        }
        for (const [player, wasSwinging, number] of [
            [this.player1, swinging1, 1], [this.player2, swinging2, 2],
        ] as const) {
            player.hitbox?.updateDebug(this.showHitboxes, player.contactActive, player.hitConsumed);
            if (wasSwinging && !player.isSwinging && !player.hitConsumed) {
                this.feedback(`Player ${number}: Miss · no racket contact during the strike window`);
            }
        }
    }

    private updatePlayer(player: PlayerController, input: PlayerInput, delta: number, number: 1 | 2): void {
        const swing = input.swing;
        input.swing = undefined;
        if (player.isSwinging) return;
        const assisted = this.autoPositionEnabled || (number === 2 && this.botEnabled);
        const moveX = assisted
            ? lateralSteering(player.group.position.x, this.autoTargets[number - 1]) *
            AUTO_TRACKING_SPEED : input.moveX;
        const moveZ = assisted ? 0 : input.moveZ;
        if (!swing) player.move(moveX, moveZ, delta);
        const moving = !swing && Math.abs(moveX) + Math.abs(moveZ) > 0.01;
        if (swing) this.performSwing(swing === 'left', number);
        else if (moving) player.playAnimation('WalkCycle');
        else player.stopAnimation();
    }

    private updateAutoTargets(): void {
        const data = this.ball.userData as BallUserData;
        for (const [player, number] of [[this.player1, 1], [this.player2, 2]] as const) {
            let target = player.group.position.x;
            if (!data.isWaitingForServe && !data.waitingForRacketHit && !player.isSwinging) {
                const approaching = number === 1 ? data.velocity.z > 0 : data.velocity.z < 0;
                if (approaching && data.lastHitBy !== this.toBallPlayer(number)) {
                    let bestDistance = Infinity;
                    for (const offset of Object.values(player.strikeOffsets)) {
                        const intercept = predictBaselineIntercept({
                            position: this.ball.position, velocity: data.velocity, gravity: data.gravity
                        }, player.group.position.z + offset.z);
                        if (!intercept) continue;
                        const candidate = THREE.MathUtils.clamp(
                            intercept.x - offset.x, this.courtMinX, this.courtMaxX);
                        const distance = Math.abs(candidate - player.group.position.x);
                        if (distance < bestDistance) {
                            bestDistance = distance;
                            target = candidate;
                        }
                    }
                } else target = 0;
            }
            this.autoTargets[number - 1] = target;
            const marker = this.targetMarkers[number - 1];
            marker.visible = (this.autoPositionEnabled || (number === 2 && this.botEnabled)) &&
                this.showHitboxes && !data.isWaitingForServe;
            marker.position.set(target, 0.075, player.group.position.z);
        }
        this.shotTargetMarker.visible = this.hasShotTarget && this.showHitboxes &&
            !(data.isWaitingForServe);
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
        const stroke = chooseBotStroke({
            position: this.ball.position, velocity: data.velocity, gravity: data.gravity
        }, this.player2.group.position, strokes);
        if (!stroke) return;
        this.performSwing(stroke.backhand, 2);
        this.botAttempted = this.player2.isSwinging;
    }

    private performSwing(isBackhand: boolean, number: 1 | 2, hand: 'Left' | 'Right' = 'Right'): void {
        const player = number === 1 ? this.player1 : this.player2;
        if (player.isSwinging) return;
        const leftAnimation = isBackhand !== (hand === 'Left');
        const animation = leftAnimation ? 'SwingLeft' : 'SwingRight';
        if (!player.actions[animation] || !player.hitbox) {
            this.feedback('Player/racket still loading or missing swing animation');
            return;
        }
        player.swingBackhand = isBackhand;
        player.playAnimation(animation);
        this.feedback(`Player ${number}: ${isBackhand ? 'Backhand' : 'Forehand'} · swinging`);
    }

    private checkRacketContact(player: PlayerController, number: 1 | 2,
        previousPose: THREE.Matrix4 | undefined, previousBall: THREE.Vector3): void {
        const hitbox = player.hitbox;
        if (!hitbox || !previousPose || !player.contactActive || player.hitConsumed) return;
        const id = this.toBallPlayer(number);
        const data = this.ball.userData as BallUserData;
        if (!data.isWaitingForServe && !data.waitingForRacketHit && data.lastHitBy === id) return;
        if (data.waitingForRacketHit && data.lastHitBy && data.lastHitBy !== id) return;
        if (!sweptRacketContact(hitbox.bounds, previousPose, hitbox.pose(),
            previousBall, this.ball.position, BALL_RADIUS)) return;
        const plan = planCourtShot(this.ball.position, number, player.swingBackhand, data.gravity);
        if (!plan) {
            player.hitConsumed = true;
            player.contactActive = false;
            this.feedback(`Player ${number}: Contact, but no safe court trajectory from this position`);
            return;
        }
        hitBall(this.ball, plan.velocity, id);
        this.hasShotTarget = true;
        this.shotTargetMarker.position.set(plan.target.x, 0.08, plan.target.z);
        this.shotTargetMarker.visible = this.showHitboxes;
        player.hitConsumed = true;
        player.contactActive = false;
        this.feedback(`Player ${number}: Hit! · aim (${plan.target.x.toFixed(1)}, ${plan.target.z.toFixed(1)})`);
    }

    private toBallPlayer(playerNumber: 1 | 2): BallPlayer {
        return playerNumber === 1 ? 'player1' : 'player2';
    }

    private feedback(message: string): void {
        this.getSwingFeedback()(message);
    }
}
