/**
 * Every failure the server or network can produce, said the way a person
 * holding a phone needs to hear it. Pattern from gameboystudio's REJECTION_TEXT.
 */
const TEXT = {
  'no-room': 'No game is using that code. Check the TV and try again.',
  'room-full': 'That lobby is full. Ask the host to open another game.',
  'bad-name': 'Type a name first.',
  'bad-version': 'This page is out of date. Reload and try again.',
  'bad-sport': "That sport isn't open yet.",
  'server-busy': 'The server is busy. Try again in a moment.',
  'in-progress': 'That game has already started.',
  'not-player': "You're not in this game. Join again to get back in.",
  'no-ready-check': "It's not time to get ready yet.",
  'bad-ready': "That didn't go through. Tap Ready again.",
  'setup-required': 'Calibrate your phone or choose button controls before pressing Ready.',
  'bad-setup': 'Choose your controller again.',
  'not-host': 'Only the TV can do that.',
  'no-vote': 'Voting is already over.',
  'bad-vote': "That vote didn't go through. Tap Yes or No.",
  'already-voted': 'You already voted.',
  'no-tutorial': 'The tutorial is already over.',
  'not-learner': "You're watching this one. Follow along on the TV.",
  'bad-move': "That didn't go through. Try the move again.",
  timeout: "Couldn't reach the game server. Check your Wi-Fi and try again.",
  closed: 'The game ended on the TV.',
  disconnected: 'Reconnecting… Keep this page open. Your seat is held for 60 seconds.',
  paused: 'Waiting for everyone to reconnect.',
  'bad-session': 'Your reconnect window expired. Join again.',
  'already-in-room': 'Leave your current lobby before joining another.',
  'not-game-leader': 'Player 1 manages shared game options.',
  'not-playing': 'That match changed. Wait for the current game to be ready.',
  'bad-game-command': 'That option is not available for this game.',
  'duplicate-command': 'That change was already sent. Check the current game settings.',
  'game-command-pending': 'Wait for the previous change to finish.',
  'delivery-pending': 'Your roll is reaching the TV. Try pausing again in a moment.',
  'bad-pause': 'That pause request was not understood. Try again.',
  'network-busy': 'The connection is busy. Let it recover, then swing again.',
  'ball-in-play': 'Let the ball and pins settle before starting a new game.',
  'solo-only': 'That option is available in solo play.',
  'game-loading': 'Waiting for the TV game. Try again in a moment.',
  'game-command-limit': 'This session has reached its settings limit. Start a new lobby.',
};

export function errorText(code) {
  return TEXT[code] ?? 'Something went wrong. Try again.';
}
