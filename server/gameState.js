import {BowlingMatch} from '../src/bowling/match.ts';
import {ScoreSystem} from '../src/Tennis/scoreSystem.ts';
import {checkpoint, fail} from './profiles/validation.js';

/** Derive casual results from the same validated stable state we commit. */
export function validateSportState(room, payload) {
  checkpoint(room.sport, payload);
  if (room.sport === 'tennis') {
    try {ScoreSystem.fromCheckpoint(payload.score);} catch {fail('invalid-checkpoint');}
    if (room.players.length !== (payload.humanOpponent ? 2 : 1)) fail('wrong-roster');
    return undefined; // Live room recovery; tennis profile history is separate.
  }
  if (room.sport === 'bowling') {
    let match;
    try { match = BowlingMatch.fromCheckpoint(payload.match); } catch { fail('invalid-checkpoint'); }
    const state = match.getState();
    if (payload.pins.length !== state.pinsStanding.length || payload.pins.some(pin => !pin.standing || !state.pinsStanding.includes(pin.id))) fail('invalid-rack');
    if (state.players.length !== room.players.length || state.players.some(player => !room.players.some(member => player.player === member.slot + 1))) fail('wrong-roster');
    if (!state.complete) return undefined;
    return room.players.map(member => {
      const result = state.ranking.find(player => player.player === member.slot + 1);
      const tied = state.ranking.filter(player => player.total === result.total).length > 1;
      return {memberId: member.memberId, score: result.total, rank: result.rank,
        outcome: room.players.length === 1 ? 'complete' : tied ? 'tie' : result.rank === 1 ? 'win' : 'loss'};
    });
  }
  fail('unsupported-checkpoint');
}

