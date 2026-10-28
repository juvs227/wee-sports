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
  'not-host': 'Only the TV can start the game.',
  'not-all-ready': 'Wait until every player is ready, then press Play.',
  timeout: "Couldn't reach the game server. Check your Wi-Fi and try again.",
  closed: 'The game ended on the TV.',
  disconnected: 'Reconnecting… Keep this page open. Your seat is held for 60 seconds.',
  paused: 'Waiting for everyone to reconnect.',
  'bad-session': 'Your reconnect window expired. Join again.',
  'already-in-room': 'Leave your current lobby before joining another.',
};

export function errorText(code) {
  return TEXT[code] ?? 'Something went wrong. Try again.';
}
