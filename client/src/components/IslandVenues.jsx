import {useLayoutEffect, useRef, useState} from 'react';
import {islandLabel} from '../lib/island.js';

/** Labels stay readable inside the screen; targets share the image coordinates. */
export function IslandVenues({rect, viewport, venues, highlighted, renderControl}) {
  const labels = useRef(null);
  const [sizes, setSizes] = useState({});
  useLayoutEffect(() => {
    const observer = new ResizeObserver(entries => setSizes(previous => {
      const next = {...previous};
      let changed = false;
      for (const {target} of entries) {
        const size = {width: target.offsetWidth, height: target.offsetHeight};
        if (!size.width || !size.height) continue;
        const old = previous[target.dataset.venueLabel];
        if (old?.width === size.width && old?.height === size.height) continue;
        next[target.dataset.venueLabel] = size;
        changed = true;
      }
      return changed ? next : previous;
    }));
    for (const label of labels.current.children) observer.observe(label);
    return () => observer.disconnect();
  }, []);
  const placed = venues.map(venue => ({...venue,
    point: islandLabel(venue.label, rect, viewport, sizes[venue.sportId])}));
  return <>
    <svg className="island-connectors" width={rect.width} height={rect.height} aria-hidden="true">
      {placed.map(venue => <g key={venue.sportId} data-highlighted={highlighted === venue.sportId}>
        <line x1={venue.point.x} y1={venue.point.y} x2={venue.anchor.x * rect.width} y2={venue.anchor.y * rect.height} />
        {highlighted === venue.sportId && <circle className="island-target-halo" cx={venue.anchor.x * rect.width} cy={venue.anchor.y * rect.height} r="11" />}
        <circle data-venue-anchor={venue.sportId} cx={venue.anchor.x * rect.width} cy={venue.anchor.y * rect.height} r="4" />
      </g>)}
    </svg>
    <nav ref={labels} className="island-map-venues" aria-label="Sports on the island">
      {placed.map(venue => <div className="island-venue-anchor" data-venue-label={venue.sportId} key={venue.sportId}
        style={{left: venue.point.x, top: venue.point.y}}>{renderControl(venue.sport)}</div>)}
    </nav>
  </>;
}
