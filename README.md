# wee-sports

## Contributions
We follow the **Google TypeScript Style Guide** for all JavaScript and TypeScript code in this repository. 

## Code Style & Enforcement
We use the `gts` Node.js module to automatically enforce formatting and lint rules. 

Before submitting a Pull Request, please run the following commands locally:

- **Check code style and types:**
  ```bash
  bun run check
  ```
  
## Racket contact prototype

Phone strokes and keyboard J/K now start a swing for player 1 even when the ball
is out of reach. A hit is awarded only when the ball crosses the virtual racket's
hitbox during the striking part of the animation. The same collision path handles
releasing a prepared serve and returning an already-moving rally ball.

To test in the Mac game:

1. Wait for the player and racket models to load.
2. Press **B** to feed a practice ball toward the forehand contact pose, or
   **Shift+B** for the backhand pose. Each feed explicitly resets the ball without
   awarding a point and aims at the player's current position.
3. Press **K** (forehand) or **J** (backhand) as the incoming ball reaches the
   racket. Phone strokes can trigger the same action; default target is player 1.
4. Watch the Hit/Miss feedback. A valid hit sends the ball back across the court.
5. Press **H** to toggle the debug boxes. Amber = inactive, blue = contact window,
   green = this swing made contact. A miss still plays the full animation.

The contact window is initially 20–70% of the animation, configurable via
`CONTACT_START` and `CONTACT_END` in `racketContact.ts`. The hitbox approximates
the outer 55% of the racket along its longest local axis, at the end farthest
from the grip origin, with 0.08 world-unit padding plus the ball radius during
collision checks. This is a heuristic for the supplied asset; use the overlay
to check and tune alignment. It is a generous box, not exact string-bed geometry.

Physics and animation advance together in steps of at most 1/120 second. Collision
sweeps between ball and racket poses to reduce tunneling; rotating poses are
approximated between substeps, not solved as exact continuous mesh collision.
A swing can hit only once, and a player cannot repeatedly hit their own outgoing
shot. Outgoing direction/lift are deterministic prototype values. Ball spin,
realistic impact physics, net collision, and full tennis rules are not added here.

Keyboard swing input is edge-triggered and uses the same command path as the
phone, avoiding duplicate handling of J/K. Hand selection chooses the corresponding
animation direction, but does not swap the existing model's racket to another
physical hand. Player 2 remains available through the game input API rather than
a second paired phone.

Validation: `npm run compile`, `npm run test:physics` (Node 24), and `npm run build`.
Physics tests cover fast ball crossings, moving/scaled rackets, contact timing,
rally-hit state reset, and construction against the actual racket GLB. Visual
hitbox alignment, animation timing, and real-phone timing still need playtesting.

## Assisted ball tracking

**Auto position · both players** is enabled by default in the Mac game panel.
Disable it for WASD movement; keyboard and phone swings work in either mode.
Automatic movement never triggers a swing. Player 2 follows the ball but still
needs a swing command through the game API to return it.

Incoming balls are forecast up to four seconds ahead using the existing gravity
and ground-bounce response. The assistant predicts an intercept at the player's
current depth, subtracts a racket strike offset, and moves sideways toward that
position within the court bounds. Each racket offset is sampled once from the
loaded model at 45% of its left/right swing animation. The nearest candidate
position is chosen; timing and the matching stroke are still up to the player.
Neither racket displacement nor reach is guaranteed for every ball height.

Players slow as they approach the target and hold position during swings. When
the ball travels away, they recover toward center; while waiting for a serve they
hold position. There is no automatic forward/backward chase in this first version.
If you move manually and re-enable assistance, your new depth is retained.
Blue/red ground rings show the desired player positions; H hides them along with
the racket hitboxes. Movement remains speed-limited, so wide or late balls can
still be unreachable. Forecasts do not predict future opponent hits or net impacts.

