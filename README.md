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
npm run test:physics   # alias for the current Vitest suite
npm run compile        # separate TypeScript check
npm run build          # build game and phone controller
```

`vitest.config.mjs` runs `test/**/*.test.ts` in the Node environment. The physics,
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
