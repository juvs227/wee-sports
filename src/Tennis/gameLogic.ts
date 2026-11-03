import * as THREE from 'three';

import {
    updateBallMotion,
    serveBall,
    hitBall,
    prepareServe,
    finishPoint,
    recordServeFault,
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
import { ScoreSystem, type Score, type PointResult, type MatchFormat } from './scoreSystem';
import { TENNIS_COURT, serviceSign, pointReasonLabel } from './tennisRules';

const AUTO_TRACKING_SPEED = 0.75;
const PHYSICS_STEP = 1 / 120;
// A phone reports a stroke after it has begun. Buffer a slightly early input,
// then time the authored animation to the incoming ball; contact still has to
// pass the normal swept racket test. Never replay inputs into a later shot.
const SWING_BUFFER_SECONDS = 0.65;
const STRIKE_PROGRESS = 0.45;
// The authored backhand rises through contact later than the forehand.
const BACKHAND_PROGRESS = 0.65;

interface PendingSwing {
    backhand: boolean;
    hand: 'Left' | 'Right';
    remaining: number;
    lastHitBy: BallPlayer;
    power: number;
    retryIn?: number;
}

export interface TennisSettings {
    format: MatchFormat;
    assistance: 'beginner' | 'standard';
    botDifficulty: 'beginner' | 'standard';
    timingAssist: boolean;
    autoMove: boolean;
}
export interface PracticeState {
    active: boolean;
    stroke: 'forehand' | 'backhand' | 'alternate';
    hand: 'Right' | 'Left';
    attempts: number;
    returns: number;
    streak: number;
    bestStreak: number;
}
export interface StrokeResult {
    id: string;
    player: 1 | 2;
    result: 'hit' | 'miss' | 'rejected';
    reason: string;
    receivedToContactMs?: number;
}
interface StrokeTrace {
    id?: string;
    receivedAt: number;
    reason: string;
    timing: number;
}

export interface TennisGameEvent {
    kind: 'hit' | 'bounce' | 'point' | 'game' | 'set' | 'match' | 'serve' | 'fault' | 'let';
    player: 1 | 2;
    reason?: string;
    swingId?: string;
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
    onGameEvent?: (event: TennisGameEvent) => void;
    onStrokeResult?: (result: StrokeResult) => void;
}

export class GameLogic {
    private readonly player1: PlayerController;
    private readonly player2: PlayerController;
    private readonly ball: THREE.Mesh;
    private readonly targetMarkers: THREE.Mesh[];
    private readonly shotTargetMarker: THREE.Mesh;
    private readonly getSwingFeedback: () => (message: string) => void;
    private readonly onHit: (player: 1 | 2) => void;
    private readonly onGameEvent: (event: TennisGameEvent) => void;
    private readonly scoreSystem = new ScoreSystem();
    private readonly onStrokeResult: (result: StrokeResult) => void;
    private readonly settings: TennisSettings = {format: 'full', assistance: 'standard', botDifficulty: 'standard', timingAssist: true, autoMove: true};
    private practice: PracticeState = {active: false, stroke: 'alternate', hand: 'Right', attempts: 0, returns: 0, streak: 0, bestStreak: 0};
    private practiceTimer = 0;
    private practiceReturned = false;
    private practiceResume: {attempt: 1 | 2; status: BallUserData['serveStatus']} | null = null;
    private strokes: [StrokeTrace | null, StrokeTrace | null] = [null, null];
    private swingTimings = [0, 0];
    private simulationTime = 0;
    private botReadyAt = 0;
    private showHitboxes = false;
    private botAttempted = false;
    private autoTargets: [number, number] = [0, 0];
    private autoDepths: [number, number] = [TENNIS_COURT.rallyDepth, -TENNIS_COURT.rallyDepth];
    private player1Input: PlayerInput = { ...NEUTRAL_INPUT };
    private player2Input: PlayerInput = { ...NEUTRAL_INPUT };
    private pendingSwings: [PendingSwing | null, PendingSwing | null] = [null, null];
    private swingPowers = [0.5, 0.5];
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
        this.onGameEvent = options.onGameEvent ?? (() => {});
        this.onStrokeResult = options.onStrokeResult ?? (() => {});
    }

    public getSettings(): TennisSettings { return {...this.settings, autoMove: this.autoPositionEnabled}; }
    public configure(settings: Partial<TennisSettings>): void {
        const previousFormat = this.settings.format;
        if (settings.format === 'full' || settings.format === 'quick') this.settings.format = settings.format;
        if (settings.assistance === 'beginner' || settings.assistance === 'standard') this.settings.assistance = settings.assistance;
        if (settings.botDifficulty === 'beginner' || settings.botDifficulty === 'standard') this.settings.botDifficulty = settings.botDifficulty;
        if (typeof settings.timingAssist === 'boolean') {
            this.settings.timingAssist = settings.timingAssist;
            if (!settings.timingAssist) {
                for (const number of [1, 2] as const) if (this.pendingSwings[number - 1]) {
                    this.pendingSwings[number - 1] = null;
                    this.reportStroke(number, 'rejected', 'Timing assistance changed');
                }
            }
        }
        if (typeof settings.autoMove === 'boolean') this.autoPositionEnabled = settings.autoMove;
        this.settings.autoMove = this.autoPositionEnabled;
        if (previousFormat !== this.settings.format) this.startRound();
    }
    public getServeState() {
        const data = this.ball.userData as BallUserData;
        return {attempt: data.serveAttempt, side: data.serviceSide, status: data.serveStatus};
    }
    public getPracticeState(): PracticeState { return {...this.practice}; }
    public startPractice(stroke: PracticeState['stroke'] = 'alternate', hand: 'Right' | 'Left' = 'Right'): void {
        this.clearPendingInputs();
        if (!this.practice.active) {
            const data = this.ball.userData as BallUserData;
            this.practiceResume = data.isWaitingForServe || data.waitingForRacketHit
                ? {attempt: data.serveAttempt, status: data.serveStatus} : {attempt: 1, status: 'ready'};
        }
        if (!['forehand', 'backhand', 'alternate'].includes(stroke)) stroke = 'alternate';
        if (hand !== 'Left') hand = 'Right';
        this.practice = {active: true, stroke, hand, attempts: 0, returns: 0, streak: 0, bestStreak: 0};
        this.practiceTimer = .3;
        this.practiceReturned = false;
        this.player1.group.position.set(0, this.player1.group.position.y, TENNIS_COURT.rallyDepth);
        prepareServe(this.ball, 0);
        this.feedback('Practice · return the fed ball. Match scoring is paused.');
    }
    public stopPractice(): void {
        if (!this.practice.active) return;
        this.clearPendingInputs('Practice ended');
        this.practice.active = false;
        this.practiceTimer = 0;
        const score = this.scoreSystem.getScore();
        const data = this.ball.userData as BallUserData;
        data.servingPlayer = score.server;
        data.serviceSide = score.serviceSide;
        data.serveAttempt = this.practiceResume?.attempt ?? 1;
        data.serveStatus = this.practiceResume?.status ?? 'ready';
        this.practiceResume = null;
        prepareServe(this.ball, .3);
        this.setServerPosition();
        this.hasShotTarget = false;
        this.feedback(score.matchWinner ? 'Practice finished · match result preserved'
            : 'Practice finished · resume the current point when ready');
    }
    private reportStroke(player: 1 | 2, result: StrokeResult['result'], reason: string): void {
        const trace = this.strokes[player - 1];
        if (!trace) return;
        this.strokes[player - 1] = null;
        if (trace.id) this.onStrokeResult({id: trace.id, player, result, reason,
            ...(result === 'hit' ? {receivedToContactMs: Math.max(0, performance.now() - trace.receivedAt)} : {})});
    }
    private setServerPosition(): void {
        const data = this.ball.userData as BallUserData;
        const server = data.servingPlayer === 'player1' ? 1 : 2;
        const player = server === 1 ? this.player1 : this.player2;
        player.group.position.x = serviceSign(server, data.serviceSide) * 1.3;
        player.group.position.z = server === 1 ? TENNIS_COURT.serveDepth : -TENNIS_COURT.serveDepth;
        this.autoTargets[server - 1] = player.group.position.x;
        this.autoDepths[server - 1] = player.group.position.z;
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

    public clearPendingInputs(reason = 'Play paused or point ended'): void {
        this.reportStroke(1, 'rejected', reason);
        this.reportStroke(2, 'rejected', reason);
        this.accumulatedTime = 0;
        this.pendingSwings = [null, null];
        this.swingPowers = [0.5, 0.5];
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
        if (!Number.isFinite(delta) || delta <= 0 || (this.scoreSystem.isComplete && !this.practice.active)) return;
        // Use the same integration step as the trajectory/contact forecast,
        // including on 144 Hz displays. Rendering frequency must not change a hit.
        this.accumulatedTime += Math.min(delta, .05);
        while (this.accumulatedTime + 1e-10 >= PHYSICS_STEP) {
            this.accumulatedTime -= PHYSICS_STEP;
            this.simulationTime += PHYSICS_STEP;
            this.updateAutoTargets();
            this.updateStep(PHYSICS_STEP);
        }
    }

    public swing(event: {
        label: 'Forehand' | 'Backhand';
        hand: 'Left' | 'Right';
        player?: 1 | 2;
        power?: number;
        id?: string;
    }): void {
        const number = event.player ?? 1;
        const currentPlayer = number === 1 ? this.player1 : this.player2;
        if (currentPlayer.isSwinging && this.strokes[number - 1]) {
            const reason = 'Finish the current stroke';
            this.feedback(`Player ${number}: ${reason}`);
            if (event.id) this.onStrokeResult({id: event.id, player: number, result: 'rejected', reason});
            return;
        }
        this.reportStroke(number, 'rejected', 'Replaced by a newer stroke');
        this.strokes[number - 1] = {id: event.id, receivedAt: performance.now(), reason: 'No racket contact', timing: 0};
        const reject = (reason: string): void => { this.feedback(`Player ${number}: ${reason}`); this.reportStroke(number, 'rejected', reason); };
        if (this.scoreSystem.isComplete && !this.practice.active) { reject('Match complete'); return; }
        if (this.practice.active && ((this.ball.userData as BallUserData).isWaitingForServe || this.practiceTimer > 0)) {
            reject('Wait for the next practice feed'); return;
        }
        // The lobby has no keyboard serve button. Place a held serve at the
        // existing animation's strike pose, then let normal contact release it.
        const data = this.ball.userData as BallUserData;
        if (data.isWaitingForServe || data.waitingForRacketHit) {
            if (data.serveDelayRemaining > 0) {
                reject('Point finished · get ready to serve');
                return;
            }
            const servingPlayer = data.servingPlayer === 'player1' ? 1 : 2;
            if ((event.player ?? 1) !== servingPlayer) {
                reject(`Player ${servingPlayer} serves next`);
                return;
            }
            const player = servingPlayer === 1 ? this.player1 : this.player2;
            const backhand = event.label === 'Backhand';
            const animation = backhand !== (event.hand === 'Left') ? 'SwingLeft' : 'SwingRight';
            const action = player.actions[animation];
            if (player.isSwinging) { reject('Finish the current stroke'); return; }
            if (!action || !player.hitbox) {
                reject('Wait for the racket to load');
                return;
            }
            this.setServerPosition();
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
            serveBall(this.ball, new THREE.Vector3(), data.servingPlayer);
        }
        const power = Number.isFinite(event.power) ? THREE.MathUtils.clamp(event.power!, 0, 1) : 0.5;
        const player = number === 1 ? this.player1 : this.player2;
        const backhand = event.label === 'Backhand';
        const animation = this.swingAnimation(backhand, event.hand);
        const action = player.actions[animation];
        const intercept = this.strokeIntercept(player, animation, number, backhand);
        const contactTime = action?.getClip().duration * (backhand ? BACKHAND_PROGRESS : STRIKE_PROGRESS);
        const trace = this.strokes[number - 1];
        if (trace) {
            trace.timing = intercept && Number.isFinite(contactTime)
                ? THREE.MathUtils.clamp((intercept.time - contactTime) / .3, -1, 1) : 0;
            trace.reason = data.isWaitingForServe || data.waitingForRacketHit ? 'No racket contact'
                : data.lastHitBy === this.toBallPlayer(number) ? 'Wait for the opponent’s return'
                : !intercept ? (data.lastHitBy !== this.toBallPlayer(number) &&
                    (this.ball.position.z - player.group.position.z) * (number === 1 ? 1 : -1) > .5
                    ? 'Too late' : 'Ball is out of reach')
                : intercept.time > (action?.getClip().duration ?? 0) * .8 ? 'Too early'
                : intercept.time < .04 ? 'Too late' : 'Racket did not reach the ball';
            this.swingTimings[number - 1] = trace.timing;
        }
        if (player.isSwinging) { reject('Finish the current stroke'); return; }
        if (this.settings.timingAssist && action && intercept &&
            intercept.time <= (this.settings.assistance === 'beginner' ? .75 : SWING_BUFFER_SECONDS) &&
            intercept.time > action.getClip().duration * (backhand ? BACKHAND_PROGRESS : STRIKE_PROGRESS) &&
            data.lastHitBy && !player.isSwinging) {
            this.pendingSwings[number - 1] = {
                backhand, hand: event.hand, remaining: this.settings.assistance === 'beginner' ? .75 : SWING_BUFFER_SECONDS,
                lastHitBy: data.lastHitBy, power,
            };
            this.feedback(`Player ${number}: ${event.label} ready · meeting the incoming ball`);
            return;
        }
        this.pendingSwings[number - 1] = null;
        this.performSwing(backhand, number, event.hand, true, power);
    }

    public feedPracticeBall(backhand = false, number: 1 | 2 = 1): void {
        if (this.scoreSystem.isComplete && !this.practice.active) return;
        if (!this.practice.active) { this.startPractice(backhand ? 'backhand' : 'forehand'); return; }
        const player = number === 1 ? this.player1 : this.player2;
        const hitbox = player.hitbox;
        if (!hitbox) {
            this.feedback('Wait for the racket to load');
            return;
        }
        this.clearPendingInputs();
        player.stopAnimation();
        player.update(0);
        const animation = this.swingAnimation(backhand, this.practice.hand);
        player.swingBackhand = backhand;
        player.playAnimation(animation);
        const action = player.actions[animation];
        if (!action) {
            this.feedback('Swing animation is unavailable');
            return;
        }
        action.stopFading();
        action.setEffectiveWeight(1);
        action.time = action.getClip().duration * (backhand ? BACKHAND_PROGRESS : STRIKE_PROGRESS);
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
        this.practice.attempts++;
        this.practiceReturned = false;
        this.practiceTimer = 0;
        this.feedback(`Player ${number} practice ${backhand ? 'backhand' : 'forehand'} feed · swing as the ball reaches your racket`);
    }

    public playerServe(playerNumber: 1 | 2 = 1): void {
        this.swing({label: 'Forehand', hand: 'Right', player: playerNumber});
    }

    public startRound(): void {
        this.clearPendingInputs();
        this.practice.active = false;
        this.practiceTimer = 0;
        this.practiceResume = null;
        this.scoreSystem.reset(this.settings.format);
        const data = this.ball.userData as BallUserData;
        data.isWaitingForServe = true;
        data.waitingForRacketHit = false;
        data.velocity.set(0, 0, 0);
        data.pendingVelocity.set(0, 0, 0);
        data.bounceCount = 0;
        data.firstBounceInBounds = false;
        data.lastHitBy = undefined;
        data.slideTimer = 0;
        data.serveDelayRemaining = 0;
        data.servingPlayer = 'player1';
        data.serviceSide = 'deuce';
        data.serveAttempt = 1;
        data.serveStatus = 'ready';
        prepareServe(this.ball, 0);
        this.setServerPosition();
        this.botAttempted = false;
        this.hasShotTarget = false;
        this.feedback('New match · Player 1 serves when ready');
    }

    private hasShotTarget = false;

    private updateStep(step: number): void {
        if (this.scoreSystem.isComplete && !this.practice.active) return;
        if (this.practice.active && this.practiceTimer > 0) {
            this.practiceTimer -= step;
            if (this.practiceTimer <= 0) {
                const backhand = this.practice.stroke === 'backhand' ||
                    (this.practice.stroke === 'alternate' && this.practice.attempts % 2 === 1);
                this.feedPracticeBall(backhand);
                if (!this.player1.hitbox) this.practiceTimer = .3;
            }
            return;
        }
        const previousBall = this.ball.position.clone();
        const pose1 = this.player1.hitbox?.pose();
        const pose2 = this.player2.hitbox?.pose();
        if (!this.practice.active) this.updateBot();
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
        if (data.isWaitingForServe) {
            data.serveDelayRemaining = Math.max(0, data.serveDelayRemaining - step);
        }
        const wasWaiting = data.isWaitingForServe;
        const results: PointResult[] = [];
        updateBallMotion(this.ball, step, (winner, loser, reason) => {
            if (this.practice.active) {
                if (!this.practiceReturned) this.practice.streak = 0;
                this.practiceTimer = 1.4;
                this.feedback(this.practiceReturned ? 'Good return · next ball coming' : `${reason ? pointReasonLabel(reason) : 'Miss'} · try the next ball`);
                return;
            }
            const result = this.scoreSystem.awardPoint(winner, loser, reason);
            const score = this.scoreSystem.getScore();
            data.servingPlayer = score.server;
            data.serviceSide = score.serviceSide;
            if (result) results.push(result);
        }, () => this.onGameEvent({ kind: 'bounce', player: data.lastHitBy === 'player2' ? 2 : 1 }), (call, player) => {
            this.feedback(call === 'let' ? `Let · Player ${player} repeats serve ${data.serveAttempt}` : `First fault · Player ${player}, second serve`);
            this.onGameEvent({kind: call === 'let' ? 'let' : 'fault', player, reason: call});
        });
        const resetDuringStep = !wasWaiting && data.isWaitingForServe;
        if (resetDuringStep) {
            this.clearPendingInputs('Point ended before racket contact');
            if (!this.practice.active) this.setServerPosition();
            this.botAttempted = false;
            this.hasShotTarget = false;
            // Listeners see the completed score and the already-reset ball,
            // so phone state cannot briefly report a rally after a point.
            for (const result of results) {
                const announcement = result.kind === 'match' ? 'Game, set and match'
                    : result.kind[0].toUpperCase() + result.kind.slice(1);
                this.feedback(`${announcement} · Player ${result.player}${result.reason ? ` · ${pointReasonLabel(result.reason)}` : ''}`);
                this.onGameEvent(result);
            }
            return;
        }
        if (!this.practice.active && data.isWaitingForServe && this.botEnabled && data.servingPlayer === 'player2' &&
            data.serveDelayRemaining <= 0 && !this.player2.isSwinging) {
            this.swing({ label: 'Forehand', hand: 'Right', player: 2 });
        }
        if (!resetDuringStep) {
            this.checkRacketContact(this.player1, 1, pose1, previousBall);
            this.checkRacketContact(this.player2, 2, pose2, previousBall);
        }
        for (const [player, wasSwinging, number] of [
            [this.player1, swinging1, 1], [this.player2, swinging2, 2],
        ] as const) {
            player.hitbox?.updateDebug(this.showHitboxes, player.contactActive, player.hitConsumed);
            if (wasSwinging && !player.isSwinging && !player.hitConsumed) {
                if (data.waitingForRacketHit && data.servingPlayer === this.toBallPlayer(number)) {
                    this.reportStroke(number, 'miss', 'Service swing missed the ball');
                    const points: PointResult[] = [];
                    recordServeFault(this.ball, (winner, loser, reason) => {
                        const result = this.scoreSystem.awardPoint(winner, loser, reason);
                        const score = this.scoreSystem.getScore();
                        data.servingPlayer = score.server;
                        data.serviceSide = score.serviceSide;
                        if (result) points.push(result);
                    }, (_call, server) => {
                        this.feedback(`First fault · Player ${server}, second serve`);
                        this.onGameEvent({kind: 'fault', player: server, reason: 'missed-serve'});
                    });
                    this.clearPendingInputs('Service attempt ended');
                    this.setServerPosition();
                    for (const result of points) {
                        this.feedback(`Double fault · point to Player ${result.player}`);
                        this.onGameEvent(result);
                    }
                    return;
                }
                const reason = this.strokes[number - 1]?.reason ?? 'Racket did not reach the ball';
                this.feedback(`Player ${number}: ${reason}`);
                this.reportStroke(number, 'miss', reason);
            }
        }
    }

    private updatePlayer(player: PlayerController, input: PlayerInput, delta: number, number: 1 | 2): void {
        const swing = input.swing;
        input.swing = undefined;
        const assisted = this.autoPositionEnabled || (number === 2 && this.botEnabled);
        const trackingSpeed = number === 2 && this.botEnabled && this.settings.botDifficulty === 'beginner' ? .55 : AUTO_TRACKING_SPEED;
        const moveX = assisted
            ? lateralSteering(player.group.position.x, this.autoTargets[number - 1]) *
            trackingSpeed : input.moveX;
        const moveZ = assisted ? lateralSteering(player.group.position.z, this.autoDepths[number - 1]) * trackingSpeed : input.moveZ;
        if (player.isSwinging) {
            // Starting a phone stroke must not freeze an assisted player short
            // of the incoming ball. Keep ordinary bounded foot movement.
            if (assisted && !player.hitConsumed) player.move(moveX, moveZ, delta);
            return;
        }
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
            const serving = data.servingPlayer === this.toBallPlayer(number);
            const servicePhase = data.isWaitingForServe || data.waitingForRacketHit;
            const receiving = !serving && (servicePhase || data.serveReturnPending);
            const depth = this.practice.active ? TENNIS_COURT.rallyDepth : servicePhase && serving
                ? TENNIS_COURT.serveDepth : receiving ? TENNIS_COURT.receiveDepth : TENNIS_COURT.rallyDepth;
            this.autoDepths[number - 1] = (number === 1 ? 1 : -1) * depth;
            if (servicePhase && !this.practice.active) {
                const server = data.servingPlayer === 'player1' ? 1 : 2;
                target = serviceSign(server, data.serviceSide) * (serving ? 1.3 : -1.3);
            }
            if (!data.isWaitingForServe && !data.waitingForRacketHit) {
                const approaching = number === 1 ? data.velocity.z > 0 : data.velocity.z < 0;
                if (approaching && data.lastHitBy !== this.toBallPlayer(number)) {
                    let bestDistance = Infinity;
                    const pending = this.pendingSwings[number - 1];
                    const selected = pending ? this.swingAnimation(pending.backhand, pending.hand)
                        : player.isSwinging ? player.currentAnimation : null;
                    const preferred = selected && this.strikeOffset(player, selected, pending?.backhand ?? player.swingBackhand);
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
                (this.showHitboxes || this.practice.active);
            marker.position.set(target, 0.12, player.group.position.z);
        }
        this.shotTargetMarker.visible = this.hasShotTarget && (this.showHitboxes || this.practice.active) &&
            !(data.isWaitingForServe);
    }

    private updateBot(): void {
        const data = this.ball.userData as BallUserData;
        if (data.isWaitingForServe || data.waitingForRacketHit || data.lastHitBy !== 'player1') {
            this.botAttempted = false;
            return;
        }
        if (!this.botEnabled || this.botAttempted || this.player2.isSwinging || !this.player2.hitbox || this.simulationTime < this.botReadyAt) return;
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
        this.performSwing(stroke.backhand, 2, 'Right', false, this.settings.botDifficulty === 'beginner' ? .25 : .5);
        this.botAttempted = this.player2.isSwinging;
    }

    private swingAnimation(backhand: boolean, hand: 'Left' | 'Right'): string {
        return backhand !== (hand === 'Left') ? 'SwingLeft' : 'SwingRight';
    }

    private strikeOffset(player: PlayerController, animation: string, backhand: boolean): THREE.Vector3 | undefined {
        const poses = player.swingPoses[`${animation}:${backhand}`];
        const pose = poses?.[Math.round((poses.length - 1) * (backhand ? BACKHAND_PROGRESS : STRIKE_PROGRESS))];
        if (!pose || !player.hitbox) return player.strikeOffsets[animation];
        player.group.updateWorldMatrix(true, false);
        return player.hitbox.bounds.getCenter(new THREE.Vector3()).applyMatrix4(pose)
            .applyMatrix4(player.group.matrixWorld).sub(new THREE.Vector3().setFromMatrixPosition(player.group.matrixWorld));
    }

    private strokeIntercept(player: PlayerController, animation: string, number: 1 | 2, backhand: boolean) {
        const data = this.ball.userData as BallUserData;
        const offset = this.strikeOffset(player, animation, backhand);
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
                const reason = pending.remaining <= 0
                    ? pending.retryIn === undefined ? 'Too early' : 'Ball is out of reach'
                    : 'Point ended before racket contact';
                this.feedback(`Player ${number}: ${reason}`);
                this.reportStroke(number, 'miss', reason);
                continue;
            }
            const animation = this.swingAnimation(pending.backhand, pending.hand);
            const action = player.actions[animation];
            const intercept = this.strokeIntercept(player, animation, number, pending.backhand);
            if (!action || (intercept &&
                intercept.time > action.getClip().duration * (pending.backhand ? BACKHAND_PROGRESS : STRIKE_PROGRESS))) continue;
            pending.retryIn = (pending.retryIn ?? 0) - delta;
            if (pending.retryIn > 0) continue;
            // Movement can still be settling when the strike-plane timer fires.
            // Start when the authored path has a reachable contact, not merely
            // because one nominal animation progress has arrived.
            const start = this.assistedStartTime(player, animation, pending.backhand, number);
            if (start === null) { pending.retryIn = .025; continue; }
            this.pendingSwings[number - 1] = null;
            const trace = this.strokes[number - 1];
            if (trace) trace.reason = 'Racket did not reach the ball';
            this.performSwing(pending.backhand, number, pending.hand, true, pending.power, start);
        }
    }

    private assistedStartTime(player: PlayerController, animation: string, backhand: boolean, number: 1 | 2): number | null {
        const data = this.ball.userData as BallUserData;
        const poses = player.swingPoses[`${animation}:${backhand}`];
        const hitbox = player.hitbox;
        if (!poses || !hitbox || data.isWaitingForServe || data.waitingForRacketHit) return null;
        const duration = player.actions[animation].getClip().duration;
        const path = [this.ball.position.clone()];
        const playerX = [player.group.position.x];
        const playerZ = [player.group.position.z];
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
            const previousZ = playerZ[playerZ.length - 1];
            const mx = this.autoPositionEnabled ? lateralSteering(previousX, this.autoTargets[number - 1]) * AUTO_TRACKING_SPEED : 0;
            const mz = this.autoPositionEnabled ? lateralSteering(previousZ, this.autoDepths[number - 1]) * AUTO_TRACKING_SPEED : 0;
            const scale = player.movementSpeed / (120 * Math.max(1, Math.hypot(mx, mz)));
            playerX.push(previousX + mx * scale);
            playerZ.push(previousZ + mz * scale);
        }
        player.group.updateWorldMatrix(true, false);
        // Decode the 21 cached poses once. Doing this inside both sides of every
        // candidate sweep created thousands of short-lived vectors and matrices
        // on the same main thread that receives input and draws the court.
        const frames = poses.map(pose => {
            const position = new THREE.Vector3(), rotation = new THREE.Quaternion(), scale = new THREE.Vector3();
            pose.decompose(position, rotation, scale);
            return {position, rotation, scale};
        });
        const position = new THREE.Vector3(), scale = new THREE.Vector3(), rotation = new THREE.Quaternion();
        const transform = new THREE.Matrix4();
        const previousRacket = new THREE.Matrix4(), nextRacket = new THREE.Matrix4();
        const poseAt = (progress: number, step: number, target: THREE.Matrix4) => {
            const index = Math.min(19, Math.floor(progress * 20));
            const fraction = progress * 20 - index;
            const from = frames[index], to = frames[index + 1];
            position.copy(from.position).lerp(to.position, fraction);
            rotation.copy(from.rotation).slerp(to.rotation, fraction);
            scale.copy(from.scale).lerp(to.scale, fraction);
            transform.copy(player.group.matrixWorld);
            transform.elements[12] += playerX[step] - player.group.position.x;
            transform.elements[14] += playerZ[step] - player.group.position.z;
            return target.compose(position, rotation, scale).premultiply(transform);
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
                    sweptRacketContact(hitbox.bounds, poseAt(before, step - 1, previousRacket), poseAt(after, step, nextRacket),
                        path[step - 1], path[step], BALL_RADIUS)) contactSteps++;
            }
            if (contactSteps > mostContactSteps) {
                mostContactSteps = contactSteps;
                bestStart = start * duration;
            }
        }
        return mostContactSteps > 0 ? bestStart : null;
    }

    private performSwing(isBackhand: boolean, number: 1 | 2, hand: 'Left' | 'Right' = 'Right',
        assistTiming = false, power = 0.5, plannedStart?: number): void {
        const player = number === 1 ? this.player1 : this.player2;
        if (player.isSwinging) return;
        const animation = this.swingAnimation(isBackhand, hand);
        if (!player.actions[animation] || !player.hitbox) {
            this.feedback('Player/racket still loading or missing swing animation');
            return;
        }
        player.swingBackhand = isBackhand;
        this.swingPowers[number - 1] = power;
        player.playAnimation(animation);
        this.updateAutoTargets();
        // Avoid adding a full wind-up after the phone's physical stroke. This
        // advances only the animation, never the ball or the contact result.
        if (assistTiming && this.settings.timingAssist) {
            const action = player.actions[animation];
            const heldServe = (this.ball.userData as BallUserData).waitingForRacketHit;
            const data = this.ball.userData as BallUserData;
            const incoming = data.lastHitBy !== this.toBallPlayer(number) &&
                (number === 1 ? data.velocity.z > 0 : data.velocity.z < 0);
            // A cached strike plane is only one point along the racket path.
            // Keep checking the full authored path while the ball is incoming,
            // including a slightly late input that can still physically meet it.
            if (incoming || heldServe) {
                action.stopFading();
                action.setEffectiveWeight(1);
                // The real phone swing already happened. Skip only the serve
                // wind-up; the ball must still cross the authored racket path.
                action.time = heldServe ? action.getClip().duration * 0.2
                    : plannedStart ?? this.assistedStartTime(player, animation, isBackhand, number) ?? 0;
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
        if ((data.isWaitingForServe || data.waitingForRacketHit) &&
            (data.serveDelayRemaining > 0 || data.servingPlayer !== id)) return;
        if (!data.isWaitingForServe && !data.waitingForRacketHit && data.lastHitBy === id) return;
        if (data.waitingForRacketHit && data.lastHitBy && data.lastHitBy !== id) return;
        if (!sweptRacketContact(hitbox.bounds, previousPose, hitbox.pose(),
            previousBall, this.ball.position, BALL_RADIUS)) return;
        if (data.isServeFlight && data.servingPlayer !== id && data.bounceCount === 0) {
            if (data.netTouched) {
                data.serveStatus = 'let';
                prepareServe(this.ball);
                this.reportStroke(number, 'rejected', 'Let · serve touched the net');
                this.clearPendingInputs();
                this.setServerPosition();
                const server = data.servingPlayer === 'player1' ? 1 : 2;
                this.feedback(`Let · Player ${server} repeats serve ${data.serveAttempt}`);
                this.onGameEvent({kind: 'let', player: server, reason: 'net-touch-receiver'});
                return;
            }
            const winner = data.servingPlayer;
            let result: PointResult | null = null;
            finishPoint(this.ball, winner, 'serve-volley', (pointWinner, loser, reason) => {
                result = this.scoreSystem.awardPoint(pointWinner, loser, reason);
                const score = this.scoreSystem.getScore();
                data.servingPlayer = score.server;
                data.serviceSide = score.serviceSide;
            });
            this.reportStroke(number, 'rejected', 'Let the serve bounce before returning');
            this.clearPendingInputs();
            this.setServerPosition();
            this.feedback('Serve returned before its bounce · point to the server');
            if (result) this.onGameEvent(result);
            return;
        }
        const serving = data.waitingForRacketHit || data.isWaitingForServe;
        const plan = planCourtShot(this.ball.position, number, player.swingBackhand, data.gravity,
            this.swingPowers[number - 1], {timing: this.swingTimings[number - 1],
                ...(serving ? {serve: data.serviceSide} : {}), beginner: this.settings.assistance === 'beginner'});
        if (!plan) {
            player.hitConsumed = true;
            player.contactActive = false;
            this.feedback(`Player ${number}: Contact was too low or outside the playable court`);
            this.reportStroke(number, 'miss', 'Contact outside the playable court');
            return;
        }
        hitBall(this.ball, plan.velocity, id, serving);
        this.hasShotTarget = true;
        this.shotTargetMarker.position.set(plan.target.x, 0.08, plan.target.z);
        this.shotTargetMarker.visible = this.showHitboxes;
        player.hitConsumed = true;
        player.contactActive = false;
        const placement = Math.abs(plan.target.x) < .5 ? 'center' : plan.target.x * (number === 1 ? 1 : -1) < 0 ? 'left' : 'right';
        this.feedback(`Player ${number}: Hit! · ${serving ? 'serve' : placement}`);
        const swingId = this.strokes[number - 1]?.id;
        this.reportStroke(number, 'hit', serving ? 'Serve contact' : 'Racket contact');
        if (this.practice.active && number === 1 && !this.practiceReturned) {
            this.practiceReturned = true;
            this.practice.returns++;
            this.practice.streak++;
            this.practice.bestStreak = Math.max(this.practice.bestStreak, this.practice.streak);
        }
        this.botReadyAt = this.simulationTime + (this.settings.botDifficulty === 'beginner' ? .28 : .08);
        this.onHit(number);
        this.onGameEvent({ kind: serving ? 'serve' : 'hit', player: number, ...(swingId ? {swingId} : {}) });
    }

    private toBallPlayer(playerNumber: 1 | 2): BallPlayer {
        return playerNumber === 1 ? 'player1' : 'player2';
    }

    private feedback(message: string): void {
        this.getSwingFeedback()(message);
    }
}
