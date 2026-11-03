/**
 * A looping picture of one tutorial move: the player from behind, the path
 * their phone takes, and the phone sweeping along it. Placeholder art until
 * the asset pass; it uses tokens so CSS decides its colors.
 *
 * Seen from behind, so the player's right is the screen's right and a
 * right-hander can copy it as is.
 */

import { useEffect, useState } from 'react';

const PATHS = {
  forehand: 'M262 178 C 236 228, 110 226, 74 128',
  backhand: 'M58 178 C 84 228, 210 226, 246 128',
  serve: 'M214 112 C 238 40, 196 8, 166 34 C 142 70, 128 140, 110 206',
};

/** Where the ball is met on each path. */
const BALLS = {
  forehand: { cx: 150, cy: 214 },
  backhand: { cx: 170, cy: 214 },
  serve: { cx: 184, cy: 20 },
};

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(() => {
    try {
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch {
      return false;
    }
  });
  useEffect(() => {
    let query;
    try {
      query = window.matchMedia('(prefers-reduced-motion: reduce)');
    } catch {
      return undefined;
    }
    const onChange = () => setReduced(query.matches);
    query.addEventListener?.('change', onChange);
    return () => query.removeEventListener?.('change', onChange);
  }, []);
  return reduced;
}

export function MoveDemo({ move, label }) {
  const reduced = usePrefersReducedMotion();
  const path = PATHS[move];
  if (!path) return null;
  const ball = BALLS[move];
  const markerId = `move-demo-arrow-${move}`;

  return (
    <svg className="move-demo" viewBox="0 0 320 250" role="img" aria-label={label}>
      <defs>
        <marker
          id={markerId}
          viewBox="0 0 10 10"
          refX="5"
          refY="5"
          markerWidth="5"
          markerHeight="5"
          orient="auto-start-reverse"
        >
          <path d="M0 0 10 5 0 10z" className="move-demo__arrow" />
        </marker>
      </defs>

      {/* The player, from behind. */}
      <ellipse className="move-demo__floor" cx="160" cy="238" rx="96" ry="9" />
      <path className="move-demo__body" d="M112 236 C 112 170, 124 122, 160 122 C 196 122, 208 170, 208 236 Z" />
      <circle className="move-demo__body" cx="160" cy="92" r="26" />

      {/* Where the phone goes. */}
      <path className="move-demo__trail" d={path} markerEnd={`url(#${markerId})`} />
      <circle className="move-demo__ball" cx={ball.cx} cy={ball.cy} r="9" />

      {/* The phone. Without motion it rests at the end of the swing. */}
      <g>
        <rect className="move-demo__phone" x="-9" y="-16" width="18" height="32" rx="4" />
        <rect className="move-demo__screen" x="-6" y="-12" width="12" height="22" rx="2" />
        <animateMotion
          dur="2.4s"
          repeatCount="indefinite"
          path={path}
          rotate="auto"
          calcMode="spline"
          keyPoints={reduced ? '1;1' : '0;0;1;1'}
          keyTimes={reduced ? '0;1' : '0;0.25;0.7;1'}
          keySplines={reduced ? '0 0 1 1' : '0 0 1 1;0.4 0 0.2 1;0 0 1 1'}
        />
      </g>
    </svg>
  );
}
