/**
 * A looping picture of one tutorial move. Placeholder art until the asset
 * pass; it uses tokens so CSS decides its colors.
 *
 * Tennis shows the player from behind, the path their phone takes, and the
 * phone sweeping along it. Seen from behind, the player's right is the
 * screen's right, so a right-hander can copy it as is.
 *
 * Bowling shows two things side by side: the phone seen end-on from behind,
 * so a wrist turn reads as a rotation, and the lane from above, so the result
 * of that turn reads as the ball's path.
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

export function MoveDemo({ sport, move, label }) {
  const reduced = usePrefersReducedMotion();
  if (sport === 'bowling') return <BowlingDemo move={move} label={label} reduced={reduced} />;
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

/** Ball paths down the lane, from the foul line to the pins. */
const LANE_PATHS = {
  straight: 'M240 222 L240 78',
  curveRight: 'M224 222 C 222 168, 222 118, 248 76',
  curveLeft: 'M256 222 C 258 168, 258 118, 232 76',
};

/**
 * How far the phone turns, in degrees, seen from behind. Positive is
 * clockwise: the right edge dips. Aim tilts both ways and back.
 */
const PHONE_TURN = {
  aim: { values: '0;-22;0;22;0', keyTimes: '0;0.25;0.5;0.75;1', rest: -22 },
  straight: { values: '0;0;0;0', keyTimes: '0;0.25;0.7;1', rest: 0 },
  curveRight: { values: '0;0;35;35', keyTimes: '0;0.25;0.7;1', rest: 35 },
  curveLeft: { values: '0;0;-35;-35', keyTimes: '0;0.25;0.7;1', rest: -35 },
};

/** Ten pins in a triangle, headpin nearest the bowler. */
const PINS = [
  [219, 24],
  [233, 24],
  [247, 24],
  [261, 24],
  [226, 36],
  [240, 36],
  [254, 36],
  [233, 48],
  [247, 48],
  [240, 60],
];

const AIM_PIVOT = '240 222';
const DUR = '2.4s';

function BowlingDemo({ move, label, reduced }) {
  const turn = PHONE_TURN[move];
  if (!turn) return null;
  const path = LANE_PATHS[move];
  const markerId = `move-demo-arrow-bowling-${move}`;

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

      {/* The phone from behind: screen up, top pointing into the picture. */}
      <circle className="move-demo__floor" cx="82" cy="118" r="66" />
      <g transform={reduced ? `rotate(${turn.rest} 82 118)` : undefined}>
        <rect className="move-demo__phone" x="32" y="110" width="100" height="16" rx="5" />
        <rect className="move-demo__screen" x="38" y="106" width="88" height="5" rx="2" />
        {reduced ? null : (
          <animateTransform
            attributeName="transform"
            type="rotate"
            dur={DUR}
            repeatCount="indefinite"
            values={turn.values
              .split(';')
              .map((deg) => `${deg} 82 118`)
              .join(';')}
            keyTimes={turn.keyTimes}
          />
        )}
      </g>
      <text className="move-demo__caption" x="82" y="214" textAnchor="middle">
        Phone, from behind
      </text>

      {/* The lane from above. */}
      <rect className="move-demo__lane" x="184" y="8" width="112" height="234" rx="6" />
      {PINS.map(([cx, cy]) => (
        <circle key={`${cx}-${cy}`} className="move-demo__pin" cx={cx} cy={cy} r="5" />
      ))}

      {move === 'aim' ? (
        <g transform={reduced ? `rotate(${turn.rest} ${AIM_PIVOT})` : undefined}>
          <path className="move-demo__trail" d="M240 210 L240 84" markerEnd={`url(#${markerId})`} />
          {reduced ? null : (
            <animateTransform
              attributeName="transform"
              type="rotate"
              dur={DUR}
              repeatCount="indefinite"
              values={turn.values
                .split(';')
                .map((deg) => `${Math.round(deg * 0.6)} ${AIM_PIVOT}`)
                .join(';')}
              keyTimes={turn.keyTimes}
            />
          )}
        </g>
      ) : (
        <path className="move-demo__trail" d={path} markerEnd={`url(#${markerId})`} />
      )}

      {/* The ball. For aim it waits at the foul line; otherwise it rolls. */}
      {move === 'aim' ? (
        <circle className="move-demo__bowling-ball" cx="240" cy="222" r="10" />
      ) : (
        <circle className="move-demo__bowling-ball" r="10">
          <animateMotion
            dur={DUR}
            repeatCount="indefinite"
            path={path}
            calcMode="spline"
            keyPoints={reduced ? '1;1' : '0;0;1;1'}
            keyTimes={reduced ? '0;1' : '0;0.25;0.7;1'}
            keySplines={reduced ? '0 0 1 1' : '0 0 1 1;0.3 0 0.6 1;0 0 1 1'}
          />
        </circle>
      )}
    </svg>
  );
}
