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
import { sweptRacketContact, contactWindowCrossed } from './components/racketContact';
import { ScoreSystem, type Score } from './scoreSystem';

const AUTO_TRACKING_SPEED = 0.75;
const PHYSICS_STEP = 1 / 120;
// A phone reports a stroke after it has begun. Buffer a slightly early input,
// then time the authored animation to the incoming ball; contact still has to
// pass the normal swept racket test. Never replay inputs into a later shot.
const SWING_BUFFER_SECONDS = 0.45;
const STRIKE_PROGRESS = 0.45;
// The authored backhand rises through contact later than the forehand.
const BACKHAND_PROGRESS = 0.65;

interface PendingSwing {
    backhand: boolean;
    hand: 'Left' | 'Right';
    remaining: number;
    lastHitBy: BallPlayer;
}

export interface GameLogicOptions {
    scene: THREE.Scene;
    player1: PlayerController;
    player2: PlayerController;
    ball: THREE.Mesh;
    targetMarkers: THREE.Mesh[];
    shotTargetMarker: THREE.Mesh;
    onSwingFeedback: () => (message: string) => void;
    onHit?: (player: 1 | 2) => void;
}

export class GameLogic {
    private readonly player1: PlayerController;
    private readonly player2: PlayerController;
    private readonly ball: THREE.Mesh;
    private readonly targetMarkers: THREE.Mesh[];
    private readonly shotTargetMarker: THREE.Mesh;
    private readonly getSwingFeedback: () => (message: string) => void;
    private readonly onHit: (player: 1 | 2) => void;
    private readonly scoreSystem = new ScoreSystem();
    private showHitboxes = false;
    private botAttempted = false;
    private autoTargets: [number, number] = [0, 0];
    private player1Input: PlayerInput = { ...NEUTRAL_INPUT };
    private player2Input: PlayerInput = { ...NEUTRAL_INPUT };
    private pendingSwings: [PendingSwing | null, PendingSwing | null] = [null, null];
    private accumulatedTime = 0;
    private readonly courtMinX = -4.115;
    private readonly courtMaxX = 4.115;

    public autoPositionEnabled = true;
    public botEnabled = true;

    public getScore(): Score {
        return this.scoreSystem.getScore();
    }

