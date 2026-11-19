/**
 * Scalable sport and control marks. Outline sport icons use currentColor so
 * the phone and existing controls retain readable contrast in both themes.
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
    <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <g transform="rotate(-35 32 32)">
        <ellipse cx="32" cy="22" rx="13" ry="16" />
        <path d="M24 11v22M29 7v30M35 7v30M40 11v22M21 14h22M19 20h26M20 26h24M23 32h18" strokeWidth="1.2" />
        <path d="M28.5 37 32 44l3.5-7" />
        <rect x="29" y="43" width="6" height="15" rx="2" />
      </g>
    </svg>
  );
}



export function BowlingIcon(props) {
  return (
    <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path
        d="M40 6c-4 0-5.5 3.5-5.5 7 0 3 1.5 5 1.5 7.5 0 2.5-6 7-6 17 0 8 3 15 4 20h12c1-5 4-12 4-20 0-10-6-14.5-6-17 0-2.5 1.5-4.5 1.5-7.5 0-3.5-1.5-7-5.5-7z"
      />
      <path d="M35.8 22.5h8.4" />
      <circle cx="18" cy="44" r="13" />
      <circle cx="15" cy="39" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="20" cy="37" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="20" cy="43" r="1.4" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function GolfIcon(props) {
  return (
    <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <ellipse cx="29" cy="53" rx="21" ry="6" />
      <path d="M29 52V7l20 7-20 7M23 53h12" />
    </svg>
  );
}

/** Neutral fallback for a supported sport awaiting its own artwork. */
export function SportIcon(props) {
  return (
    <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true" {...props}>
      <circle cx="32" cy="32" r="23" />
      <path d="M14 18c18 5 18 23 0 28M50 18c-18 5-18 23 0 28" />
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

/* Tutorial vote marks. Vote state is told by shape and words, never by color,
   because the seat colors already include red, green and yellow. */

export function CheckIcon(props) {
  return (
    <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M10 25l9 9 19-20" />
    </svg>
  );
}

export function PlayIcon(props) {
  return (
    <svg viewBox="0 0 48 48" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M15 9.5v29a2 2 0 0 0 3 1.7l23-14.5a2 2 0 0 0 0-3.4L18 7.8a2 2 0 0 0-3 1.7z" />
    </svg>
  );
}

export function SkipIcon(props) {
  return (
    <svg viewBox="0 0 48 48" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M8 11v26a2 2 0 0 0 3.1 1.6L28 26.6a2 2 0 0 0 0-3.2L11.1 9.4A2 2 0 0 0 8 11z" />
      <rect x="33" y="9" width="6" height="30" rx="2" />
    </svg>
  );
}

export function DashIcon(props) {
  return (
    <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round" aria-hidden="true" {...props}>
      <path d="M13 24h22" />
    </svg>
  );
}
