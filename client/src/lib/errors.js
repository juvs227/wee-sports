import { MAX_PLAYERS } from '@wee/shared/protocol.js';

/**
 * Every failure the server or network can produce, said the way a person
 * holding a phone needs to hear it. Pattern from gameboystudio's REJECTION_TEXT.
 */
const TEXT = {
  'no-room': 'No game is using that code. Check the TV and try again.',
  'room-full': `That lobby already has ${MAX_PLAYERS} players.`,
  'bad-name': 'Type a name first.',
  'bad-version': 'This page is out of date. Reload and try again.',
  'bad-sport': "That sport isn't open yet.",
  'server-busy': 'The server is busy. Try again in a moment.',
  'in-progress': 'That game has already started.',
  'not-player': "You're not in this game. Join again to get back in.",
  'ready-locked': 'The game is already starting.',
  'bad-ready': "That didn't go through. Tap Ready again.",
  'no-vote': 'Voting is already over.',
  'bad-vote': "That vote didn't go through. Tap Yes or No.",
  'already-voted': 'You already voted.',
  timeout: "Couldn't reach the game server. Check your Wi-Fi and try again.",
  closed: 'The game ended on the TV.',
  disconnected: 'Lost connection to the game. Join again to get back in.',
};

export function errorText(code) {
  return TEXT[code] ?? 'Something went wrong. Try again.';
}
