import {formatFrame, type BowlingState} from './match';

/** Keep the familiar two boxes per frame, including the empty box before X. */
export function frameMarks(rolls: number[], index: number): string[] {
  const marks = rolls.length ? formatFrame(rolls, index).split('  ') : [];
  if (index < 9 && rolls[0] === 10) return ['', 'X'];
  return Array.from({length: index === 9 ? 3 : 2}, (_, slot) => marks[slot] ?? '');
}

export function awaitingBonus(rolls: number[], index: number, total: number | null): boolean {
  if (total !== null || !rolls.length) return false;
  return rolls[0] === 10 || (rolls.length >= 2 && rolls[0] + rolls[1] === 10) ||
    (index === 9 && rolls.length === 3 && rolls[1] + rolls[2] === 10);
}

/** State polls/reconnects are not new celebrations. Only a newly scored roll is. */
export function createRollCallouts() {
  let previousRolls: number | null = null;
  return {
    reset() { previousRolls = null; },
    observe(state: BowlingState, paused: boolean): {kind: 'strike' | 'spare'; player: string} | null {
      const count = state.players.reduce((sum, player) => sum + player.frames.reduce((n, frame) => n + frame.length, 0), 0);
      const advanced = previousRolls !== null && count > previousRolls;
      previousRolls = count;
      const last = state.lastRoll;
      if (!advanced || paused || state.phase === 'rolling' || !last || (!last.strike && !last.spare)) return null;
      return {kind: last.strike ? 'strike' : 'spare', player: state.players.find(player => player.player === last.player)?.name ?? `Player ${last.player}`};
    },
  };
}
