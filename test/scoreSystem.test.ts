import {describe, expect, test} from 'vitest';
import {ScoreSystem} from '../src/Tennis/scoreSystem';
import type {BallPlayer} from '../src/Tennis/components/ball';
const point = (score: ScoreSystem, winner: BallPlayer) => score.awardPoint(winner, winner === 'player1' ? 'player2' : 'player1');
const straightSet = (score: ScoreSystem, winner: BallPlayer) => {for (let i = 0; i < 6; i++) point(score, winner); return point(score, winner);};

test('tennis recovery preserves points, sets, serving side and service order through a deciding set', () => {
    let score = new ScoreSystem();
    const sequence: BallPlayer[] = [...Array(7).fill('player2'), ...Array(7).fill('player1'),
        ...Array.from({length:12}, (_,i) => i%2 ? 'player2' : 'player1'), 'player2','player2'];
    for (const winner of sequence) {
        point(score,winner);
        const before = score.getScore();
        score = ScoreSystem.fromCheckpoint(score.checkpoint());
        expect(score.getScore()).toMatchObject({...before,lastPoint:null});
    }
    expect(score.getScore().matchWinner).toBe('player2');
});

test('tennis recovery rejects unfinished sets, impossible final points and play after a winner', () => {
    const bad = [
        {version:1,points:[7,0],sets:[]}, {version:1,points:[0,0],sets:[{player1:7,player2:6}]},
        {version:1,points:[0,0],sets:[{player1:8,player2:0}]},
        {version:1,points:[0,0],sets:[{player1:7,player2:0},{player1:7,player2:0}]},
        {version:1,points:[0,7],sets:[{player1:7,player2:0},{player1:7,player2:0},{player1:0,player2:7}]},
    ];
    for (const payload of bad) expect(() => ScoreSystem.fromCheckpoint(payload)).toThrow();
});

describe('best of three seven-point tennis sets', () => {
    test('each rally is one point, and service follows one then two with alternating service sides', () => {
        const score = new ScoreSystem();
        const expectedServers = ['player2', 'player2', 'player1', 'player1', 'player2', 'player2'];
        for (let i = 0; i < 6; i++) {
            expect(point(score, 'player1')).toEqual({kind: 'point', player: 1});
            expect(score.getScore()).toMatchObject({player1: i + 1, player2: 0, server: expectedServers[i], serviceSide: i % 2 ? 'deuce' : 'ad'});
        }
        expect(point(score, 'player1')).toEqual({kind: 'set', player: 1});
        expect(score.getScore()).toMatchObject({player1: 0, player2: 0, setsPlayer1: 1, server: 'player2', completedSets: [{player1: 7, player2: 0}]});
    });
    test('6–6 continues past 7–6 until there is a two-point lead, with no cap', () => {
        const score = new ScoreSystem();
        for (let i = 0; i < 6; i++) {point(score, 'player1'); point(score, 'player2');}
        for (let i = 7; i <= 22; i++) {
            expect(point(score, 'player1')?.kind).toBe('point');
            expect(score.getScore()).toMatchObject({player1: i, player2: i - 1, setsPlayer1: 0});
            expect(point(score, 'player2')?.kind).toBe('point');
        }
        point(score, 'player2');
        expect(point(score, 'player2')).toEqual({kind: 'set', player: 2});
        expect(score.getScore().completedSets).toEqual([{player1: 22, player2: 24}]);
    });
    test('two straight sets end the match at 2–0, retain final points, freeze, and reset', () => {
        const score = new ScoreSystem('quick');
        expect(straightSet(score, 'player2')?.kind).toBe('set');
        expect(score.isComplete).toBe(false);
        expect(straightSet(score, 'player2')).toEqual({kind: 'match', player: 2});
        expect(score.getScore()).toMatchObject({player1: 0, player2: 7, setsPlayer2: 2, matchWinner: 'player2', targetPoints: 7, setsToWin: 2, format: 'full'});
        const final = score.getScore();
        expect(point(score, 'player1')).toBeNull();
        expect(score.getScore()).toEqual(final);
        final.completedSets[0].player1 = 99;
        expect(score.getScore().completedSets[0].player1).toBe(0);
        score.reset('quick');
        expect(score.getScore()).toMatchObject({player1: 0, player2: 0, setsPlayer1: 0, setsPlayer2: 0, server: 'player1', completedSets: [], lastPoint: null, matchWinner: null});
    });
    test('split sets require a deciding third, with its starter independent of set winners', () => {
        const score = new ScoreSystem();
        straightSet(score, 'player2');
        expect(score.getScore().server).toBe('player2');
        straightSet(score, 'player1');
        expect(score.getScore()).toMatchObject({setsPlayer1: 1, setsPlayer2: 1, server: 'player1'});
        for (let i = 0; i < 6; i++) {point(score, 'player1'); point(score, 'player2');}
        point(score, 'player1');
        expect(point(score, 'player1')?.kind).toBe('match');
        expect(score.getScore()).toMatchObject({setsPlayer1: 2, setsPlayer2: 1, completedSets: [{player1: 0, player2: 7}, {player1: 7, player2: 0}, {player1: 8, player2: 6}]});
        expect(point(score, 'player2')).toBeNull();
        expect(score.getScore().completedSets).toHaveLength(3);
    });
});
