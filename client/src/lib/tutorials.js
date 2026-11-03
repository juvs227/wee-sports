/**
 * What the tutorial says and shows for each move. Which moves a sport teaches,
 * and in what order, comes from TUTORIAL_MOVES in the shared protocol, so the
 * TV and phones always agree with the server.
 *
 * Directions are written for a right-handed player; the TV tells lefties to
 * mirror them.
 */

const MOVES = {
  tennis: {
    forehand: {
      name: 'Forehand',
      cue: 'Swing from your racket side, across your body.',
      how: [
        'Start with your phone back by your hip.',
        'Sweep it forward and across your body.',
        'Finish up by your other shoulder.',
      ],
    },
    backhand: {
      name: 'Backhand',
      cue: 'Reach across your body, then swing back out.',
      how: [
        'Bring your phone across to your other hip.',
        'Swing it forward and out to your racket side.',
        'Keep your arm long as you follow through.',
      ],
    },
    serve: {
      name: 'Serve',
      cue: 'Raise your phone up high, then swing down and forward.',
      how: [
        'Lift your phone up behind your head.',
        'Reach up as if to hit a ball above you.',
        'Swing down and forward toward the TV.',
      ],
    },
  },
};

/** A tip shown on every step. */
export const GRIP_TIP =
  'Hold your phone like a racket handle, with a tight grip. Use a wrist strap if you have one. Left-handed? Mirror every move.';

export function tutorialMove(sport, move) {
  return MOVES[sport]?.[move] ?? { name: move, cue: '', how: [] };
}
