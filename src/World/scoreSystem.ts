import type { BallPlayer } from './components/ball';
import type { TennisScore } from '../scoreRenderer';

export interface Score {
    player1: TennisScore;
    player2: TennisScore;
    roundsPlayer1: number;
    roundsPlayer2: number;
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
    private score: Score = {
        player1: 0,
        player2: 0,
        roundsPlayer1: 0,
        roundsPlayer2: 0,
    };

    public getScore(): Score {
        return { ...this.score };
    }

    public awardPoint(winner: BallPlayer, loser: BallPlayer): void {
        const winnerScore = this.score[winner];
        const loserScore = this.score[loser];

        if (loserScore === 'Adv') {
            this.score[loser] = 40;
        } else if (winnerScore === 'Adv') {
            this.completeRound(winner);
        } else if (winnerScore === 40 && loserScore === 40) {
            this.score[winner] = 'Adv';
        } else if (winnerScore === 40) {
            this.completeRound(winner);
        } else {
            this.score[winner] = nextTennisScore(winnerScore);
        }
        console.log(`[SCORE] ${winner} scored; ${loser} lost the point. Current Score -> ` +
            `Player 1: ${this.score.player1} | Player 2: ${this.score.player2}`);
    }

    public reset(): void {
        this.score = {
            player1: 0,
            player2: 0,
            roundsPlayer1: 0,
            roundsPlayer2: 0,
        };
    }

    private completeRound(winner: BallPlayer): void {
        this.score[winner] = 'Win';
        if (winner === 'player1') this.score.roundsPlayer1++;
        else this.score.roundsPlayer2++;
        this.score.player1 = 0;
        this.score.player2 = 0;
    }
}

function nextTennisScore(score: TennisScore): TennisScore {
    if (score === 0) return 15;
    if (score === 15) return 30;
    return 40;
}
