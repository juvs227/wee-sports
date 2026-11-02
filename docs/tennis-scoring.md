# Tennis scoring and serve flow

The match uses **best of three tie-break sets**. Points in a standard game are
0, 15, 30, 40, deuce and advantage; a player must win two points from deuce.
The same player serves for the entire standard game. Service changes at the
end of the game, including across set boundaries.

A set needs six games and a two-game lead, or a tie-break at 6–6. The tie-break
uses numeric points, first to seven with a two-point lead. Its first server
serves one point, then the players alternate two serves each. The tie-break's
first server receives in the next set. Winning two sets ends the match;
further swings and physics updates cannot add points until **Play again**.

The scoreboard separates points, games and sets, keeps the completed set
scores, and names the next server. The large numeric countdown is removed.
There is a short 1.2-second pause after a point so its result can be read; the
player then serves when ready. Scoring calls remain visible alongside the
stroke feedback, including when the solo bot starts its next serve.

The homepage lobby forwards a compact TV-owned status to the phone: `prepare`
during the pause, `serve` when ready, `rally`, or `complete`. The phone says
"You serve next" before "Your serve", and shows the match result at the end.
Only changes are published; score polling does not repeatedly broadcast a lobby
snapshot. A completed match rejects late phone swings, and Play again restores
the initial serving state without requiring recalibration.

## What remains arcade-style

This change corrects scoring and service rotation, not every physical rule of
competitive tennis. The existing authored swing/contact paths, bounded motion
power, assisted movement and shot planning are preserved. Serves still launch
through the existing racket-contact flow, without alternating diagonal service
boxes, first/second faults, foot faults, or service lets. Court ends do not
change. Net collision, ball-line contact geometry, and receive-before-bounce
rules need a coordinated physics/rules pass before describing the game as a
full tennis simulation. The existing ball code awards a point for a first
landing outside the opponent's court or a second bounce.

## Game events

`World.onGameEvent(event)` emits an actual occurrence, not a score poll:

- `serve`: the racket releases a held serve.
- `hit`: a rally racket contact.
- `bounce`: a descending ball impacts the ground; `player` identifies its last hitter.
- `point`, `game`, `set`, `match`: only the highest result of a scored point,
  with `player` identifying the winner. A match-ending point emits `match` once.

Events have `{ kind, player: 1 | 2 }`. `World.onBallHit` still runs for serve and
rally contact for the existing phone vibration bridge. Reading `getScore()`
does not emit events; reconnecting or polling cannot replay score sounds.

## Rule references

- [ITF-hosted 2026 ATP rulebook, ITF Rules of Tennis](https://www.itftennis.com/media/15604/atp-2026-rulebook.pdf): Rules 5–7 (game, tie-break, set and match scoring) and Rule 14 (service order).
- [ITF tennis glossary](https://www.itftennis.com/en/about-us/organisation/tennis-glossary/): deuce, advantage, set, tie-break and best-of-three format.

Verification uses pure scoring tests and the shipped models' animation/contact
code without a browser, live server, tunnel, or human two-player session.
