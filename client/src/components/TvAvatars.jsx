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

  useEffect(() => {
    setColors(Object.fromEntries(lobby.players.map((player) => [player.slot, player.color])));
  }, [lobby.players]);

  async function changeColor(slot, color) {
    setColors((current) => ({ ...current, [slot]: color }));
    setColorError(null);
    const result = await request(EVENTS.HOST_PLAYER_COLOR_SET, { slot, color });
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
        {lobby.players.map((player) => (
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
            {bowling ? (
              <div
                role="img"
                aria-label={`${player.name}'s bowling ball, ${colors[player.slot] || player.color}`}
                style={{
                  position: 'relative',
                  width: 180,
                  height: 180,
                  margin: 30,
                  borderRadius: '50%',
                  background: `radial-gradient(circle at 32% 25%, #ffffff88, transparent 24%), ${colors[player.slot] || player.color || '#6e47ad'}`,
                  boxShadow: 'inset -18px -20px 28px #0007, 0 14px 22px #0004',
                }}
              >
                <span aria-hidden="true" style={{ position: 'absolute', width: 15, height: 15, borderRadius: '50%', background: '#171526', top: '36%', left: '37%' }} />
                <span aria-hidden="true" style={{ position: 'absolute', width: 15, height: 15, borderRadius: '50%', background: '#171526', top: '36%', left: '53%' }} />
                <span aria-hidden="true" style={{ position: 'absolute', width: 19, height: 19, borderRadius: '50%', background: '#171526', top: '53%', left: '46%' }} />
              </div>
            ) : <TennisPlayerAvatar slot={player.slot} name={player.name} color={colors[player.slot] || player.color} size={240} />}
            <strong>{player.name}</strong>
            <span>P{player.slot + 1}</span>
            <label style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
              {bowling ? 'Ball color' : 'Player color'}
              <input type="color" value={colors[player.slot] || player.color || '#3b82f6'}
                aria-label={`Choose ${player.name}'s ${bowling ? 'ball' : 'player'} color`}
                onChange={(event) => changeColor(player.slot, event.target.value)} />
            </label>
            <span>{player.ready ? 'Ready' : 'Waiting for Ready'}</span>
          </section>
        ))}
      </div>
    </main>
  );
}
