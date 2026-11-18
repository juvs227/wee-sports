/**
 * What the tutorial says and shows for each move. Which moves a sport teaches,
 * and in what order, comes from TUTORIAL_MOVES in the shared protocol, so the
 * TV and phones always agree with the server.
 *
 * Tennis directions are written for a right-handed player; the TV tells
 * lefties to mirror them. Bowling directions point down the lane, so they are
 * the same for either hand.
 */

const MOVES = {
  tennis: {
    forehand: {
      name: 'Forehand',
      cue: 'Swing fast from your racket side, across your body.',
      how: [
        'Start with your phone back by your hip.',
        'Whip it forward and across your body. Quick and snappy!',
        'Finish up by your other shoulder.',
      ],
    },
    backhand: {
      name: 'Backhand',
      cue: 'Reach across your body, then swing fast back out.',
      how: [
        'Bring your phone across to your other hip.',
        'Whip it forward and out to your racket side. Quick and snappy!',
        'Keep your arm long as you follow through.',
      ],
    },
    serve: {
      name: 'Serve',
      cue: 'Raise your phone up high, then swing fast down and forward.',
      how: [
        'Lift your phone up behind your head.',
        'Reach up as if to hit a ball above you.',
        'Snap it down and forward toward the TV.',
      ],
    },
  },
  bowling: {
    aim: {
      name: 'Hold and aim',
      cue: 'Screen up, top of the phone toward the TV. Tilt to aim.',
      how: [
        'Hold your phone flat in your palm, screen up, top toward the TV.',
        'Tilt it to the left, then to the right, and watch your aim line move.',
        'In a match, tap Arm motion roll once your line looks good. Your aim locks in.',
      ],
    },
    straight: {
      name: 'Straight roll',
      cue: 'Swing underhand toward the TV and keep your wrist still.',
      how: [
        'Swing your arm back, then forward and up, like rolling a real ball.',
        'Stop your swing out in front of you to release. Never let go of your phone!',
        'A faster swing rolls a faster ball. Keep your wrist flat for a straight roll.',
      ],
    },
    curveRight: {
      name: 'Curve right',
      cue: 'Swing underhand and turn your wrist to the right.',
      how: [
        'Start the same underhand swing.',
        'As you swing forward, turn your wrist clockwise, like turning a doorknob to the right.',
        'A bigger turn, up to about a quarter turn, curves the ball more.',
      ],
    },
    curveLeft: {
      name: 'Curve left',
      cue: 'Swing underhand and turn your wrist to the left.',
      how: [
        'Start the same underhand swing.',
        'As you swing forward, turn your wrist counterclockwise, to the left.',
        'Slower rolls have more time to curve before they reach the pins.',
      ],
    },
  },
};

/** A tip shown on every step of a sport's tutorial. */
const GRIP_TIPS = {
  tennis:
    'Hold your phone like a racket handle, with a tight grip. Use a wrist strap if you have one. Every swing must be quick: a slow swing may not count. Left-handed? Mirror every move.',
  bowling:
    'Grip your phone tightly and use a wrist strap if you have one. The ball leaves when your swing stops, so never let go of your phone. Your phone shows the power and curve of each roll.',
};

/** How to fix a bowling roll that came out as `detected` instead of `expected`. */
const ROLL_FIXES = {
  straight: 'Keep your wrist flat as you swing.',
  curveRight: 'Turn your wrist to the right as you swing forward.',
  curveLeft: 'Turn your wrist to the left as you swing forward.',
};

const ROLL_RESULTS = {
  straight: 'That rolled straight.',
  curveRight: 'That curved right.',
  curveLeft: 'That curved left.',
};

/**
 * What the phone says after a move that didn't match the step: what it saw,
 * then how to fix it.
 */
export function attemptFeedback(sport, expected, detected) {
  if (sport === 'bowling') {
    const seen = ROLL_RESULTS[detected] ?? 'That roll didn\u2019t match.';
    return `${seen} ${ROLL_FIXES[expected] ?? 'Try again.'}`;
  }
  const seen = MOVES[sport]?.[detected]?.name;
  const wanted = tutorialMove(sport, expected).name;
  return seen
    ? `That looked like a ${seen.toLowerCase()}. Try a ${wanted.toLowerCase()}.`
    : `Try a ${wanted.toLowerCase()} again.`;
}

export function gripTip(sport) {
  return GRIP_TIPS[sport] ?? '';
}

export function tutorialMove(sport, move) {
  return MOVES[sport]?.[move] ?? { name: move, cue: '', how: [] };
}
