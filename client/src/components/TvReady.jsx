/**
 * Only people who have joined appear on the TV. Read from across a room.
 *
 * Seat colors (--p1..--p8) are identity only. P2 is red, P3 green and P4
 * yellow, so ready state never uses color: it is the border style (dashed or
 * solid), a check mark, and a word.
 */

import { PHASES, isController } from '@wee/shared/protocol.js';
import { CheckIcon } from './icons.jsx';
import { TennisPlayerAvatar } from './PlayerAvatar.jsx';

function GearIcon({ sport, color, name }) {
  return sport === 'bowling' ? (
    <svg viewBox="0 0 48 48" role="img" aria-label={`${name}'s bowling ball`}>
      <circle cx="24" cy="24" r="20" fill={color} />
      <circle cx="17" cy="18" r="2.8" fill="#171526" />
      <circle cx="25" cy="16" r="2.8" fill="#171526" />
      <circle cx="22" cy="26" r="2.8" fill="#171526" />
    </svg>
  ) : (
    <svg viewBox="0 0 48 48" role="img" aria-label={`${name}'s tennis racket`}>
      <ellipse cx="22" cy="17" rx="11" ry="15" fill={color} fillOpacity=".42" stroke={color} strokeWidth="3" />
      <path d="m28 29 12 15M15 7l14 20M10 15l24 4M14 28l18-21M18 32l14-17" fill="none" stroke={color} strokeWidth="1.5" />
      <path d="m28 29 12 15" fill="none" stroke={color} strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Shown through the ready check and the countdown that follows it. Players
 * stay ready during the countdown, and anyone who backs out cancels it, so
 * the cards keep showing who is ready.
 */
export function TvReady({ lobby }) {
  const counting = lobby.phase === PHASES.COUNTDOWN;
  const { players } = lobby;
  const leader = players.find(player => player.slot === lobby.leaderSlot);
  if (!players.length) return <p className="host-lobby__waiting" role="status">Waiting for players…</p>;
  const cue = lobby.resumeGame ? 'Everyone keeps their place.' : counting ? 'Starting…' : lobby.canStart && leader ? `Start from ${leader.name}’s phone` : 'Get ready on your phone';

  return (
    <section className="ready" data-counting={counting} aria-label="Lobby players">
      <ul className="ready__cards" aria-label="Joined players" aria-live="polite">
        {players.map(({ slot, name, ready, setup, color, racketColor, ballColor }) => (
          <li
            key={slot}
            className="ready-card"
            data-ready={ready}
            style={{ '--player': `var(--p${slot + 1})` }}
          >
            <div className="ready-card__visuals">
              <div className="ready-card__player">
                <TennisPlayerAvatar slot={slot} name={name} color={color} size={72} />
                <div className="ready-card__identity">
                  <span className="seat__badge" data-slot={slot}>P{slot + 1}</span>
                  <span className="ready-card__name">{name}</span>
                </div>
              </div>
              <GearIcon
                sport={lobby.sport}
                color={lobby.sport === 'bowling'
                  ? ballColor ?? color ?? '#6e47ad'
                  : racketColor ?? color ?? '#3b82f6'}
                name={name}
              />
            </div>
            <span className="ready-card__status">
              {ready ? <CheckIcon className="ready-card__icon" /> : null}
              {ready ? 'Ready' : !isController(lobby.sport, slot) ? 'Watching' : setup ? 'Connected' : 'Connecting controller…'}
            </span>
          </li>
        ))}
      </ul>

      <p className="host-lobby__start-cue" role="status">{cue}</p>
    </section>
  );
}
