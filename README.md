# Wee Sports

`update-homepage` combines the homepage/lobby/reconnect work with tennis from
`main` and the team's scoring, model, and game-logic updates from `base-game`.

Comparison checked October 28: `main` is still at `3a5a72a` and was already
included in this branch. `base-game` (`08e121f`) adds scoring and updated assets;
those source changes are merged here. `game-menu` adds an independent Escape-key
pause, which is kept separate so it cannot resume a game that the lobby paused.
Tutorial voting remains separate work; its old protocol needs adapting before merging.

## Run the combined app

Use Node 24 and the npm lockfile. Install Cloudflare’s tunnel client once on macOS:

```sh
brew install cloudflared
npm ci
npm run dev
```

For Windows or Linux, use the [official cloudflared downloads](https://developers.cloudflare.com/tunnel/downloads/).
`npm run dev` builds the app, starts a temporary secure phone connection, and serves
the built homepage, lobby, tennis and bowling together. Open `http://localhost:5173`
on the TV/laptop; its lobby QR automatically uses the secure phone address. There
is no separate `:3001` server or tunnel address to copy into configuration.
`npm run dev:phone` is an alias for this same flow.

Keep that terminal open while playing. The temporary public URL changes with each
session and stops when the session stops. Scan the current QR when starting a new
session. This uses a [Cloudflare Quick Tunnel](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/),
intended for development and device testing; anyone with the temporary URL can
open the app. No Cloudflare account or domain is required.

Teammates can run these same commands on their own computers; each running
session gets its own link and lobbies. Sharing a running session's link connects
everyone to that session, so its host computer must stay on. The launcher checks
the public connection before showing the QR and monitors it during play. A
temporary interruption hides the QR until the link recovers; if the tunnel stops,
restart the session and scan its new QR. This is not a permanent team deployment.

For local editing with Vite, use `npm run dev:local`. This does not create a secure
phone connection. The TV can use local HTTP, but real phone sensors need the
secure phone page. Do not bypass browser certificate warnings or disable browser
security. For an existing trusted deployment/tunnel, `PUBLIC_GAME_URL` supplies its
HTTPS origin to the server; its QR is discovered at runtime.

1. Choose **Tennis** or **Bowling** on the TV/laptop and scan its QR code.
   Tennis has **two playing seats**: one phone plays the bot, or two phones play
   each other. Bowling has **four playing seats**, taking turns through ten frames.
2. Tap **Calibrate** on the phone, allow motion access, and place it still on a
   table. Calibration waits for fresh gyroscope readings and a continuous still
   window. Then each player presses **Ready**. The button fallback is available
   inside controller settings for devices without sensors or desktop testing.
3. The TV presses **Play**. The countdown and game fill the screen. Supported
   browsers enter native fullscreen from this click; otherwise the game fills the
   browser window. **Exit full screen** / **Windowed view** and **Full screen**
   switch views without restarting the game. Calibrated phone motion starts when
   the countdown ends.
4. In tennis, P1 swings to serve, then each player swings as the ball approaches
   their side. If a grip does not work with the team’s automatic classifier,
   controller settings offer an explicit forehand/backhand mapping.
5. In bowling, use the phone to aim, make an underhand swing for power, and
   deliberately turn your wrist during the forward swing to add curve. Small
   wrist movements stay straight; motion curve is capped for gentler control.
   The controller shows the measured release.
   Keep a firm grip; never let go of the phone. Only the current player can roll.
   Watch the lane for pinfall, the scorecard, final rankings and **Play again**
   after the tenth frame. Sliders and the Roll button remain a fallback.
6. A dropped connection pauses the game. Seats are held for 60 seconds. Reloading
   a phone requires calibration again before play resumes; a temporary network
   reconnect keeps calibration. Leaving an active seat ends the match and returns
   everyone to the lobby. Closing the lobby ends it for everyone.

The default tennis sensor mode uses the team's **fast confirmation** from
`experiment/early-swing-prediction` (`80ec8f7`). It confirms the direction after
the swing peak and sends one shot per physical motion window. Follow-through
filtering no longer demands 250 ms of near-zero rotation, which left the old
controller stuck after the first swing in the team's actual recordings. The
five recordings on `juve-swing-classification` now replay all 19 expected strokes
through calibration, DeviceMotion processing and gameplay delivery. See
[fixture provenance](server/fixtures/team-motion/README.md). Early prediction
remains an explicit experimental option; it can misclassify the backswing.

Calibration and motion are the main phone flow. Buttons are tucked under a
fallback disclosure for connection testing or devices without sensors. Tennis
still uses the team's recognized forehand/backhand gestures to drive the racket
animation; it does not claim one-to-one tracking of the phone's 3D position.

The phone shows a reacting racket or a ball that travels toward the TV marker
when a roll is accepted. A tennis contact sends brief vibration to the phone
whose racket hit the ball, on browsers that support vibration. No sound is played.
The controller requests a screen wake lock after setup while connected and
visible, including the lobby wait. Browser and battery settings can still deny
or release it; controller help shows the current status. Vibration is not
available in every browser, including Safari on iPhone. See the browser support
for [screen wake locks](https://developer.mozilla.org/en-US/docs/Web/API/WakeLock/request)
and [vibration](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/vibrate).

The browser still asks for motion permission after the secure page opens; the
app cannot grant that permission on the player’s behalf. Tap **Calibrate** directly
in Safari or Chrome on the phone. See [the browser motion-permission requirements](https://developer.mozilla.org/en-US/docs/Web/API/DeviceMotionEvent/requestPermission_static).
Live diagnostics are under **Motion not working?**. A desktop without a gyroscope
correctly fails sensor calibration. Automated recordings and simulated motion
verify code behavior; **actual phone hardware, permission prompts, and game feel
still require device playtesting**.

Protocol v3 adds controller setup and server-assigned player numbers. Bowling
adds authenticated roll delivery and TV-owned turn snapshots. The server stamps
the player's seat and match ID, rejects duplicate/out-of-turn rolls, and waits for
an actual game acknowledgement. Reload old pages after updating. The internal
post-countdown phase is still named `tutorial`; tutorial voting is separate work.

Tennis keeps the team's models, preset strokes, trajectory calculation and
scoring. Assisted contact timing and stroke-aware tracking compensate for phone
recognition delay; a hit still requires the ball to cross the animated racket.
P1 serves each point; regulation service turns, service boxes and a full tennis
match-end/rematch flow remain future work.

Bowling reuses the lobby, calibration, controller bridge and Three.js, with a
separate cannon-es rigid-body simulation suitable for a ball and ten pins. See
[bowling rules, physics decisions, sources, and tests](docs/bowling.md).

**Recovery limit:** refreshing the TV restores the lobby but starts a fresh local
game. Scores and physics remain local to that page; server-persisted match
recovery is future work. Keep the TV tab open during play. Network drops without
page reload preserve both games, including a rolling bowling ball.

Standalone pages remain at `/game.html`, `/bowling.html` (local button practice),
and `/controller.html?room=<room-id>` (tennis relay). `npm run build` builds all
four pages and checks model assets. `npm run preview` serves the built app locally
with both relays. `npm start` runs the local combined server without creating a
tunnel, like `npm run dev:local`. Re-run `npm run dev` after source changes to
rebuild the phone-play session.

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
  
## Racket contact and phone timing

Phone strokes and keyboard J/K start an animation, but a hit still requires the
ball to cross the animated racket's hitbox during its strike window. The same
collision path releases a prepared serve and returns a moving rally ball. In a
homepage lobby, paired phones control P1 and P2; standalone prototype links keep
their original Player 1 relay. P1 swings to serve each point.

With **Automatic movement** enabled, phone/button inputs can be buffered for up
to 450 ms while an incoming ball approaches. The game samples the shipped racket
animations and chooses a remaining wind-up that can meet the ball. This adjusts
the animation timing; it does not move the ball or guarantee a hit. Swing as the
ball approaches your side. A stroke received after the ball has passed can miss.
Pausing, disconnecting, starting a new point, or feeding a practice ball clears
prepared inputs so they cannot replay later.

To test on the TV/laptop:

1. Wait for the player and racket models to load.
2. Press **B** for a forehand practice feed or **Shift+B** for a backhand feed.
   A feed resets the ball without awarding a point and targets the current player
   position. **N** / **Shift+N** feed Player 2 instead.
3. Use a phone/button stroke as the ball approaches your side, or **K** (forehand)
   / **J** (backhand) for Player 1's ordinary keyboard swing animation.
4. Watch Hit/Miss feedback. **H** toggles contact boxes: amber = inactive,
   blue = strike window, green = contact made.

The forehand contact window is 20–70% of the animation; the backhand window is
10–80%. The hitbox approximates the outer 55% of the racket along its longest
local axis, at the end farthest from the grip, with 0.16 world-unit padding plus
the ball radius. This is a gameplay box around the supplied asset, not exact
string-bed geometry. Hand selection chooses the animation direction; it does
not move the model's racket to its other physical hand.

Physics and animation advance at a fixed 120 Hz, independent of rendering frame
rate. Collision sweeps between ball and racket poses to reduce tunneling. A swing
can hit only once, and a player cannot hit their own outgoing shot again. Returns
use the team's court-targeted trajectory calculation and stroke-side variation;
physical spin, exact racket impact response, and net collisions remain outside
this tennis prototype.

Physics steps now refresh only the racket pose needed for contact checks, rather
than forcing the whole scene graph to update at 120 Hz. Normal rendering still
updates the scene. A solo serve-and-bot test checks contacts with the shipped
models and verifies that static scene objects receive no redundant physics-step
updates. This reduces local work; it does not remove internet connection delay.

A first bounce outside the opponent's court, or the second bounce after a valid
landing, ends the point immediately and awards it once. The ball then waits for
P1's next serve. It no longer stays live through repeated bounces while rolling
to a stop. Regulation service turns, service boxes, and a complete tennis match
format remain future work.

Validation uses the actual shipped player/racket GLBs: both players, both hands,
both strokes, several shot directions, input arrival from 0–300 ms before the
strike plane, consecutive returns, late misses, pause cancellation, scoring, and
30/60/144 FPS. Run `npm run test:physics`, `npm run compile`, and `npm run build`.
Real-phone recognition/network delay and rendered feel still need device playtesting.

## Assisted ball tracking

**Automatic movement** is enabled by default under **Court controls**. Disable it
for WASD movement. Tracking itself does not trigger a human's swing; the solo
Player 2 bot has its own stroke logic.

Incoming balls are forecast up to four seconds ahead using the current gravity
and bounce response, stopping at the point-ending second bounce. Tracking predicts
an intercept at the player's current depth, subtracts the racket strike offset,
and moves sideways toward that position within court bounds. Before a stroke is
chosen it uses the nearest left/right candidate; a prepared or active stroke
uses that stroke's offset instead. Offsets are sampled from the loaded models.

Players slow near their target and continue ordinary speed-limited foot movement
during an assisted swing until contact. They recover toward center when the ball
travels away and hold position while waiting for a serve. There is no automatic
forward/backward chase; manually changing depth is retained when assistance is
re-enabled. Wide, late, or vertically unreachable balls can still miss.

**H** shows the blue/red target rings with the racket boxes. To inspect tracking,
disable assistance, move sideways with A/D, feed a practice ball, move away, then
re-enable assistance. Forecasts do not predict future opponent hits or net impacts.
The physics tests cover intercepts, bounce limits, steering, actual-model stroke
alignment, human rallies, and bot returns.

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
