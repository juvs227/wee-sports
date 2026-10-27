import type { BallPlayer } from './components/ball';

export interface Score {
    player1: number;
    player2: number;
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

export class ScoreSystem {
    private score: Score = { player1: 0, player2: 0 };

    public getScore(): Score {
        return { ...this.score };
    }

    public awardPoint(winner: BallPlayer): void {
        this.score[winner]++;
        console.log(`[SCORE] ${winner} scored! Current Score -> Player 1: ${
            this.score.player1} | Player 2: ${this.score.player2}`);
    }

    public reset(): void {
        this.score = { player1: 0, player2: 0 };
    }
}
