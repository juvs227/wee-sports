import { useEffect, useState } from 'react';
import { EVENTS } from '@wee/shared/protocol.js';
import { request } from '../lib/socket.js';
import { TennisPlayerAvatar } from './PlayerAvatar.jsx';

function EquipmentAvatar({ bowling, color, name, slot, style }) {
  const label = bowling ? `${name}'s bowling ball` : `${name}'s tennis racket`;
  if (bowling) {
    const gradientId = `bowling-ball-gradient-${slot}`;
    return (
      <svg viewBox="0 0 160 160" role="img" aria-label={label} style={{ width: 92, height: 'auto', flex: 'none', ...style }}>
        <defs>
          <radialGradient id={gradientId} cx="32%" cy="24%" r="78%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity=".72" />
            <stop offset="30%" stopColor={color} />
            <stop offset="100%" stopColor={color} />
          </radialGradient>
        </defs>
        <circle cx="80" cy="80" r="68" fill={`url(#${gradientId})`} />
        <circle cx="62" cy="59" r="8" fill="#171526" />
        <circle cx="89" cy="55" r="8" fill="#171526" />
        <circle cx="78" cy="84" r="9" fill="#171526" />
      </svg>
    );
  }

  const stringsId = `racket-strings-${slot}`;
  return (
    <svg viewBox="0 0 160 160" role="img" aria-label={label} style={{ width: 92, height: 'auto', flex: 'none', ...style }}>
      <defs>
        <clipPath id={stringsId}>
          <ellipse cx="70" cy="56" rx="26" ry="37" />
        </clipPath>
      </defs>
      <g fill="none" stroke={color} strokeLinecap="round" strokeLinejoin="round">
        <ellipse cx="70" cy="56" rx="32" ry="44" strokeWidth="9" />
        <path d="M70 100v45" strokeWidth="13" />
      </g>
      <g clipPath={`url(#${stringsId})`} fill="none" stroke="#deded7" strokeWidth="2">
        <path d="M47 10v92M58 10v92M69 10v92M80 10v92M91 10v92" />
        <path d="M25 29h90M25 41h90M25 53h90M25 65h90M25 77h90" />
      </g>
    </svg>
  );
}

/** Brief laptop-only player reveal between the tutorial and the match. */
export function TvAvatars({ lobby }) {
  const readyCount = lobby.players.filter((player) => player.ready).length;
  const bowling = lobby.sport === 'bowling';
  const [colors, setColors] = useState({});
  const [colorError, setColorError] = useState(null);
  const objectTarget = bowling ? 'ball' : 'racket';
  const objectColorField = bowling ? 'ballColor' : 'racketColor';

  useEffect(() => {
    setColors(Object.fromEntries(lobby.players.map((player) => [player.slot, {
      player: player.color,
      object: player[objectColorField]
        ?? player.color
        ?? '#3b82f6',
    }])));
  }, [lobby.players, objectColorField, bowling]);

  async function changeColor(slot, target, color) {
    setColors((current) => ({
      ...current,
      [slot]: { ...current[slot], [target === 'player' ? 'player' : 'object']: color },
    }));
    setColorError(null);
    const result = await request(EVENTS.HOST_PLAYER_COLOR_SET, { slot, target, color });
    if (!result?.ok) setColorError(result?.error ?? 'disconnected');
  }

  return (
    <main
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '1.5rem',
        minHeight: '70vh',
        padding: '3rem 1rem',
        textAlign: 'center',
      }}
    >
      <div>
        <p className="eyebrow">{bowling ? 'Bowling players' : 'Tennis players'}</p>
        <h1>Get ready to play!</h1>
        <p>{readyCount}/{lobby.players.length} ready. Set colors here or on each phone, then press Ready.</p>
      </div>
      {colorError ? <p role="alert">Could not save color. Try again.</p> : null}
      <div style={{ display: 'flex', justifyContent: 'center', gap: '2rem', flexWrap: 'wrap' }}>
        {lobby.players.map((player) => {
          const playerColor = colors[player.slot]?.player ?? player.color ?? '#3b82f6';
          const defaultObjectColor = player[objectColorField]
            ?? player.color
            ?? '#3b82f6';
          const objectColor = colors[player.slot]?.object ?? defaultObjectColor;
          return (
            <section
              key={player.slot}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '0.5rem',
                width: '24rem',
                minHeight: 'calc(100dvh - 18rem)',
                padding: '1.5rem',
                overflow: 'hidden',
                border: '2px solid var(--p' + (player.slot + 1) + ')',
                borderRadius: '1rem',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '.35rem',
                  width: '100%',
                  minHeight: 230,
                  transform: 'translate(-16px, 28px)',
                }}
              >
                <div style={{ display: 'grid', placeItems: 'center', width: '68%', flex: 'none' }}>
                  <TennisPlayerAvatar slot={player.slot} name={player.name} color={playerColor} size={220} />
                </div>
                <EquipmentAvatar
                  bowling={bowling}
                  color={objectColor}
                  name={player.name}
                  slot={player.slot}
                  style={{ transform: 'translateX(-8px)' }}
                />
              </div>
              <div style={{ display: 'grid', justifyItems: 'center', gap: '.5rem', marginTop: 'auto' }}>
                <strong>{player.name}</strong>
                <span>P{player.slot + 1}</span>
                <label style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
                  Player color
                  <input type="color" value={playerColor}
                    aria-label={`Choose ${player.name}'s player color`}
                    onChange={(event) => changeColor(player.slot, 'player', event.target.value)} />
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
                  {bowling ? 'Ball color' : 'Racket color'}
                  <input type="color" value={objectColor}
                    aria-label={`Choose ${player.name}'s ${objectTarget} color`}
                    onChange={(event) => changeColor(player.slot, objectTarget, event.target.value)} />
                </label>
                <span>{player.ready ? 'Ready' : 'Waiting for Ready'}</span>
              </div>
            </section>
          );
        })}
      </div>
    </main>
  );
}
