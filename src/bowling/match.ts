/** Ten-pin scoring follows USBC Rule 2, including tenth-frame fill deliveries. */
export interface BowlingPlayer { player: number; name: string }
export interface BowlingScore extends BowlingPlayer {
  frames: number[][];
  /** Cumulative scores. A mark remains null until its bonus deliveries exist. */
  frameScores: Array<number | null>;
  total: number;
}
export interface BowlingResult { player: number; pins: number; strike: boolean; spare: boolean }
export interface BowlingState {
  phase: 'ready' | 'rolling' | 'complete';
  currentPlayer: number | null;
  frame: number;
  ball: number;
  pinsStanding: number[];
  players: BowlingScore[];
  complete: boolean;
  lastRoll: BowlingResult | null;
  ranking: Array<BowlingPlayer & {total: number; rank: number}>;
}
export const FULL_RACK = Object.freeze(Array.from({length: 10}, (_, index) => index + 1));

/** Scorecard marks; frame is zero-based, and the tenth can contain a fill spare. */
export function formatFrame(rolls: number[], frame: number): string {
  return rolls.map((pins, index) => {
    const spare = (index === 1 && rolls[0] !== 10 && rolls[0] + pins === 10) ||
      (frame === 9 && index === 2 && rolls[0] === 10 && rolls[1] !== 10 && rolls[1] + pins === 10);
    if (spare) return '/';
    if (pins === 10) return 'X';
    return pins === 0 ? '–' : String(pins);
  }).join('  ');
}

export function scoreFrames(frames: number[][]): Array<number | null> {
  let cumulative = 0;
  let pending = false;
  return Array.from({length: 10}, (_, index) => {
    const frame = frames[index] || [];
    const future = frames.slice(index + 1).flat();
    let points: number | null = null;
    if (index === 9) {
      const deliveries = frame[0] === 10 || frame[0] + frame[1] === 10 ? 3 : 2;
      if (frame.length === deliveries) points = frame.reduce((a, b) => a + b, 0);
    } else if (frame[0] === 10) {
      if (future.length >= 2) points = 10 + future[0] + future[1];
    } else if (frame.length === 2) {
      if (frame[0] + frame[1] === 10) {
        if (future.length) points = 10 + future[0];
      } else points = frame[0] + frame[1];
    }
    if (points === null) pending = true;
    if (pending) return null;
    cumulative += points!;
    return cumulative;
  });
}

/** Rules/state only: pinfall is supplied by the settled rigid-body simulation. */
export class BowlingMatch {
  private participants: BowlingPlayer[];
  private frames: number[][][];
  private turn = 0;
  private frame = 0;
  private standing = [...FULL_RACK];
  private complete = false;
  private lastRoll: BowlingResult | null = null;

  constructor(players: BowlingPlayer[]) {
    if (players.length < 1 || players.length > 4 ||
        new Set(players.map(p => p.player)).size !== players.length ||
        players.some(p => !Number.isInteger(p.player) || p.player < 1 || p.player > 4)) {
      throw new Error('Bowling needs one to four unique players.');
    }
    this.participants = players.map(p => ({...p}));
    this.frames = players.map(() => Array.from({length: 10}, () => []));
  }

  getState(rolling = false): BowlingState {
    const players = this.participants.map((player, index) => {
      const frames = this.frames[index].map(frame => [...frame]);
      const frameScores = scoreFrames(frames);
      const totals = frameScores.filter((score): score is number => score !== null);
      return {...player, frames, frameScores, total: totals.at(-1) || 0};
    });
    const ordered = [...players].sort((a, b) => b.total - a.total || a.player - b.player);
    const ranking = ordered.map(player => ({
      player: player.player, name: player.name, total: player.total,
      rank: ordered.findIndex(other => other.total === player.total) + 1,
    }));
    return {
      phase: this.complete ? 'complete' : rolling ? 'rolling' : 'ready',
      currentPlayer: this.complete ? null : this.participants[this.turn].player,
      frame: this.frame + 1,
      ball: this.complete ? this.frames[this.turn][9].length : this.frames[this.turn][this.frame].length + 1,
      pinsStanding: [...this.standing], players, complete: this.complete,
      lastRoll: this.lastRoll ? {...this.lastRoll} : null, ranking,
    };
  }

  /** Remaining IDs must be a subset of the rack before this delivery. */
  record(remaining: number[]): {resetRack: boolean; result: BowlingResult} {
    if (this.complete) throw new Error('This match is complete.');
    if (new Set(remaining).size !== remaining.length || remaining.some(id => !this.standing.includes(id))) {
      throw new Error('Invalid pinfall: a delivery cannot add pins to the rack.');
    }
    const pins = this.standing.length - remaining.length;
    const frame = this.frames[this.turn][this.frame];
    const before = [...frame];
    const result = {
      player: this.participants[this.turn].player, pins,
      strike: pins === 10 && (before.length === 0 ||
        (this.frame === 9 && before[0] === 10 && (before.length === 1 || before[1] === 10))),
      spare: remaining.length === 0 && ((before.length === 1 && before[0] !== 10) ||
        (this.frame === 9 && before.length === 2 && before[0] === 10 && before[1] !== 10)),
    };
    frame.push(pins);
    this.standing = [...remaining];
    this.lastRoll = result;
    let finished: boolean;
    let resetRack = false;
    if (this.frame < 9) {
      finished = frame[0] === 10 || frame.length === 2;
    } else {
      finished = frame.length === 3 || (frame.length === 2 && frame[0] + frame[1] < 10);
      // First strike, double, or first-two-ball spare earns a fresh rack.
      if (!finished && (pins === 10 || (frame.length === 2 && before[0] !== 10 && remaining.length === 0))) {
        resetRack = true;
      }
    }
    if (finished) {
      if (this.turn === this.participants.length - 1 && this.frame === 9) {
        this.complete = true;
      } else {
        this.turn = (this.turn + 1) % this.participants.length;
        if (this.turn === 0) this.frame += 1;
        resetRack = true;
      }
    }
    if (resetRack) this.standing = [...FULL_RACK];
    return {resetRack, result};
  }
}
