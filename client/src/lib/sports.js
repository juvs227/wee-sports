import { OPEN_SPORTS } from '@wee/shared/protocol.js';
import { BowlingIcon, GolfIcon, RacketIcon } from '../components/icons.jsx';

/**
 * The sports shelf. Whether a sport can be hosted comes from the shared
 * protocol, so the homepage never offers something the server would refuse.
 * Icons and tints are placeholders until the asset pass.
 */
const CATALOG = [
  {
    id: 'tennis',
    name: 'Tennis',
    blurb: 'Rally with a friend using two phones, or play solo against the bot.',
    players: { min: 1, max: 2 },
    Icon: RacketIcon,
    tint: ['#f1fbdc', '#c6eb86'],
  },
  {
    id: 'bowling',
    name: 'Bowling',
    blurb: 'Line up, step in, and roll it with an underhand swing.',
    players: { min: 1, max: 4 },
    Icon: BowlingIcon,
    tint: ['#f3efff', '#d5cbfb'],
  },
  {
    id: 'golf',
    name: 'Golf',
    blurb: 'Read the green and follow through on every putt.',
    players: { min: 1, max: 4 },
    Icon: GolfIcon,
    tint: ['#e6f8ef', '#b2e5c8'],
  },
];

export const SPORTS = CATALOG.map((sport) => ({ ...sport, open: OPEN_SPORTS.includes(sport.id) }));

export function sportName(id) {
  return SPORTS.find((sport) => sport.id === id)?.name ?? id;
}

export function playerRange({ min, max }) {
  return min === max ? `${max} ${max === 1 ? 'player' : 'players'}` : `${min}–${max} players`;
}
