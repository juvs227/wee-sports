import { BowlingIcon, RacketIcon, SportIcon } from './icons.jsx';

const marks = [RacketIcon, BowlingIcon, SportIcon, RacketIcon, RacketIcon];

/** Decorative only: the QR code and joined players remain the lobby's focus. */
export function LobbyBackdrop() {
  return <div className="host-lobby__backdrop" aria-hidden="true">
    {marks.map((Mark, index) => <span className="host-lobby__mark" key={index}><Mark focusable="false" /></span>)}
  </div>;
}
