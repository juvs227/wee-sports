import { OPEN_SPORTS } from '@wee/shared/protocol.js';
import { SPORT_REGISTRY } from '../../../shared/sportRegistry.js';
import {BowlingIcon, GolfIcon, RacketIcon, SportIcon} from '../components/icons.jsx';

/**
 * Presentation only. Playable names and capacities come from the registry;
 * the protocol remains the authority for which games can open a room.
 */
const CATALOG = [{
    id: 'tennis',
    blurb: 'Rally with a friend using two phones, or play solo against the bot.',
    Icon: RacketIcon,
    tint: ['#f1fbdc', '#c6eb86'],
  },
{
    id: 'bowling',
    blurb: 'Line up, step in, and roll it with an underhand swing.',
    Icon: BowlingIcon,
    tint: ['#f3efff', '#d5cbfb'],
  },
{
    id: 'golf',
    name: 'Golf',
    blurb: 'Read the green and follow through on every putt.',
    Icon: GolfIcon,
    tint: ['#e6f8ef', '#b2e5c8'],
  }];

export function buildSportsCatalog(registry = SPORT_REGISTRY, openSports = OPEN_SPORTS) {
  const ids = [...new Set([...CATALOG.map(sport => sport.id), ...openSports])];
  return ids.map(id => {
    const presentation = CATALOG.find(sport => sport.id === id);
    const registered = registry[id];
    return {
      id, blurb: '', Icon: SportIcon, tint: ['#e5f0ef', '#b6d8d3'],
      ...presentation,
      name: registered?.name ?? presentation?.name ?? id,
      players: registered?.players ?? null,
      open: Boolean(registered) && openSports.includes(id),
    };
  });
}

export const SPORTS = buildSportsCatalog();

export function sportName(id) {
  return SPORTS.find((sport) => sport.id === id)?.name ?? id;
}

export function playerRange(players) {
  if (!players) return 'Coming soon';
  const {min, max} = players;
  return min === max ? `${max} ${max === 1 ? 'player' : 'players'}` : `${min}–${max} players`;
}
