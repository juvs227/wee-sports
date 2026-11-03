import {describe, expect, it} from 'vitest';
import {BowlingMatch, FULL_RACK, formatFrame, scoreFrames} from '../src/bowling/match';

function bowl(match: BowlingMatch, pins: number) {
  return match.record(match.getState().pinsStanding.slice(pins));
}
function toTenth(match: BowlingMatch) {
  for (let frame = 0; frame < 9; frame++) { bowl(match, 0); bowl(match, 0); }
}

describe('ten-pin match rules', () => {
  it.each([
    {rolls: [0, 10], frame: 0, marks: '–  /'},
    {rolls: [10, 0, 10], frame: 9, marks: 'X  –  /'},
    {rolls: [10, 10, 10], frame: 9, marks: 'X  X  X'},
    {rolls: [6, 4, 10], frame: 9, marks: '6  /  X'},
    {rolls: [10, 7, 3], frame: 9, marks: 'X  7  /'},
    {rolls: [10, 10, 0], frame: 9, marks: 'X  X  –'},
    {rolls: [0, 0], frame: 0, marks: '–  –'},
    {rolls: [], frame: 0, marks: ''},
  ])('formats scorecard $rolls in frame $frame as $marks', ({rolls, frame, marks}) => {
    expect(formatFrame(rolls, frame)).toBe(marks);
  });

  it('scores twelve strikes as 300, with one tenth frame and no thirteenth ball', () => {
    const match = new BowlingMatch([{player: 1, name: 'Ace'}]);
    for (let ball = 0; ball < 12; ball++) bowl(match, 10);
    expect(match.getState().players[0].total).toBe(300);
    expect(match.getState().players[0].frames[9]).toEqual([10, 10, 10]);
    expect(match.getState().complete).toBe(true);
    expect(() => bowl(match, 0)).toThrow('complete');
  });

  it('scores all five-pin spares as 150, only after the final fill ball', () => {
    const match = new BowlingMatch([{player: 1, name: 'Spare'}]);
    for (let ball = 0; ball < 20; ball++) bowl(match, 5);
    expect(match.getState().complete).toBe(false);
    expect(match.getState().players[0].frameScores[9]).toBeNull();
    bowl(match, 5);
    expect(match.getState().players[0].total).toBe(150);
  });

  it('scores gutter games as zero and advances four players by whole frames', () => {
    const match = new BowlingMatch([1, 2, 3, 4].map(player => ({player, name: `P${player}`})));
    for (let frame = 1; frame <= 10; frame++) {
      for (let player = 1; player <= 4; player++) {
        expect(match.getState()).toMatchObject({frame, currentPlayer: player, ball: 1});
        bowl(match, 0);
        expect(match.getState()).toMatchObject({currentPlayer: player, ball: 2});
        bowl(match, 0);
      }
    }
    expect(match.getState().complete).toBe(true);
    expect(match.getState().ranking.map(p => p.rank)).toEqual([1, 1, 1, 1]);
    expect(match.getState().players.every(p => p.total === 0)).toBe(true);
  });

  it('does not respot standing pins before a spare attempt', () => {
    const match = new BowlingMatch([{player: 1, name: 'Split'}]);
    expect(match.record([7, 10]).resetRack).toBe(false);
    expect(match.getState().pinsStanding).toEqual([7, 10]);
    const spare = match.record([]);
    expect(spare).toMatchObject({resetRack: true, result: {spare: true, pins: 2}});
    expect(match.getState().pinsStanding).toEqual(FULL_RACK);
    bowl(match, 3);
    expect(match.getState().players[0].frameScores[0]).toBe(13);
  });

  it('keeps the remaining pins for the third ball after tenth-frame X 7', () => {
    const match = new BowlingMatch([{player: 1, name: 'Ten'}]);
    toTenth(match);
    expect(bowl(match, 10).resetRack).toBe(true);
    expect(bowl(match, 7).resetRack).toBe(false);
    expect(match.getState().pinsStanding).toHaveLength(3);
    bowl(match, 3);
    expect(match.getState().players[0].total).toBe(20);
    expect(match.getState().complete).toBe(true);
  });

  it('awards a fresh rack after a tenth-frame spare, without bonus-of-bonus scoring', () => {
    const match = new BowlingMatch([{player: 1, name: 'Ten'}]);
    toTenth(match);
    expect(bowl(match, 6).resetRack).toBe(false);
    expect(bowl(match, 4).resetRack).toBe(true);
    bowl(match, 10);
    expect(match.getState().players[0].total).toBe(20);
    expect(match.getState().complete).toBe(true);
  });

  it('tenth-frame open stops at two deliveries and no zero-pin false rerack occurs', () => {
    const match = new BowlingMatch([{player: 1, name: 'Ten'}]);
    toTenth(match);
    expect(bowl(match, 0).resetRack).toBe(false);
    bowl(match, 9);
    expect(match.getState().players[0].total).toBe(9);
    expect(match.getState().complete).toBe(true);
  });

  it('labels a gutter followed by ten as a spare, including tenth-frame fills', () => {
    const match = new BowlingMatch([{player: 1, name: 'Spare'}]);
    bowl(match, 0);
    expect(bowl(match, 10).result).toMatchObject({strike: false, spare: true});
    for (let frame = 1; frame < 9; frame++) { bowl(match, 0); bowl(match, 0); }
    bowl(match, 10); bowl(match, 0);
    expect(bowl(match, 10).result).toMatchObject({strike: false, spare: true});
    expect(match.getState().complete).toBe(true);
  });

  it('holds strike bonuses pending and scores across the ninth/tenth boundary', () => {
    expect(scoreFrames([[10]])[0]).toBeNull();
    expect(scoreFrames([[10], [3]])[0]).toBeNull();
    expect(scoreFrames([[10], [3, 4]])).toEqual([17, 24, null, null, null, null, null, null, null, null]);
    const frames = Array.from({length: 8}, () => [0, 0]);
    frames.push([10], [10, 7, 2]);
    expect(scoreFrames(frames).slice(8)).toEqual([27, 46]);
  });

  it('ranks players independently and keeps fill deliveries on the tenth-frame player', () => {
    const match = new BowlingMatch([{player: 1, name: 'First'}, {player: 2, name: 'Second'}]);
    for (let frame = 0; frame < 9; frame++) {
      bowl(match, 0); bowl(match, 0); bowl(match, 0); bowl(match, 0);
    }
    bowl(match, 10); bowl(match, 10);
    expect(match.getState().currentPlayer).toBe(1);
    bowl(match, 10);
    expect(match.getState().currentPlayer).toBe(2);
    bowl(match, 4); bowl(match, 3);
    expect(match.getState().ranking).toEqual([
      {player: 1, name: 'First', total: 30, rank: 1},
      {player: 2, name: 'Second', total: 7, rank: 2},
    ]);
  });

  it('rejects impossible pinfall and returns copies that cannot mutate the match', () => {
    const match = new BowlingMatch([{player: 1, name: 'Player'}]);
    match.record([7, 10]);
    expect(() => match.record([1])).toThrow('cannot add');
    expect(() => match.record([7, 7])).toThrow('cannot add');
    const copy = match.getState();
    copy.pinsStanding.length = 0;
    copy.players[0].frames[0].push(10);
    expect(match.getState().pinsStanding).toEqual([7, 10]);
    expect(match.getState().players[0].frames[0]).toEqual([8]);
  });
});