Test with B / Shift+B practice feeds, then use your phone or J/K for timing. To
check lateral tracking, disable assistance, move sideways with A/D, launch a feed,
and move away from it before re-enabling assistance. Observe the target ring and
try to return the incoming ball. Visual tuning is still needed for the model and
normal phone timing. `npm run test:physics` now includes intercept, bounce, and
steering tests in addition to racket contact tests.

## Player 2 bot

The **Player 2 bot** checkbox enables a simple opponent by default. The bot moves
sideways using assisted positioning (even if you disable Auto position for manual
player-1 movement). For incoming player-1 shots, it predicts arrival at its cached
racket strike poses and chooses a reachable forehand or backhand. It starts the
animation just before arrival, allows one attempt per incoming shot, and must make
the same timed racket contact as you. It has no guaranteed-hit or teleport mechanic.
It does not automatically serve or implement full tennis strategy.

For a quick test, press **N** to feed a forehand ball to the bot or **Shift+N** for
a backhand feed. Each feed bounces once before reaching the sampled strike
pose, so the bot can swing after the bounce and attempt a return. B and
Shift+B still feed your player. Disable Player 2 bot to stop automatic swings and
use player-2 inputs through the game API. An animation already underway finishes
normally when the checkbox is disabled.

Bot timing/reach are prototype settings in `botPlayer.ts`. Tests cover selecting
both strokes, ignoring outgoing/passed/distant balls, and respecting reach. Real
rallies may still fail because of animation alignment, ball height, court limits,
or the existing ball/bounce physics; this is not a complete AI opponent.

## Vitest and GitHub CI

Use Node 24 and install the locked dependencies with `npm ci`. Vite 6 and Vitest 4
are declared in package.json; commit package-lock.json alongside dependency updates.

```sh
npm test               # run all TypeScript tests once
npm run test:watch     # rerun tests as files change
npm run test:physics   # run only test/ TypeScript physics and bot tests
npm run compile        # separate TypeScript check
npm run build          # build game and phone controller
```

`vitest.config.mjs` runs `test/**/*.test.ts` and `server/**/*.test.js` in the Node environment. The physics,
bot, and ball-position tests do not need a browser or WebGL renderer. Tests import
`test` from Vitest and retain Node assert assertions. Browser sensor permissions,
actual phone input, and rendered animation timing still need device playtesting.

`.github/workflows/ci.yml` runs on pushes and pull requests, installs with `npm ci`,
then runs compilation, tests, and the build on Node 24. Test lifecycle hooks no
longer invoke compilation/lint implicitly; lint remains available separately as
`npm run lint` and is not included in this initial workflow. The existing prepare
hook still compiles TypeScript during dependency installation. Workflow execution
on GitHub requires committing and pushing these files; local checks do not run a
remote GitHub Actions job.

## Build assets and relay regression checks

Models live in `public/assets/player.glb` and `public/assets/racket.glb`. Vite
serves them at `/assets/...` during development and copies them into `dist/assets`
when building. Keep source models under public; do not move them back into the
root assets directory or rely on manually copying them into dist.

`npm run build` now also runs `scripts/verify-build.mjs`, which checks that both
built GLBs exist and have valid version/length headers. Missing model assets make
the build (and therefore GitHub CI) fail rather than yielding a broken game.

The server tests now use Vitest and run with `npm test`. The obsolete placeholder
player animation test was removed; current player/racket behavior is covered by
the TypeScript physics tests. Relay coverage checks room routing, invalid messages,
role enforcement, and actual HTTP responses for the game, controller, TypeScript
entry point, and both model files. Continuous-swing and return-suppression tests
are also included. The suite includes physics, bot, trajectory, relay, and continuous-swing tests.

Before merging, run the same commands as CI:

```sh
npm ci
npm run compile
npm test
npm run build
```

Then run the app and perform a real phone-to-game test: open the shared HTTPS
controller link, send a manual stroke, enable/calibrate motion, and try both stroke
types. Automated tests do not exercise iPhone permissions or rendered animation.
Commit the model moves, verification script, test changes, and package/config
updates on the feature branch, push, and verify the PR's GitHub CI result. Do not
merge based solely on local checks.