    public constructor(options: GameLogicOptions) {
        this.player1 = options.player1;
        this.player2 = options.player2;
        this.ball = options.ball;
        this.targetMarkers = options.targetMarkers;
        this.shotTargetMarker = options.shotTargetMarker;
        this.getSwingFeedback = options.onSwingFeedback;
        this.onHit = options.onHit ?? (() => {});
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

    public clearPendingInputs(): void {
        this.accumulatedTime = 0;
        this.pendingSwings = [null, null];
        this.player1Input = { ...NEUTRAL_INPUT };
        this.player2Input = { ...NEUTRAL_INPUT };
        this.player1.stopAnimation();
        this.player2.stopAnimation();
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
        if (!Number.isFinite(delta) || delta <= 0) return;
        // Use the same integration step as the trajectory/contact forecast,
        // including on 144 Hz displays. Rendering frequency must not change a hit.
        this.accumulatedTime += Math.min(delta, .05);
        while (this.accumulatedTime + 1e-10 >= PHYSICS_STEP) {
            this.accumulatedTime -= PHYSICS_STEP;
            this.updateAutoTargets();
            this.updateStep(PHYSICS_STEP);
        }
    }

    public swing(event: {
        label: 'Forehand' | 'Backhand';
        hand: 'Left' | 'Right';
        player?: 1 | 2;
    }): void {
        // The lobby has no keyboard serve button. Place a held serve at the
        // existing animation's strike pose, then let normal contact release it.
        const data = this.ball.userData as BallUserData;
        if (data.isWaitingForServe || data.waitingForRacketHit) {
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
        const number = event.player ?? 1;
        const player = number === 1 ? this.player1 : this.player2;
        const backhand = event.label === 'Backhand';
        const animation = this.swingAnimation(backhand, event.hand);
        const action = player.actions[animation];
        const intercept = this.strokeIntercept(player, animation, number);
        if (this.autoPositionEnabled && action && intercept &&
            intercept.time <= SWING_BUFFER_SECONDS &&
            intercept.time > action.getClip().duration * (backhand ? BACKHAND_PROGRESS : STRIKE_PROGRESS) &&
            data.lastHitBy && !player.isSwinging) {
            this.pendingSwings[number - 1] = {
                backhand, hand: event.hand, remaining: SWING_BUFFER_SECONDS,
                lastHitBy: data.lastHitBy,
            };
            this.feedback(`Player ${number}: ${event.label} ready · meeting the incoming ball`);
            return;
        }
        this.pendingSwings[number - 1] = null;
        this.performSwing(backhand, number, event.hand, true);
    }

    public feedPracticeBall(backhand = false, number: 1 | 2 = 1): void {
        const player = number === 1 ? this.player1 : this.player2;
        const hitbox = player.hitbox;
        if (!hitbox) {
            this.feedback('Wait for the racket to load');
            return;
        }
        this.clearPendingInputs();
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
        this.clearPendingInputs();
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
        this.updatePendingSwings(step);
        this.updatePlayer(this.player1, this.player1Input, step, 1);
        this.updatePlayer(this.player2, this.player2Input, step, 2);
        const swinging1 = this.player1.isSwinging;
        const swinging2 = this.player2.isSwinging;
        this.player1.update(step);
        this.player2.update(step);
        // RacketHitbox.pose updates the racket's ancestor chain for collision.
        // The renderer updates the rest of the scene once per displayed frame;
        // forcing static scenery to update at 120 Hz duplicates that work.
        const data = this.ball.userData as BallUserData;
        const wasWaiting = data.isWaitingForServe;
        updateBallMotion(this.ball, step, (winner, loser) =>
            this.scoreSystem.awardPoint(winner, loser));
        const resetDuringStep = !wasWaiting && data.isWaitingForServe;
        if (resetDuringStep) this.pendingSwings = [null, null];
        if (!resetDuringStep) {
            this.checkRacketContact(this.player1, 1, pose1, previousBall);
            this.checkRacketContact(this.player2, 2, pose2, previousBall);
        }
        for (const [player, wasSwinging, number] of [
            [this.player1, swinging1, 1], [this.player2, swinging2, 2],
        ] as const) {
            player.hitbox?.updateDebug(this.showHitboxes, player.contactActive, player.hitConsumed);
            if (wasSwinging && !player.isSwinging && !player.hitConsumed) {
                this.feedback(`Player ${number}: Miss · swing a little earlier as the ball approaches your side`);
            }
        }
    }

    private updatePlayer(player: PlayerController, input: PlayerInput, delta: number, number: 1 | 2): void {
        const swing = input.swing;
        input.swing = undefined;
        const assisted = this.autoPositionEnabled || (number === 2 && this.botEnabled);
        const moveX = assisted
            ? lateralSteering(player.group.position.x, this.autoTargets[number - 1]) *
            AUTO_TRACKING_SPEED : input.moveX;
        if (player.isSwinging) {
            // Starting a phone stroke must not freeze an assisted player short
            // of the incoming ball. Keep ordinary bounded foot movement.
            if (assisted && !player.hitConsumed) player.move(moveX, 0, delta);
            return;
        }
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
            if (!data.isWaitingForServe && !data.waitingForRacketHit) {
                const approaching = number === 1 ? data.velocity.z > 0 : data.velocity.z < 0;
                if (approaching && data.lastHitBy !== this.toBallPlayer(number)) {
                    let bestDistance = Infinity;
                    const pending = this.pendingSwings[number - 1];
                    const selected = pending ? this.swingAnimation(pending.backhand, pending.hand)
                        : player.isSwinging ? player.currentAnimation : null;
                    const preferred = selected && player.strikeOffsets[selected];
                    for (const offset of preferred ? [preferred] : Object.values(player.strikeOffsets)) {
                        const intercept = predictBaselineIntercept({
                            position: this.ball.position, velocity: data.velocity, gravity: data.gravity, bounceCount: data.bounceCount
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
            position: this.ball.position, velocity: data.velocity, gravity: data.gravity, bounceCount: data.bounceCount
        }, this.player2.group.position, strokes);
        if (!stroke) return;
        this.performSwing(stroke.backhand, 2);
        this.botAttempted = this.player2.isSwinging;
    }

    private swingAnimation(backhand: boolean, hand: 'Left' | 'Right'): string {
        return backhand !== (hand === 'Left') ? 'SwingLeft' : 'SwingRight';
    }

    private strokeIntercept(player: PlayerController, animation: string, number: 1 | 2) {
        const data = this.ball.userData as BallUserData;
        const offset = player.strikeOffsets[animation];
        if (!offset || data.isWaitingForServe || data.waitingForRacketHit ||
            data.lastHitBy === this.toBallPlayer(number) ||
            (number === 1 ? data.velocity.z <= 0 : data.velocity.z >= 0)) return null;
        return predictBaselineIntercept({
            position: this.ball.position, velocity: data.velocity, gravity: data.gravity, bounceCount: data.bounceCount,
        }, player.group.position.z + offset.z);
    }

    private updatePendingSwings(delta: number): void {
        const data = this.ball.userData as BallUserData;
        for (const [player, number] of [[this.player1, 1], [this.player2, 2]] as const) {
            const pending = this.pendingSwings[number - 1];
            if (!pending) continue;
            pending.remaining -= delta;
            if (pending.remaining <= 0 || data.isWaitingForServe ||
                data.waitingForRacketHit || data.lastHitBy !== pending.lastHitBy) {
                this.pendingSwings[number - 1] = null;
                continue;
            }
            const animation = this.swingAnimation(pending.backhand, pending.hand);
            const action = player.actions[animation];
            const intercept = this.strokeIntercept(player, animation, number);
            if (!action || !intercept ||
                intercept.time > action.getClip().duration * (pending.backhand ? BACKHAND_PROGRESS : STRIKE_PROGRESS)) continue;
            this.pendingSwings[number - 1] = null;
            this.performSwing(pending.backhand, number, pending.hand, true);
        }
    }

    private assistedStartTime(player: PlayerController, animation: string, backhand: boolean, number: 1 | 2): number {
        const data = this.ball.userData as BallUserData;
        const poses = player.swingPoses[`${animation}:${backhand}`];
        const hitbox = player.hitbox;
        if (!poses || !hitbox || data.isWaitingForServe || data.waitingForRacketHit) return 0;
        const duration = player.actions[animation].getClip().duration;
        const path = [this.ball.position.clone()];
        const playerX = [player.group.position.x];
        const velocity = data.velocity.clone();
        let bounces = data.bounceCount;
        // Forecast just one animation, with the same 120 Hz bounce response.
        for (let time = 1 / 120; time <= duration; time += 1 / 120) {
            velocity.y -= data.gravity * .5;
            const point = path[path.length - 1].clone().addScaledVector(velocity, .5);
            if (point.y <= BALL_RADIUS) {
                if (++bounces >= 2) break;
                point.y = BALL_RADIUS;
                velocity.y *= -.55;
                velocity.x *= .65;
                velocity.z *= .65;
            }
            path.push(point);
            const previousX = playerX[playerX.length - 1];
            playerX.push(previousX + lateralSteering(previousX, this.autoTargets[number - 1]) *
                AUTO_TRACKING_SPEED * player.movementSpeed / 120);
        }
        player.group.updateWorldMatrix(true, false);
        const poseAt = (progress: number, step: number) => {
            const index = Math.min(19, Math.floor(progress * 20));
            const fraction = progress * 20 - index;
            const position = new THREE.Vector3(), scale = new THREE.Vector3(), rotation = new THREE.Quaternion();
            const nextPosition = new THREE.Vector3(), nextScale = new THREE.Vector3(), nextRotation = new THREE.Quaternion();
            poses[index].decompose(position, rotation, scale);
            poses[index + 1].decompose(nextPosition, nextRotation, nextScale);
            const transform = player.group.matrixWorld.clone();
            transform.elements[12] += playerX[step] - player.group.position.x;
            return new THREE.Matrix4().multiplyMatrices(transform,
                new THREE.Matrix4().compose(position.lerp(nextPosition, fraction),
                    rotation.slerp(nextRotation, fraction), scale.lerp(nextScale, fraction)));
        };
        // Choose a broad contact window within the remaining animation. Equal
        // windows favor less skipped wind-up; the ball is never rewound.
        let bestStart = 0;
        let mostContactSteps = 0;
        for (let sample = 0; sample <= 26; sample++) {
            const start = sample / 40;
            let contactSteps = 0;
            for (let step = 1; step < path.length; step++) {
                const before = start + (step - 1) / (120 * duration);
                const after = start + step / (120 * duration);
                if (after > .8) break;
                if (contactWindowCrossed(before, after, backhand) &&
                    sweptRacketContact(hitbox.bounds, poseAt(before, step - 1), poseAt(after, step),
                        path[step - 1], path[step], BALL_RADIUS)) contactSteps++;
            }
            if (contactSteps > mostContactSteps) {
                mostContactSteps = contactSteps;
                bestStart = start * duration;
            }
        }
        return bestStart;
    }

    private performSwing(isBackhand: boolean, number: 1 | 2, hand: 'Left' | 'Right' = 'Right',
        assistTiming = false): void {
        const player = number === 1 ? this.player1 : this.player2;
        if (player.isSwinging) return;
        const animation = this.swingAnimation(isBackhand, hand);
        if (!player.actions[animation] || !player.hitbox) {
            this.feedback('Player/racket still loading or missing swing animation');
            return;
        }
        player.swingBackhand = isBackhand;
        player.playAnimation(animation);
        // Avoid adding a full wind-up after the phone's physical stroke. This
        // advances only the animation, never the ball or the contact result.
        if (assistTiming && this.autoPositionEnabled) {
            const action = player.actions[animation];
            const intercept = this.strokeIntercept(player, animation, number);
            if (intercept) {
                action.stopFading();
                action.setEffectiveWeight(1);
                action.time = this.assistedStartTime(player, animation, isBackhand, number);
            }
        }
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
        this.onHit(number);
    }

    private toBallPlayer(playerNumber: 1 | 2): BallPlayer {
        return playerNumber === 1 ? 'player1' : 'player2';
    }

    private feedback(message: string): void {
        this.getSwingFeedback()(message);
    }
}
