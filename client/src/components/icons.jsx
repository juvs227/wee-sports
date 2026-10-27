/**
 * Placeholder art, drawn as inline SVG so it stays sharp on a TV. The asset
 * pass replaces the sport icons; the step icons use currentColor so CSS
 * decides their color.
 */

export function BallMark(props) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" {...props}>
      <circle cx="16" cy="16" r="14" fill="#d7f34a" stroke="#9cb81f" strokeWidth="2" />
      <path d="M6 9c6 3 6 11 0 14M26 9c-6 3-6 11 0 14" fill="none" stroke="#fff" strokeWidth="2.2" />
    </svg>
  );
}

export function RacketIcon(props) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" {...props}>
      <g transform="rotate(-35 32 32)">
        <clipPath id="wee-racket-strings">
          <ellipse cx="32" cy="22" rx="11.5" ry="14.5" />
        </clipPath>
        <g clipPath="url(#wee-racket-strings)" stroke="#2f80ed" strokeOpacity="0.35" strokeWidth="1.3">
          <path d="M18 11h28M18 16h28M18 21h28M18 26h28M18 31h28M24 5v34M28 5v34M32 5v34M36 5v34M40 5v34" />
        </g>
        <ellipse cx="32" cy="22" rx="13" ry="16" fill="none" stroke="#2f80ed" strokeWidth="3.5" />
        <path d="M28.5 37 32 44l3.5-7" fill="none" stroke="#2f80ed" strokeWidth="3" strokeLinejoin="round" />
        <rect x="29" y="43" width="6" height="15" rx="3" fill="#1f4f99" />
      </g>
      <circle cx="17" cy="48" r="7.5" fill="#d7f34a" stroke="#a3c227" strokeWidth="1.5" />
      <path d="M11.5 44.5c3 1.5 3 5.5 0 7M22.5 44.5c-3 1.5-3 5.5 0 7" fill="none" stroke="#fff" strokeWidth="1.5" />
    </svg>
  );
}

export function BowlingIcon(props) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" {...props}>
      <path
        d="M40 6c-4 0-5.5 3.5-5.5 7 0 3 1.5 5 1.5 7.5 0 2.5-6 7-6 17 0 8 3 15 4 20h12c1-5 4-12 4-20 0-10-6-14.5-6-17 0-2.5 1.5-4.5 1.5-7.5 0-3.5-1.5-7-5.5-7z"
        fill="#fff"
        stroke="#b9c1c9"
        strokeWidth="1.5"
      />
      <path d="M35.8 22.5h8.4M35.2 26h9.6" stroke="#e5484d" strokeWidth="2.2" />
      <circle cx="19" cy="46" r="11" fill="#6e56cf" />
      <circle cx="15.5" cy="42" r="1.8" fill="#3b2a87" />
      <circle cx="20.5" cy="40.5" r="1.8" fill="#3b2a87" />
      <circle cx="19" cy="46" r="1.8" fill="#3b2a87" />
      <path d="M12 41a9 9 0 0 1 5-5" fill="none" stroke="#fff" strokeOpacity="0.5" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function GolfIcon(props) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" {...props}>
      <ellipse cx="32" cy="52" rx="26" ry="8" fill="#30a46c" />
      <ellipse cx="32" cy="50.5" rx="24" ry="6" fill="#4cc38a" />
      <ellipse cx="38" cy="50" rx="4" ry="1.6" fill="#145233" />
      <path d="M38 50V8" stroke="#5b646c" strokeWidth="2" strokeLinecap="round" />
      <path d="M38 8l16 5.5L38 19z" fill="#e5484d" />
      <circle cx="20" cy="46.5" r="4.5" fill="#fff" stroke="#c3cad1" strokeWidth="1.2" />
    </svg>
  );
}

export function SparkleIcon(props) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" {...props}>
      <path d="M30 10c2 12 6 16 18 18-12 2-16 6-18 18-2-12-6-16-18-18 12-2 16-6 18-18z" fill="#f5b400" />
      <path d="M49 41c.8 4 2 5.2 6 6-4 .8-5.2 2-6 6-.8-4-2-5.2-6-6 4-.8 5.2-2 6-6z" fill="#f59e0b" />
      <path d="M15 44c.5 2.6 1.4 3.5 4 4-2.6.5-3.5 1.4-4 4-.5-2.6-1.4-3.5-4-4 2.6-.5 3.5-1.4 4-4z" fill="#fbbf24" />
    </svg>
  );
}

export function TvIcon(props) {
  return (
    <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <rect x="5" y="8" width="38" height="25" rx="4" />
      <path d="M17 41h14M24 33v8" />
    </svg>
  );
}

export function ScanIcon(props) {
  return (
    <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <rect x="13" y="4" width="22" height="40" rx="5" />
      <rect x="18.5" y="13" width="4.5" height="4.5" rx="1" fill="currentColor" stroke="none" />
      <rect x="25" y="13" width="4.5" height="4.5" rx="1" fill="currentColor" stroke="none" />
      <rect x="18.5" y="19.5" width="4.5" height="4.5" rx="1" fill="currentColor" stroke="none" />
      <path d="M26 22h3.5M26 25v-.01" />
      <path d="M21 37h6" />
    </svg>
  );
}

export function SwingIcon(props) {
  return (
    <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <rect x="21" y="8" width="13" height="24" rx="3.5" transform="rotate(28 27.5 20)" />
      <path d="M8 34c2-7 6-12 12-15" opacity="0.55" />
      <path d="M6 42c3-4 7-7 12-8.5" opacity="0.35" />
    </svg>
  );
}

/** Ready mark. State is told by shape and words, never by color, because the seat colors already include red, green and yellow. */
export function CheckIcon(props) {
  return (
    <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M10 25l9 9 19-20" />
    </svg>
  );
}
