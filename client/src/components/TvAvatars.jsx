import { useEffect, useState } from 'react';
import { EVENTS } from '@wee/shared/protocol.js';
import { request } from '../lib/socket.js';
import { TennisPlayerAvatar } from './PlayerAvatar.jsx';

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
                gap: '0.5rem',
                width: '22rem',
                minHeight: 'calc(100dvh - 18rem)',
                padding: '2rem',
                overflow: 'hidden',
                border: '2px solid var(--p' + (player.slot + 1) + ')',
                borderRadius: '1rem',
              }}
            >
              <TennisPlayerAvatar slot={player.slot} name={player.name} color={playerColor} size={150} />
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
            </section>
          );
        })}
      </div>
    </main>
  );
}
