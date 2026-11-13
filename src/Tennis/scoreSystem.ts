import type { BallPlayer } from './components/ball';
import type { PointReason, ServiceSide } from './tennisRules';

/** `quick` is accepted from older controllers and normalized to best of three. */
export type MatchFormat = 'full' | 'quick';

export interface CompletedSet {
    player1: number;
    player2: number;
}

export interface TennisScoreCheckpoint {
    version: 1;
    points: [number, number];
    sets: CompletedSet[];
}

export interface Score {
    player1: number;
    player2: number;
    targetPoints: 7;
    setsToWin: 2;
    setsPlayer1: number;
    setsPlayer2: number;
    server: BallPlayer;
    matchWinner: BallPlayer | null;
    completedSets: CompletedSet[];
    lastPoint: PointResult | null;
    format: MatchFormat;
    serviceSide: ServiceSide;
}

export interface PointResult {
    kind: 'point' | 'set' | 'match';
    player: 1 | 2;
    reason?: PointReason;
}

export function determinePointWinner(
    firstBounceInBounds: boolean,
    lastHitBy: BallPlayer | undefined,
    ballZ: number,
): BallPlayer {
    if (firstBounceInBounds) {
        return lastHitBy ?? (ballZ > 0 ? 'player2' : 'player1');
    }
    if (lastHitBy) {
        return lastHitBy === 'player1' ? 'player2' : 'player1';
    }
    return ballZ > 0 ? 'player2' : 'player1';
}

const opponent = (player: BallPlayer): BallPlayer => player === 'player1' ? 'player2' : 'player1';

/** Best of three sets. Every rally is one point; seven points by two wins a set.
 * Service follows a short tie-break: one serve, then two each; set starters alternate. */
export class ScoreSystem {
    private points = { player1: 0, player2: 0 };
    private sets = { player1: 0, player2: 0 };
    private server: BallPlayer = 'player1';
    private setStarter: BallPlayer = 'player1';
    private matchWinner: BallPlayer | null = null;
    private completedSets: CompletedSet[] = [];
    private lastPoint: PointResult | null = null;

    public constructor(_format: MatchFormat = 'full') {}

    public get isComplete(): boolean {
        return this.matchWinner !== null;
    }

    public checkpoint(): TennisScoreCheckpoint {
        return {version: 1, points: [this.points.player1, this.points.player2], sets: this.completedSets.map(set => ({...set}))};
    }

    public static fromCheckpoint(value: unknown): ScoreSystem {
        const data = value as TennisScoreCheckpoint;
        const point = (n: number) => Number.isSafeInteger(n) && n >= 0 && n <= 10000;
        const finished = (a: number, b: number) => Math.max(a, b) >= 7 && Math.abs(a - b) >= 2;
        if (!data || data.version !== 1 || !Array.isArray(data.points) || data.points.length !== 2 || !data.points.every(point) ||
            !Array.isArray(data.sets) || data.sets.length > 3) throw new Error('Invalid tennis score');
        const score = new ScoreSystem();
        for (const set of data.sets) {
            if (score.matchWinner || !set || !point(set.player1) || !point(set.player2) || !finished(set.player1, set.player2) ||
                (Math.min(set.player1, set.player2) < 6 ? Math.max(set.player1, set.player2) !== 7 : Math.abs(set.player1 - set.player2) !== 2)) throw new Error('Invalid tennis set');
            const winner = set.player1 > set.player2 ? 'player1' : 'player2';
            score.sets[winner]++;
            score.completedSets.push({...set});
            if (score.sets[winner] === 2) score.matchWinner = winner;
        }
        const final = data.sets.at(-1);
        if (score.matchWinner ? !final || final.player1 !== data.points[0] || final.player2 !== data.points[1]
            : finished(...data.points)) throw new Error('Invalid tennis point boundary');
        score.points = {player1: data.points[0], player2: data.points[1]};
        const setIndex = data.sets.length - (score.matchWinner ? 1 : 0);
        score.setStarter = setIndex % 2 === 0 ? 'player1' : 'player2';
        const played = data.points[0] + data.points[1] - (score.matchWinner ? 1 : 0);
        score.server = Math.floor((played + 1) / 2) % 2 === 0 ? score.setStarter : opponent(score.setStarter);
        return score;
    }

    public getScore(): Score {
        return {
            player1: this.points.player1,
            player2: this.points.player2,
            targetPoints: 7,
            setsToWin: 2,
            setsPlayer1: this.sets.player1,
            setsPlayer2: this.sets.player2,
            server: this.server,
            matchWinner: this.matchWinner,
            completedSets: this.completedSets.map(set => ({ ...set })),
            lastPoint: this.lastPoint && { ...this.lastPoint },
            format: 'full',
            serviceSide: (this.points.player1 + this.points.player2) % 2 === 0 ? 'deuce' : 'ad',
        };
    }

    public awardPoint(winner: BallPlayer, loser: BallPlayer, reason?: PointReason): PointResult | null {
        if (this.matchWinner || winner === loser) return null;
        this.points[winner]++;
        let kind: PointResult['kind'] = 'point';
        if (this.points[winner] >= 7 && this.points[winner] - this.points[loser] >= 2) {
            this.sets[winner]++;
            this.completedSets.push({...this.points});
            if (this.sets[winner] === 2) {
                this.matchWinner = winner;
                kind = 'match';
            } else {
                this.points = {player1: 0, player2: 0};
                this.setStarter = opponent(this.setStarter);
                this.server = this.setStarter;
                kind = 'set';
            }
        } else {
            const played = this.points.player1 + this.points.player2;
            this.server = Math.floor((played + 1) / 2) % 2 === 0
                ? this.setStarter : opponent(this.setStarter);
        }
        this.lastPoint = {kind, player: winner === 'player1' ? 1 : 2, ...(reason ? {reason} : {})};
        return {...this.lastPoint};
    }

    public reset(_format: MatchFormat = 'full'): void {
        this.points = {player1: 0, player2: 0};
        this.sets = {player1: 0, player2: 0};
        this.server = 'player1';
        this.setStarter = 'player1';
        this.matchWinner = null;
        this.completedSets = [];
        this.lastPoint = null;
    }
}
