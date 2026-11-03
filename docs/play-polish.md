# Play-screen and response polish — November 2, 2026

Implemented on `update-homepage`. The team's models, stroke classifier, racket
hitboxes and gravity remain in place. No changes were merged into `main`.

## Final follow-up: setup, direction and appearance

- **Switching games:** recent same-address calibration now reuses the already
  measured gyro zero after at least ten fresh finite readings over 150 ms. The
  player can keep holding/moving the phone; this checks sensor delivery instead
  of demanding another still-phone calibration. The original two-hour expiry is
  retained. The controller URL also stays stable during an in-place sport change,
  which cancels unfinished inputs while preserving its live sensor session.
- **New link:** browser permissions and local storage belong to each website
  origin. A different tunnel address cannot inherit the old address's setup.
  One **Enable motion** tap requests permission and starts initial setup
  automatically; no second calibration tap is needed. A permanent HTTPS address
  keeps this consistent. Explicit **Reset motion setup** remains available in
  settings if the saved zero drifts.
- **Power setup:** comfortable-swing rehearsal is no longer offered after normal
  setup or during play. Default power is ready immediately; optional tuning is
  collapsed under advanced controller settings.
- **Bowling motion:** only forward underhand pitch charges and releases a roll.
  Backward motion neither fires nor adds power/curve to the subsequent forward
  swing. A deliberate reversal cancels the unfinished delivery. Small negative
  readings in the deceleration deadband do not add power. Keep the documented
  grip: screen up, top of phone toward the TV.
- **Bowling direction:** aim, hook and aiming preview now use screen-left/right
  consistently. The lane camera faces world +Z, making world -X appear right;
  conversion happens at the scene boundary. Rigid-body physics is unchanged.
- **Bowling scores:** name and total share one compact row, with one frame/ball
  indicator and one result/turn cue. The full ten-frame scorecard is collapsed.
  An asterisk marks strike/spare totals waiting for bonus rolls. Totals still
  count completed frames; scoring arithmetic was checked and left unchanged.
- **Dark mode:** home, lobby, phone and embedded UI surfaces follow the device
  preference initially. A sun/moon button saves an explicit light/dark choice on
  that device/address. Same-origin frames synchronize even when browser storage
  is blocked. Theme changes do not alter the 3D arena or gameplay.

### Tennis design review — not applied to the game

Four isolated previews are in [the design review](previews/tennis-designs.html).
With the development server running, open `/docs/previews/tennis-designs.html`.
They reuse the team's court, net and player modules without live game logic.

1. **A — Park club (recommended):** green surroundings and one dark score strip;
   the smallest departure from the current game.
2. **B — Night match:** lit court and a small two-row broadcast scoreboard.
3. **C — Clay courtyard:** warm surface colors and a cream score strip. Cosmetic
   only; this is not a proposed change to bounce or friction.
4. **D — Sports hall:** simple indoor surroundings and a flat score ribbon.

Every concept keeps both solo cameras, frames more of the court, and shows only
the brand/sport/code, score and one coach cue. Tennis's current environment,
scoreboard layout and shared TV header are intentionally awaiting the user's
choice. Moving tennis options to the phone needs allowlisted, authenticated
commands scoped to the active match; it must not expose arbitrary iframe commands
or grant players the host's close-lobby authority. Native fullscreen entry still
uses the TV's direct Play gesture.

### Follow-up validation

- **289 game tests + 74 platform tests passed (363 total)**. Regressions cover
  moving-phone restoration after actual controller teardown/rejoin into bowling,
  setup expiry, forward/backward deliveries, projected lane direction, and theme
  persistence/blocked storage/untrusted messages.
- TypeScript, lint, diff checks and the production build passed. Build verification
  checked all four pages and both model assets; existing large-bundle warning remains.
- Live production build: home/lobby/controller dark mode, same-origin frame theme
  synchronization, long phone names at 390 px without horizontal overflow,
  lobby ready/start and a bowling roll advancing to ball two after six pins.
- The normal development server homepage also loaded after a clean restart.
- Four actual Three.js preview scenes rendered without console errors. The
  development-only design page is not bundled into the deployed game.
- Live input used desktop button fallback. Direction and calibration were tested
  with simulated sensor data; real phone feel and permission prompts still need
  device verification. No live two-human match was run.

