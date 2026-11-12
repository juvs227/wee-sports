import {expect, test} from 'vitest';
import {SPORT_REGISTRY} from '@wee/shared/sportRegistry.js';
import {OPEN_SPORTS} from '@wee/shared/protocol.js';
import {SPORTS, buildSportsCatalog, playerRange} from '@client/lib/sports.js';
import {MAIN_ISLAND, fitIsland, fitIslandBackdrop, islandPoint, presentIslandSports} from '@client/lib/island.js';

test('each supported game is discoverable with the authoritative name and player capacity', () => {
  for (const id of OPEN_SPORTS) {
    const entry = SPORTS.find(sport => sport.id === id);
    expect(entry.open).toBe(true);
    expect(entry.name).toBe(SPORT_REGISTRY[id].name);
    expect(entry.players).toEqual(SPORT_REGISTRY[id].players);
    expect(presentIslandSports(SPORTS).venues.some(venue => venue.sportId === id)).toBe(true);
  }
  expect(SPORTS.some(sport => sport.id === 'table-tennis')).toBe(false);
  expect(MAIN_ISLAND.venues.some(venue => venue.sportId === 'table-tennis')).toBe(false);
});

test('future venues neither advertise player counts nor become playable through artwork', () => {
  const golf = SPORTS.find(sport => sport.id === 'golf');
  expect(golf.open).toBe(false);
  expect(golf.players).toBeNull();
  expect(playerRange(golf.players)).toBe('Coming soon');
  expect(SPORTS.some(sport => /pool|billiard/.test(sport.id))).toBe(false);
  expect(MAIN_ISLAND.reservedSpaces[0].use).toBe('billiards-lounge');
});

test('a new supported game without map art reaches the compact list immediately', () => {
  const registry = {...SPORT_REGISTRY, badminton: {id: 'badminton', name: 'Badminton', players: {min: 1, max: 2}}};
  const catalog = buildSportsCatalog(registry, [...OPEN_SPORTS, 'badminton']);
  const result = presentIslandSports(catalog);
  expect(result.unmapped.map(sport => sport.id)).toEqual(['badminton']);
  expect(result.unmapped[0]).toMatchObject({name: 'Badminton', open: true, players: {min: 1, max: 2}});
  expect(result.venues.some(venue => venue.sportId === 'badminton')).toBe(false);
});

test('portrait and ultrawide layouts keep both image corners and venue anchors in one coordinate system', () => {
  for (const [width, height] of [[1672, 941], [3440, 1440], [430, 932], [768, 1024], [3840, 2160]]) {
    const rect = fitIsland(width, height);
    expect(rect.width / rect.height).toBeCloseTo(MAIN_ISLAND.image.width / MAIN_ISLAND.image.height, 8);
    expect(rect.x).toBeGreaterThanOrEqual(0);
    expect(rect.y).toBeGreaterThanOrEqual(0);
    expect(rect.x + rect.width).toBeLessThanOrEqual(width + 1e-9);
    expect(rect.y + rect.height).toBeLessThanOrEqual(height + 1e-9);
    expect(islandPoint({x: .5, y: .5}, rect)).toEqual({x: width / 2, y: height / 2});
    for (const {anchor} of MAIN_ISLAND.venues) {
      const point = islandPoint(anchor, rect);
      expect((point.x - rect.x) / rect.width).toBeCloseTo(anchor.x, 10);
      expect((point.y - rect.y) / rect.height).toBeCloseTo(anchor.y, 10);
    }
  }
});

test('unmeasured or hidden containers do not produce invalid image coordinates', () => {
  for (const dimensions of [[0, 0], [-1, 500], [500, NaN], [Infinity, 500]]) {
    const rect = fitIsland(...dimensions);
    expect(rect).toEqual({x: 0, y: 0, width: 0, height: 0, scale: 0});
    expect(islandPoint({x: .61, y: .22}, rect)).toEqual({x: 0, y: 0});
  }
});

test('sky and sea reach both screen edges while sharing the island horizon at any aspect ratio', () => {
  for (const image of [MAIN_ISLAND.landing, MAIN_ISLAND.image]) {
    for (const [width, height] of [[1672, 941], [3440, 1440], [430, 932], [768, 1600], [900, 300], [320, 200]]) {
      const rect = fitIsland(width, height, image);
      const backdrop = fitIslandBackdrop(height, rect, image.horizon);
      expect(backdrop.y).toBeLessThanOrEqual(0);
      expect(backdrop.y + backdrop.height).toBeGreaterThanOrEqual(height);
      expect(backdrop.y + backdrop.height * image.horizon).toBeCloseTo(rect.y + rect.height * image.horizon, 8);
    }
  }
});

test('compact home extends scenery behind its header and game list without moving the art strip', () => {
  const image = MAIN_ISLAND.image;
  const rect = fitIsland(390, 219.5, image);
  const backdrop = fitIslandBackdrop(1100, rect, image.horizon, 140);
  expect(backdrop.y + 140).toBeLessThanOrEqual(0);
  expect(backdrop.y + backdrop.height + 140).toBeGreaterThanOrEqual(1100);
  expect(backdrop.y + backdrop.height * image.horizon).toBeCloseTo(rect.y + rect.height * image.horizon, 8);
});

test('unmeasured backdrop and invalid horizon values cannot introduce non-finite CSS sizes', () => {
  const rect = fitIsland(800, 600);
  for (const horizon of [0, 1, NaN, Infinity]) {
    expect(fitIslandBackdrop(600, rect, horizon)).toEqual({y: 0, height: 0});
  }
  expect(fitIslandBackdrop(0, rect, .31)).toEqual({y: 0, height: 0});
  expect(fitIslandBackdrop(600, fitIsland(0, 0), .31)).toEqual({y: 0, height: 0});
});
