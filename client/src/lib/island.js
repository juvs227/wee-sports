/** Authored scenery and normalized geometry only. Game names, capacity and
 * availability belong to the sport catalog and shared registry, not the map. */
export const MAIN_ISLAND = {
  id: 'resort',
  assetVersion: 2,
  image: {src: '/island/homepage.webp?v=2', ocean: '/island/homepage-ocean.webp', width: 1672, height: 941, horizon: .31, water: 'bay'},
  landing: {src: '/island/landing.webp?v=2', ocean: '/island/landing-ocean.webp', width: 1672, height: 941, horizon: .456, water: 'shore'},
  venues: [
    {sportId: 'tennis', label: {x: .255, y: .52}, anchor: {x: .34, y: .64}},
    {sportId: 'bowling', label: {x: .75, y: .38}, anchor: {x: .69, y: .486}},
    {sportId: 'golf', label: {x: .325, y: .26}, anchor: {x: .35, y: .398}},
  ],
  neighbors: [],
  // Future art reservation, deliberately absent from the sport catalog and
  // host actions. Pool means billiards, not a swimming attraction.
  reservedSpaces: [{id: 'east-billiards', use: 'billiards-lounge',
    bounds: {x: .73, y: .50, width: .07, height: .10}}],
};

export const ISLAND_REGIONS = {[MAIN_ISLAND.id]: MAIN_ISLAND};

/** Preserve the whole island at every aspect ratio. A separate ocean plate
 * fills the surrounding viewport, so the island never needs a cover crop. */
export function fitIsland(viewportWidth, viewportHeight, image = MAIN_ISLAND.image) {
  if (![viewportWidth, viewportHeight, image.width, image.height].every(Number.isFinite) ||
    viewportWidth <= 0 || viewportHeight <= 0 || image.width <= 0 || image.height <= 0) {
    return {x: 0, y: 0, width: 0, height: 0, scale: 0};
  }
  const scale = Math.min(viewportWidth / image.width, viewportHeight / image.height);
  const width = image.width * scale;
  const height = image.height * scale;
  return {x: (viewportWidth - width) / 2, y: (viewportHeight - height) / 2, width, height, scale};
}

/** Extend the separate sky/sea plate to both screen edges without moving its
 * horizon away from the island. Only the scenery stretches; the island and
 * venue anchors retain their original aspect ratio. offset is the art strip's
 * position inside a scrolling compact home, or zero for a full-screen scene. */
export function fitIslandBackdrop(screenHeight, rect, horizon, offset = 0) {
  if (![screenHeight, rect.y, rect.height, horizon, offset].every(Number.isFinite) ||
    screenHeight <= 0 || rect.height <= 0 || horizon <= 0 || horizon >= 1) {
    return {y: 0, height: 0};
  }
  const horizonY = offset + rect.y + rect.height * horizon;
  const bleed = 2; // Keep fractional CSS pixels from exposing an edge during resize.
  const height = Math.max(rect.height, (horizonY + bleed) / horizon,
    (screenHeight - horizonY + bleed) / (1 - horizon));
  return {y: horizonY - height * horizon - offset, height};
}

export function islandPoint(point, rect) {
  return {x: rect.x + point.x * rect.width, y: rect.y + point.y * rect.height};
}

/** Keep controls below the header and within the viewport at larger text sizes.
 * Targets still point at the actual venue; only the label can move. */
export function islandLabel(point, rect, viewport, size = {width: 220, height: 64}) {
  const target = islandPoint(point, rect);
  const margin = 20;
  const left = margin + size.width / 2;
  const right = Math.max(left, viewport.width - margin - size.width / 2);
  const top = Math.max(164, viewport.height * .025 + 128) + size.height / 2;
  const bottom = Math.max(top, viewport.height - 80 - size.height / 2);
  return {x: Math.max(left, Math.min(right, target.x)) - rect.x,
    y: Math.max(top, Math.min(bottom, target.y)) - rect.y};
}

/** Keep an accessible Games list for every catalog entry. This split also
 * exposes new playable games that have no authored marker yet. */
export function presentIslandSports(sports, region = MAIN_ISLAND) {
  const byId = new Map(sports.map(sport => [sport.id, sport]));
  const venues = region.venues.filter(venue => byId.has(venue.sportId))
    .map(venue => ({...venue, sport: byId.get(venue.sportId)}));
  const mappedIds = new Set(venues.map(venue => venue.sportId));
  return {venues, unmapped: sports.filter(sport => sport.open && !mappedIds.has(sport.id))};
}
