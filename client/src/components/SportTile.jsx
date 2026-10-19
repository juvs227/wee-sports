import { playerRange } from '../lib/sports.js';
import { SparkleIcon } from './icons.jsx';

const ACTION_LABEL = {
  idle: 'Play',
  retry: 'Try again',
  opening: 'Opening lobby…',
  connecting: 'Connecting…',
  offline: 'Server offline',
};

/**
 * One Wii-Channel-style tile. An open sport's whole tile is the button (a
 * stretched ::after on the action), so it is an easy target from across a
 * room. A sport that isn't open has no button at all: nothing on the page
 * looks clickable unless it does something.
 *
 * state: 'idle' | 'retry' | 'opening' | 'connecting' | 'offline'
 */
export function SportTile({ sport, state = 'idle', error = null, onPlay }) {
  const { Icon } = sport;
  const errorId = `${sport.id}-error`;
  const label = ACTION_LABEL[state];

  return (
    <article
      className="tile"
      data-open={sport.open}
      style={{ '--tint-a': sport.tint[0], '--tint-b': sport.tint[1] }}
    >
      <div className="tile__art">
        <Icon className="tile__icon" />
      </div>
      <div className="tile__body">
        <h3 className="tile__name">{sport.name}</h3>
        <p className="tile__blurb">{sport.blurb}</p>
        <p className="tile__meta">{playerRange(sport.players)}</p>
      </div>
      <div className="tile__foot">
        {sport.open ? (
          <button
            type="button"
            className="btn btn--primary tile__action"
            onClick={onPlay}
            disabled={state !== 'idle' && state !== 'retry'}
            aria-label={`${label}: ${sport.name}`}
            aria-describedby={error ? errorId : undefined}
          >
            {label}
          </button>
        ) : (
          <span className="tag">Coming soon</span>
        )}
      </div>
      {error ? (
        <p id={errorId} className="tile__error" role="alert">
          {error}
        </p>
      ) : null}
    </article>
  );
}

/** Reserved for the AI game creator (Use Case 7). Not interactive yet, and says so. */
export function CreateTile() {
  return (
    <article className="tile tile--create" data-open="false">
      <div className="tile__art">
        <SparkleIcon className="tile__icon" />
      </div>
      <div className="tile__body">
        <h3 className="tile__name">Make your own</h3>
        <p className="tile__blurb">Describe a sport and Wee Sports builds it on our SDK.</p>
        <p className="tile__meta">For game creators</p>
      </div>
      <div className="tile__foot">
        <span className="tag">Coming later</span>
      </div>
    </article>
  );
}