## Court-targeted shot trajectories

Successful racket contacts now aim at a safe landing point rather than applying
one fixed velocity everywhere. Player 1 aims into negative Z; player 2 aims into
positive Z. The preferred depth is 8.5 units, with deterministic forehand/backhand
placement kept inside X ±2.8. A central target at depth 7 is the fallback.

`shotTrajectory.ts` solves launch velocity in the existing units per 60 Hz tick,
then simulates the first bounce using 1/120 s substeps. It searches flight times
from 1 to 2.5 seconds, requiring a first landing inside the opposite court's safe
area and at least 0.9 units of ball-center height across the net (current net top
0.55 plus radius and clearance margin). It compensates for semi-implicit gravity.
This applies to rally returns and contact that releases a prepared serve; it does
not implement regulation service boxes. Practice feeds retain their own setup.

A yellow ring shows the intended landing point, and Hit feedback reports its X/Z.
H toggles the ring alongside the other debug markers. Test with B/Shift+B, your
phone, and the bot. Keyboard and bot targets remain repeatable; calibrated phone
tilt can vary horizontal placement as described below.
A later opponent contact changes the ball's trajectory, so its original target
only applies if that shot is allowed to land. No collision with the net mesh was
added: the planner checks clearance proactively. Impossible/invalid contact
positions report no safe trajectory rather than launching invalid values.

Tests cover 144 combinations of side, stroke, and contact location/height, plus
invalid inputs and simulation at 30/60/144 FPS. They verify first-bounce court
placement and clearance, not a measured real-play success rate. Visual playtesting
is still needed for bot reach, racket timing, and feel.

## Forehand height adjustment

Forehands now lower the hand/racket together by up to 0.22 world units at the
middle of the stroke, easing to zero at either end. The authored backhand path
is unchanged. The offset is applied to the bone containing both Hand and
HandSocket, in world-down direction despite model rotation/scale, and removed
before every mixer update so it does not accumulate across frames or strokes.
Cached strike offsets, bot reach checks, and practice feeds use the adjusted pose.
Tune `DEFAULT_FOREHAND_DROP` in `forehandPose.ts`, or the per-player `forehandDrop`
option, after checking the blue contact box against the ball in play. This is a
runtime pose correction, not an edit to the GLB animation. Refresh the Mac game,
try B then K, and compare Shift+B then J to verify backhands remain appropriate.

## Gentler phone swings (sensitive v7)

The classifier now starts a candidate at 200 °/s rotation magnitude (previously
250) and accepts peaks from 280 °/s (previously 350). Direction thresholds are
roughly 20% lower for both stroke types and playing hands; strong left-backhand
support now uses −750 instead of −850 °/s. Direction dominance, minimum duration,
repeated-sample checks, and return suppression remain. Early and completion
modes share the same candidate start/peak limits.

Refresh the phone controller to load `gyro-handed-sensitive-v7`, choose the
correct playing hand, recalibrate, and test gentler strokes. These defaults may
admit more accidental motions; keep Suppress return motions enabled initially.
This changes phone recognition only, not racket hitbox size or collision timing.

## Phone-angle shot aiming

Refresh both game and controller. Enable motion and allow orientation access,
then complete gyro calibration with the phone still. Pick it up in your normal
portrait ready grip, expand **Phone-angle aiming**, and tap **Set neutral aim**
before recording. This separately calibrates your grip's sideways tilt. Use
**Invert left/right** if aiming feels reversed, and reset neutral after changing
grip or screen orientation. The neutral pose must be set again after reload.

