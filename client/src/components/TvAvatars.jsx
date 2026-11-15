import { TennisPlayerAvatar } from './PlayerAvatar.jsx';

/** Brief laptop-only player reveal between the tutorial and the match. */
export function TvAvatars({ lobby }) {
  const readyCount = lobby.players.filter((player) => player.ready).length;

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
        <p className="eyebrow">Tennis players</p>
        <h1>Get ready to play!</h1>
        <p>{readyCount}/{lobby.players.length} ready. Press Ready on your phone to start.</p>
      </div>
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
            <TennisPlayerAvatar slot={player.slot} name={player.name} color={player.color} size={240} />
            <strong>{player.name}</strong>
            <span>P{player.slot + 1}</span>
            <span>{player.ready ? 'Ready' : 'Waiting for Ready'}</span>
          </section>
        ))}
      </div>
    </main>
  );
}
