import { describe, expect, test } from 'vitest';
import { ScoreSystem, type PointResult } from '../src/Tennis/scoreSystem';
import type { BallPlayer } from '../src/Tennis/components/ball';

function point(score: ScoreSystem, winner: BallPlayer): PointResult | null {
    return score.awardPoint(winner, winner === 'player1' ? 'player2' : 'player1');
}
function game(score: ScoreSystem, winner: BallPlayer): PointResult | null {
    let result: PointResult | null = null;
    for (let i = 0; i < 4; i++) result = point(score, winner);
    return result;
}
function reachTieBreak(score: ScoreSystem): void {
    for (let i = 0; i < 6; i++) {
        game(score, 'player1');
        game(score, 'player2');
    }
}

describe('standard tennis scoring', () => {
    test('a server keeps the whole game, including deuce and repeated advantage reversals', () => {
        const score = new ScoreSystem();
        for (const display of [15, 30, 40]) {
            point(score, 'player1');
            expect(score.getScore().player1).toBe(display);
            point(score, 'player2');
            expect(score.getScore().server).toBe('player1');
        }
        for (const winner of ['player1', 'player2', 'player1'] as const) {
            point(score, winner);
            expect(score.getScore()[winner]).toBe('Adv');
            point(score, winner === 'player1' ? 'player2' : 'player1');
            expect(score.getScore()).toMatchObject({ player1: 40, player2: 40, server: 'player1' });
        }
        point(score, 'player2');
        expect(point(score, 'player2')).toEqual({ kind: 'game', player: 2 });
        expect(score.getScore()).toMatchObject({ player1: 0, player2: 0, roundsPlayer2: 1, server: 'player2' });
    });

    test('6–0 completes a set and 5–5 needs 7–5', () => {
        const straight = new ScoreSystem();
        for (let i = 0; i < 5; i++) game(straight, 'player1');
        expect(game(straight, 'player1')).toEqual({ kind: 'set', player: 1 });
        expect(straight.getScore()).toMatchObject({
            setsPlayer1: 1, roundsPlayer1: 0, roundsPlayer2: 0,
            completedSets: [{ player1: 6, player2: 0 }], server: 'player1',
        });
        const close = new ScoreSystem();
        for (let i = 0; i < 5; i++) { game(close, 'player1'); game(close, 'player2'); }
        expect(game(close, 'player1')?.kind).toBe('game');
        expect(close.getScore()).toMatchObject({ roundsPlayer1: 6, roundsPlayer2: 5, setsPlayer1: 0 });
        expect(game(close, 'player1')?.kind).toBe('set');
        expect(close.getScore().completedSets).toEqual([{ player1: 7, player2: 5 }]);
    });

    test('tie-break uses numeric points and one then two serves, including beyond 6–6', () => {
        const score = new ScoreSystem();
        reachTieBreak(score);
        expect(score.getScore()).toMatchObject({ roundsPlayer1: 6, roundsPlayer2: 6, tieBreak: true, server: 'player1' });
        const expectedServers = ['player2', 'player2', 'player1', 'player1', 'player2', 'player2'];
        for (let i = 0; i < 12; i++) {
            point(score, i % 2 === 0 ? 'player1' : 'player2');
            expect(score.getScore().server).toBe(expectedServers[i % 4]);
        }
        expect(score.getScore()).toMatchObject({ player1: 6, player2: 6, setsPlayer1: 0 });
        expect(point(score, 'player1')?.kind).toBe('point');
        expect(score.getScore()).toMatchObject({ player1: 7, player2: 6, tieBreak: true });
        expect(point(score, 'player1')?.kind).toBe('set');
        expect(score.getScore()).toMatchObject({
            tieBreak: false, setsPlayer1: 1, server: 'player2',
            player1: 0, player2: 0, completedSets: [{ player1: 7, player2: 6 }],
        });
        // It is the tie-break's first server who receives next, not its winner.
        reachTieBreak(score);
        expect(score.getScore().server).toBe('player2');
        for (let i = 0; i < 7; i++) point(score, 'player2');
        expect(score.getScore()).toMatchObject({ setsPlayer2: 1, server: 'player1', matchWinner: null });
    });

    test('best of three ends at two sets, remains frozen, and resets for a rematch', () => {
        const score = new ScoreSystem();
        for (let i = 0; i < 6; i++) game(score, 'player2');
        expect(score.isComplete).toBe(false);
        for (let i = 0; i < 5; i++) game(score, 'player2');
        expect(game(score, 'player2')).toEqual({ kind: 'match', player: 2 });
        expect(score.isComplete).toBe(true);
        expect(score.getScore()).toMatchObject({ setsPlayer2: 2, matchWinner: 'player2' });
        const final = score.getScore();
        expect(point(score, 'player1')).toBeNull();
        expect(score.getScore()).toEqual(final);
        final.completedSets[0].player1 = 99;
        expect(score.getScore().completedSets[0].player1).toBe(0);
        score.reset();
        expect(score.isComplete).toBe(false);
        expect(score.getScore()).toMatchObject({
            player1: 0, player2: 0, roundsPlayer1: 0, roundsPlayer2: 0,
            setsPlayer1: 0, setsPlayer2: 0, matchWinner: null,
            server: 'player1', completedSets: [], lastPoint: null,
        });
    });
});