The phone samples sideways tilt near the detected swing peak. A 3° dead zone
keeps center steady; ±65° maps to full left/right aim. The game maps this to
horizontal landing targets up to ±2.5 world units, with random spread of ±0.25.
Existing trajectory checks still require court placement and net clearance;
an unsafe preferred target can fall back to a centered shot. Forward/back tilt relative to neutral controls depth: ±45° spans landing
distances of 5–9.5 world units from the net, with neutral at 7.25. Positive beta
change aims deeper; negative aims shorter. Flight remains assisted; measured swing power now adjusts speed and depth (see below). The yellow ring shows the planned landing point.

Missing calibration, denied orientation access, or a sample older than 250 ms
uses standard placement. This adds no extra wait for classification. The optional
`aimX` and `aimDepth` message fields are validated in [-1, 1] by the phone connection and relay.

This is relative tilt aiming, not full 3D racket tracking: the racket animation
does not yet follow phone orientation. Full racket alignment would need a
neutral orientation quaternion, a phone-to-racket mounting offset, and continuous
orientation updates applied relative to the player's ready pose. Keep animation
in charge of the arm while applying that relative rotation to the racket, and
limit tilt initially so contact remains playable. Absolute phone position is
not measured by this calibration. Physical iPhone aiming still needs playtesting.

## Swing power and out shots

Detected swings send optional normalized `power` (0–1), derived from peak gyro
rotation magnitude: 280°/s is low power and 1,400°/s reaches full power. This is
an angular-speed proxy, not measured racket-head velocity. Early detection uses
only the peak observed when it fires; completion mode sees the full stroke.
Manual test buttons, keyboard input and the bot keep the legacy assisted shots.

Power adds -1 to +4 world units to the tilt-selected landing depth and requests
a shorter flight for harder shots. Net-clearance validation can lengthen the
flight. Powered shots may land beyond the baseline; they are not redirected to
the centered fallback merely to keep them in bounds. Existing scoring still
handles faults. The phone's last-swing status shows power and peak rotation rate.

Automatic player movement and bot strokes stop for a predicted first landing
outside the real court bounds (half-width 4.115, half-length 11.885). In-bounds
shots retain tracking even if they later bounce beyond the baseline. Predictions
are recomputed after trajectory changes; actual first-bounce status takes over
once the ball lands. Manual movement remains available. Tune power after phone
playtesting; ready-pose calibration affects aim, not this gyro power mapping.

## Tracking short shots

Assisted positioning now moves in both court directions. It searches incoming flight and the flight after the first bounce for a
strike-height target, rather than waiting for
every ball to reach the player's current baseline depth. It prefers reachable targets near racket height that require little movement,
with at least 150 ms to prepare (and 150 ms after a predicted bounce for bounced targets). The selected stance stays fixed until a
new hit or reset, avoiding movement caused by a constantly changing intercept. Practice feeds preserve the stance used to calculate their arrival.
Players may start moving before the bounce, and the bot may volley before the first bounce or return after one bounce. It returns to the ready position on outgoing shots. Predicted out shots still stop assisted movement and bot
strokes. This improves pursuit of short legal shots, but does not guarantee a
return: movement speed, stroke timing, and racket contact still limit reach.

Sideline tracking clamps the player's feet to the movement area while allowing
up to 0.45 units of lateral racket-center error, matching bot stroke selection.
It also uses the bot's 0.5-unit strike-height tolerance. A reachable ball is no
longer rejected merely because exact racket-center alignment would place the
player beyond a sideline. Targets allow volleys or one-bounce returns and stop before a second bounce.

Opening serves (the racket contact releasing a prepared serve) retain safe
court placement even at maximum phone power. Aim still selects the target, but
power's extra depth and faster flight apply only to rally returns. This prevents
an opening fault from immediately stopping the bot's chase. This remains arcade
serve assistance, not regulation service-box placement.

## Volleys

Incoming balls can be hit before their first bounce. Assisted tracking considers
both airborne volleys and one-bounce returns, and the bot can swing with zero or
one bounce. Ordinary racket contact is still required. Predicted out shots remain
excluded from assisted pursuit; second-bounce balls are not bot return targets.
Practice feeds retain their one-bounce setup and fixed player stance.