Research: [W3C motion axes](https://www.w3.org/TR/orientation-event/),
[MDN origin-scoped storage](https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage),
[Xbox HUD contrast guidance](https://learn.microsoft.com/en-us/xbox/accessibility/xbox-accessibility-guidelines/102)
and [clear objective cues](https://learn.microsoft.com/en-us/xbox/accessibility/xbox-accessibility-guidelines/109).
The design recommendation uses restrained backgrounds, readable score contrast
and a single next-action cue; it does not copy another game's artwork.

The sections below record the earlier pass; the follow-up above supersedes its
500 ms stationary restoration check and bowling card layout.

## Sound and phone controls

- Replaced the sound-testing panel with one compact speaker icon. It appears at
  the top of the phone and in the TV header, including during play.
- The phone icon controls the shared TV game sound. Every member of the same
  lobby sees its current mute state. Muting does not change readiness or reset play.
- The TV's Play click prepares audio even when muted, while keeping the mute
  preference. Unmuting from the phone can then work without another TV click.
- Toggling is silent. Initial lobby preference comes from the TV once; reconnect
  cannot overwrite a phone's explicit choice. Controls are scoped to authenticated
  room membership, including when a socket is replaced.
- Bowling's rolling bed stops on the first actual pin impact or gutter entry.
  Settlement, pause, reset and hiding the page also stop it. A 12-second audio-clock
  limit prevents an indefinitely lingering loop if the final game event is lost.
  Pin impact and result effects remain short one-shots.

Sound still plays on the TV/laptop, with separate vibration on supported phones.
The browser may require a TV gesture after suspending audio; the speaker button
can reactivate it. There is no duplicate phone audio stream.

## Tennis timing

The intermittent misses had several local causes beyond network delay:

- Inputs a little before the old 450 ms window started their animation too soon.
  The bounded early queue is now 650 ms in Standard and 750 ms in Beginner.
- A queued animation could start before the racket could reach the incoming ball.
  It now waits for a reachable path while ordinary movement continues.
- Assistance stopped at a single cached strike plane even when later portions of
  the authored racket path could still contact the ball. It now checks that path.
- Some handedness/stroke combinations used the wrong cached contact offset.
  Positioning now uses the matching forehand/backhand pose and hand mapping.
- The timing search repeatedly decomposed matrices and allocated temporary
  objects. It now decodes each pose once per search and reuses temporary transforms.

Hits still require real contact. The ball is not rewound, hitboxes are not enlarged,
and late/out-of-reach swings can still miss. These fixes improve local response;
they do not promise zero internet or physical-sensor delay.

Legacy tests mocked `Math.random` globally, unintentionally duplicating Three.js
model UUIDs. The response regressions now use unique real model nodes and cover
both hands/strokes, early and reachable-late inputs, eight consecutive returns,
frame-rate variations and pause cancellation.

## Calibration reuse

Verified setup is retained on the same website origin for up to two hours, so
reloads and a new QR tab can reuse it. Only coarse gyro bias, playing hand and
the bounded comfortable-power profile are stored; no motion recording is saved.

On restoration, 500 ms of fresh still gyro readings must agree with the saved
setup before the phone becomes ready. A mismatched saved hand, changed classifier
version, expired setup or changed sensor zero prevents reuse. Changing hand during
an already verified session clears the hand-specific power profile. Browser motion permission
is still required; **Resume motion** requests it when necessary. If persistent
storage is unavailable, same-tab storage is the fallback. A different tunnel URL
is a different origin and cannot reuse the old site's saved setup.
Late permission responses are ignored after choosing buttons, changing hand,
starting a newer setup request or hiding the page, so they cannot undo that choice.

## Scoreboards and full-screen bowling

Both games use matching compact top score cards, with clear player colors, totals
and current serve/turn calls. Tennis retains both cameras in solo play. Practice
and other options stay collapsed during ordinary play.

Bowling no longer reserves a fixed scorecard beneath a lane with a 640 px minimum
height. The lane fills its iframe, and the full ten-frame scorecard opens on demand.
Full-screen and windowed views use the same game instance. Models, arena assets,
bowling scoring and rigid-body physics are preserved.

## Verification

- `npm test`: **270 game tests and 74 platform tests passed**, including real
  local Socket.IO routing/reconnect tests.
- `tsc --noEmit` with temporary build metadata, `npm run check`, and diff checks
  passed. `npm run build` passed and verified all four pages and model assets.
- Live browser: created solo bowling/tennis lobbies, joined through controller
  pages, used button fallback, readied and started both games. Phone mute/unmute
  synchronized with the TV, including a match started while muted.
- A bowling roll recorded six pins and advanced to ball two. The bowling app,
  lane and canvas all measured 1280 × 600 at the short viewport, without overflow.
  The phone layout was inspected at 390 × 844. Both tennis camera views and the
  new score cards rendered.
- A live tennis serve produced a successful contact result on the controller.
  That single local test measured 29 ms acknowledgement round trip and 47 ms
  TV-arrival-to-contact; these are separate stages, not a hardware latency benchmark.

Real-phone motion feel, browser permission prompts on the team's devices and
perceived sound balance still need device testing. The live checks used desktop
controller buttons, while sensor restoration and gestures were verified with
simulated readings and the team's recordings. No live two-human match was tested.

References: [MDN user-gesture audio activation](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay)
and [MDN motion permission](https://developer.mozilla.org/en-US/docs/Web/API/DeviceMotionEvent/requestPermission_static).
See [sound](sound.md), [tennis response](tennis-response.md), and [bowling](bowling.md)
for implementation details and device checks.
