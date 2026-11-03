# Tennis scoring, controls and practice

## Match formats

**Full match** uses best of three tie-break sets: 0/15/30/40, deuce and advantage;
win six games by two, with a seven-point tie-break at 6–6. The same server keeps
the whole standard game. Tie-break service is one point, then two points each;
the first tie-break server receives in the following set. Two sets wins the match.

**Quick match** is a standalone seven-point tie-break, win by two. It has numeric
points and the same one-then-two service rotation. It is clearly labelled as a
short format, rather than a complete regulation best-of-three match.

The scoreboard separates points/games/sets, names the server and retains the
last result. Completed matches reject further swings. **New match / Play again**
resets the selected format. Selecting the same format does not itself erase a score.

## Serving and court rules

The painted court, net profile, shot planner and net collision share dimensions
in `src/Tennis/tennisRules.ts`. The service lines are 6.4 m from the net; the net's
center is 0.914 m high and its posts are 1.07 m. The collision uses a swept crossing
of the net plane, so faster balls cannot skip through a low net collision.

The service side alternates deuce/ad after each point, including tie-breaks.
The assisted server stands behind the baseline, with the ball still released
only by the authored racket-contact animation. The service planner selects the
opposite diagonal service box. Receivers automatically move forward during the
serve when movement assistance is on, so legal short serves remain reachable.

- An attempted service animation that ends without racket contact is a fault;
  rejected/not-ready inputs and paused/cancelled animations are not attempts.
- A first service fault keeps the point, server and side and offers a second serve.
- A second fault awards one point to the receiver.
- A serve clipping the net is judged at its landing: correct box means a let;
  an invalid landing remains a fault. A let repeats the same service attempt.
- A net-touch serve contacting the receiver before landing is also a let.
- Returning an untouched serve before its first bounce awards the server the point.
- A rally net collision stays physically live until the bounce/return resolves it;
  a tape clip can pass over. A first landing outside the opponent's court or a
  second bounce ends the point. A ball touching a court/service line is in.

The TV publishes `prepare`, `serve`, `rally` or `complete` to the phone, so
"You serve next" precedes "Your serve". The brief post-point pause has no repeated
numeric countdown. Match-start countdown audio is a separate lobby feature.

## Predictable placement and assistance

Rally shot placement no longer rolls a random left/right choice. It uses the
stroke side and a bounded timing value captured when the swing arrives, before
animation assistance changes the contact timing. Earlier intent favors a wider
angle, later intent a straighter placement. Given identical state and input,
the planner returns the same target and trajectory. The safe-arc solver and real
racket-contact checks remain in use; power remains bounded.

**Beginner** assistance offers a 750 ms early-input window, gentler pace and
narrower angles. **Standard** buffers early input for up to 650 ms. Buffered
animations wait for a reachable authored racket path rather than a timer alone.
Movement and timing assistance can be toggled independently. Bot difficulty is
also independent: the Beginner bot moves more slowly and returns gently;
Standard retains its usual movement and power. Both bots must physically contact
the ball and cannot manufacture a successful hit.

Miss messages describe the known situation (early, late, out of reach, unfinished
stroke, or unavailable contact), rather than always advising an earlier swing.
Point messages include out, second bounce, net, double fault or illegal serve
return. These messages do not claim a precise timing diagnosis when the game has
insufficient evidence.

## Practice

Practice reuses the authored forehand/backhand poses and supports **Right** and
**Left** hands. Choose forehand, backhand or alternating feeds. Feeds repeat;
the TV counts attempts, accepted racket returns, current streak and best streak.
Simple ground/landing markers are visible while practicing. The bot does not
return practice balls, even if lobby snapshots leave its bot-enabled flag on.

Practice never awards match points. Returning to the match preserves its score,
format and service side; a pending second serve is retained. If practice began
during a rally, the current point restarts with a serve. A completed match remains
completed. **New match** is the explicit action that clears its score.

## Contact events and diagnostics

`World.onGameEvent({kind, player, reason?, swingId?})` emits actual events:
`serve`, `hit`, `bounce`, `fault`, `let`, or the highest scoring result among
`point`, `game`, `set`, `match`. Score polling never replays audio.
`World.onBallHit` remains the actual-contact vibration callback.

`World.onStrokeResult({id, player, result, reason, receivedToContactMs?})` correlates
a phone swing with its TV result. `receivedToContactMs` is measured with one
monotonic TV clock and exists only on successful contact. Rejected, missed,
replaced or cancelled inputs do not borrow the timing of a later hit. This duration
excludes phone detection and network delivery; it is not total motion-to-screen latency.

## Scope and verification

The existing assisted movement, authored racket animation and bounded power are
retained. This remains a motion party game: it does not simulate body/racket
violations, foot-fault judging of free-form real-world movement, changing physical
court ends, weather, spin or a full officiating system. Serving, scoring and net
behavior now have explicit, testable state transitions rather than visual-only rules.

Offline checks cover both service sides/players, first/second faults, lets,
serve-volley penalties, net tunnelling, boundary contact, legal service trajectories,
repeatable aim, tie-break rotation, quick/full completion, practice score preservation,
left/right-hand contact, diagnostic ID ownership and existing frame-rate regressions.
No browser, game server, tunnel or physical phone session is launched by those tests.

References:
- [USTA serving rules](https://www.usta.com/en/home/improve/tips-and-instruction/national/tennis-serving-rules.html): diagonal service boxes, alternating sides, two attempts and lets.
- [ITF-hosted 2026 ATP rulebook, Rules of Tennis](https://www.itftennis.com/media/15604/atp-2026-rulebook.pdf): court/net dimensions; scoring; service order; lets; ball on a line; loss of point.
- [Microsoft XAG 108](https://learn.microsoft.com/en-us/xbox/accessibility/xbox-accessibility-guidelines/108): independently configurable difficulty and assistance.
