# Wee Sports

`update-homepage` combines the homepage/lobby/reconnect work with tennis from
`main` and the team's scoring, model, and game-logic updates from `base-game`.

Comparison checked October 28: `main` is still at `3a5a72a` and was already
included in this branch. `base-game` (`08e121f`) adds scoring and updated assets;
those source changes are merged here. `game-menu` adds an independent Escape-key
pause, which is kept separate so it cannot resume a game that the lobby paused.
Tutorial voting remains separate work; its old protocol needs adapting before merging.

## Run the combined app

Use Node 24 and the npm lockfile:

```sh
npm ci
npm run dev
```

Open `http://localhost:5173` for the homepage. One server serves the homepage,
Socket.io lobby, tennis, and swing relay; no separate `:3001` process is needed.
For a phone tunnel, set `NGROK_HOST` to the tunnel hostname before starting the
server. `VITE_PUBLIC_URL` can also set the QR's public origin. Real phone motion
requires HTTPS. Same-Wi-Fi joining still works over HTTP.

1. Choose Tennis on the TV/laptop. Scan its QR code with one or two phones.
   The first phone is P1 (blue), the second is P2 (red). A single phone plays
   against the bot. Seats 3 and 4 are spectators and must also press Ready.
2. On each controller, choose a playing hand, **Enable motion**, then **Calibrate**
   with the phone still for two seconds. Alternatively choose **Use button controls**.
   Ready is disabled until that phone finishes setup. Failed/stale calibration
   cannot mark it ready. Use HTTPS on physical phones for motion access.
3. Everyone presses **Ready**, then the TV presses **Play**. The same controllers
   stay loaded through the countdown, preserving calibration and hand selection.
   For motion play, tap **Start swings** on each phone. For buttons, use Forehand
   and Backhand. P1's first swing serves; P2 returns when the ball reaches the racket.
4. The server assigns each stroke to the authenticated P1/P2 seat and sends it
   only to that lobby's TV. The bot is disabled when P2 joins. The TV shows both
   names, points, and games won using the team's scoring system.
5. A dropped connection pauses the same running world. Seats are held for 60 seconds.
   Reloading a phone requires controller setup again before play resumes. After
   reconnecting, motion users tap **Start swings** again. An explicit P1 or P2
   Leave ends that match and returns the remaining group to the lobby. Closing
   the lobby ends it for everyone.

Protocol v3 adds controller setup and server-assigned player numbers. Reload old
pages after updating. Its post-countdown phase is still named `tutorial` internally,
but displays tennis. The homepage lobby owns membership/readiness/reconnects;
a same-origin bridge connects the existing controller and game without another
lobby. The standalone `/swings` prototype relay remains available.

This is the team's tennis prototype: automatic positioning, preset strokes,
existing ball physics and scoring. P1 serves each point; regulation service turns,
service boxes and a full match-end/rematch flow are not implemented. The new serve
setup places the held ball at the existing racket strike pose; normal collision and
trajectory code still decide the hit. No classifier thresholds or ball physics were
retuned for the lobby integration.

**Recovery limit:** refreshing the TV restores the lobby but starts a fresh tennis
world. Scores/points are still local to that page; authoritative match recovery and
restarting an interrupted point remain future work. Direct prototype URLs keep the
existing relay behavior and do not participate in lobby recovery.

Standalone prototypes remain at `/game.html` and `/controller.html?room=<room-id>`.
`npm run build` builds all three pages and checks model assets. After building, `npm run preview`
serves the built app locally with both relays (local preview, not a deployment setup).
`npm start` runs the same combined app as `npm run dev`.

## Checks

```sh
npm run compile
npm test               # game/relay Vitest suite, then platform node:test suite
npm run build
npm run stress -- --lobbies 10,25 --seconds 5
```

See [platform reconnect and stress-test notes](docs/platform.md). The recorded
stress benchmark predates this merge and measures lobby traffic only, not tennis.

## Contributions
We follow the **Google TypeScript Style Guide** for all JavaScript and TypeScript code in this repository. 

## Code Style & Enforcement
We use the `gts` Node.js module to automatically enforce formatting and lint rules. 

Before submitting a Pull Request, please run the following commands locally:

- **Check code style and types:**
  ```bash
  npm run check
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
physical hand. In homepage lobbies, the second paired phone controls Player 2;
standalone prototype links retain their original Player 1 relay.

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
a backhand feed. The bot should swing and attempt to return it toward you. B and
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

`vitest.config.mjs` runs `test/**/*.test.ts` and `server/*.test.js`; platform tests in `server/src` and `server/scripts` run separately through node:test in the Node environment. The physics,
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
phone, and the bot. Targets and power are deliberately repeatable while tuning.
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
middle of the stroke, easing to zero at either end. The team’s updated backhand pose rises from a lower start to a higher finish. The offset is applied to the bone containing both Hand and
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
