import type { BallPlayer } from './components/ball';

export interface CompletedSet {
    player1: number;
    player2: number;
}

export interface Score {
    player1: number | 'Adv';
    player2: number | 'Adv';
    /** Games in the current set; retained for the existing scoreboard. */
    roundsPlayer1: number;
    roundsPlayer2: number;
    setsPlayer1: number;
    setsPlayer2: number;
    server: BallPlayer;
    tieBreak: boolean;
    matchWinner: BallPlayer | null;
    completedSets: CompletedSet[];
    lastPoint: PointResult | null;
}

export interface PointResult {
    kind: 'point' | 'game' | 'set' | 'match';
    player: 1 | 2;
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

/** Best of three tie-break sets: advantage games, six games by two, tie-break at 6–6. */
export class ScoreSystem {
    private points = { player1: 0, player2: 0 };
    private games = { player1: 0, player2: 0 };
    private sets = { player1: 0, player2: 0 };
    private server: BallPlayer = 'player1';
    private tieBreak = false;
    private tieBreakStarter: BallPlayer = 'player1';
    private matchWinner: BallPlayer | null = null;
    private completedSets: CompletedSet[] = [];
    private lastPoint: PointResult | null = null;

    public get isComplete(): boolean {
        return this.matchWinner !== null;
    }

    public getScore(): Score {
        return {
            player1: this.displayPoints('player1'),
            player2: this.displayPoints('player2'),
            roundsPlayer1: this.games.player1,
            roundsPlayer2: this.games.player2,
            setsPlayer1: this.sets.player1,
            setsPlayer2: this.sets.player2,
            server: this.server,
            tieBreak: this.tieBreak,
            matchWinner: this.matchWinner,
            completedSets: this.completedSets.map(set => ({ ...set })),
            lastPoint: this.lastPoint && { ...this.lastPoint },
        };
    }

    public awardPoint(winner: BallPlayer, loser: BallPlayer): PointResult | null {
        if (this.matchWinner || winner === loser) return null;
        this.points[winner]++;
        let kind: PointResult['kind'] = 'point';
        const target = this.tieBreak ? 7 : 4;
        if (this.points[winner] >= target && this.points[winner] - this.points[loser] >= 2) {
            kind = this.completeGame(winner);
        } else if (this.tieBreak) {
            // First server plays one point, then each player serves two points.
            const played = this.points.player1 + this.points.player2;
            this.server = Math.floor((played + 1) / 2) % 2 === 0
                ? this.tieBreakStarter : opponent(this.tieBreakStarter);
        }
        this.lastPoint = { kind, player: winner === 'player1' ? 1 : 2 };
        return { ...this.lastPoint };
    }

    public reset(): void {
        this.points = { player1: 0, player2: 0 };
        this.games = { player1: 0, player2: 0 };
        this.sets = { player1: 0, player2: 0 };
        this.server = 'player1';
        this.tieBreakStarter = 'player1';
        this.tieBreak = false;
        this.matchWinner = null;
        this.completedSets = [];
        this.lastPoint = null;
    }

    private displayPoints(player: BallPlayer): number | 'Adv' {
        if (this.tieBreak) return this.points[player];
        if (this.points.player1 >= 3 && this.points.player2 >= 3) {
            return this.points[player] > this.points[opponent(player)] ? 'Adv' : 40;
        }
        return [0, 15, 30, 40][Math.min(3, this.points[player])];
    }

    private completeGame(winner: BallPlayer): PointResult['kind'] {
        this.games[winner]++;
        this.points = { player1: 0, player2: 0 };
        // A tie-break's first server receives in the first game of the next set.
        this.server = opponent(this.tieBreak ? this.tieBreakStarter : this.server);
        if (this.tieBreak || (this.games[winner] >= 6 && this.games[winner] - this.games[opponent(winner)] >= 2)) {
            this.sets[winner]++;
            this.completedSets.push({ ...this.games });
            this.tieBreak = false;
            if (this.sets[winner] === 2) {
                this.matchWinner = winner;
                return 'match';
            }
            this.games = { player1: 0, player2: 0 };
            return 'set';
        }
        if (this.games.player1 === 6 && this.games.player2 === 6) {
            this.tieBreak = true;
            this.tieBreakStarter = this.server;
        }
        return 'game';
    }
}
