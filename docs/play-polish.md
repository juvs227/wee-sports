# Play-screen and response polish — November 2, 2026

Implemented on `update-homepage`. The team's models, stroke classifier, racket
hitboxes and gravity remain in place. No changes were merged into `main`.

## Latest menu and input follow-up

The six additional `updated-menu` commits through `ccf8b66` add reusable menu
callbacks, bowling pause support, anchored overlay fixes and the P shortcut.
Their pause behavior is now integrated through the shared lobby: Player 1's
phone and the TV can pause/resume either sport, while the existing Park Club
presentation and reset/replay controls remain. P works with either the TV page
or its game frame focused; Escape continues to belong to fullscreen.

Manual pause retains the match and controller setup. Clearing it cannot bypass
a disconnected player or missing setup. Pause waits for an already-sent reset
or bowling release to finish its acknowledgement before stopping the game.
Returning to the lobby clears manual pause. Manual-only pauses do not trigger
the repeated snapshots needed for a real reconnect countdown.

Browser-history suspension now remains separate from lobby pause: a game page
cannot resume while suspended just because a lobby message arrives. Restoring
an embedded game requests fresh state before accepting inputs. Shortcut handlers
ignore editable fields, modifiers and held-key repeats and are removed at teardown.

Tennis swings now carry their current game ID through the phone, server and TV.
A mismatched replacement-game input or acknowledgement is rejected. Real-time
swing delivery allows at most 80 ms of transport wait per hop and then uses
volatile delivery with explicit busy feedback; it does not retry emitted inputs.
Ordinary readiness/settings requests retain their reliable delivery. This
addresses stale-delivery behavior, not sensor recognition, shot physics or a
promise of zero network delay. See [response evidence](tennis-response.md).

`base-game` has no additional commits since the previous port. See
[branch integration](branch-integration.md) for the exact new commits and the
recommendation to keep the published feature history instead of rebasing it
onto the older base branch.

Validation: **362 game + 110 platform tests passed (472 total)**, including two
additional phone regressions after live testing found a stale pause notice
following TV resume. The game suite was rerun after that correction; platform
code was unchanged after the full run. TypeScript, lint, diff checks
and the final production build passed; the existing Three.js bundle-size warning
remains. Real local Socket.IO probes delivered all 104 inputs exactly once for
each transport. See the response document for timings and measurement limits.

Live testing of the built app verified phone pause, TV P resume and P with the
tennis iframe focused, retaining the score and setup. Bowling paused an accepted
delivery, resumed it and recorded six pins in the same frame. The corrected
phone notice cleared when the TV resumed, and pause controls fit at 390 × 844.
Both browser error logs were empty. Live inputs used desktop button fallback;
physical phone sensors and two human players remain device playtests. Temporary
tabs and the server were closed afterward.

## Branch integration and scoring review

Adapted `updated-menu`'s return-to-lobby behavior to the existing TV display
menu and Player 1's phone options/result prompt. A confirmation ends the match
while keeping players, controller setup and sound preference. Players ready up
again before starting. Only the authenticated current host or Player 1 can
return everyone; stale game requests cannot cancel a replacement match.
Late roll/settings acknowledgements are also checked against their original
game ID before releasing any pending-action lock.

Included the compatible shared-import fixes from `base-game`, the team manual
structure from `beta_release_readme`, and the missing build-metadata ignore
rule. The branch comparison and intentional exclusions are documented in
[branch integration](branch-integration.md). Dependency versions, existing
physics parameters and the Park Club presentation remain unchanged.

The rules review fixed a missing bowling strike callout for the fresh fill rack
after a tenth-frame spare (`6 / X`). Numeric scoring was already correct.
Tennis set/match results and bowling winners/ties are announced on the TV;
the final result stays visible until replay or leaving the match.

Validation: **338 game + 93 platform tests passed (431 total)**, including
return authorization, live Socket.IO broadcasts, preserved setup, countdown
cancellation, delayed acknowledgements, phone confirmation/replay, tennis
set/match results and bowling final-frame rules. TypeScript, lint, diff checks
and the production build passed. The existing Three.js bundle-size warning
remains. A live built quick match ended 7–0, showing the TV winner card and
phone result prompt; Play again reset it to 0–0. Confirmed TV and phone return
actions restored the same lobby/player, made Ready available without repeating
controller setup, and stopped the old game. Both browser error logs were empty.
Live input used desktop button fallback, not physical phone sensors. Bowling
final-frame/winner behavior and reconnect races used automated tests. Temporary
test tabs and server were closed afterward.

## Park Club selected — implemented

### Winner and replay follow-up

- Tennis source now lives in `src/Tennis/` instead of `src/World/`. Imports,
  test mocks and the design preview references follow the new folder. Existing
  scene class names and bowling's separate world module remain valid.
- The tennis camera is lower (8 units high instead of 12, one unit closer), with
  both solo views preserved. Court dimensions and gameplay rules are unchanged.
- Tennis announces a set winner with the finished set score, then continues the
  match. The short set card clears before the next rally. The match winner has a
  persistent result card with the final sets/tie-break score. Deuce, advantage
  and a 7–6 tie-break do not incorrectly end a match.
- Bowling's final card names the winner or tied winners and displays rankings.
  A final Strike/Spare callout finishes before the result card appears.
- Both games ask **Play again?** on the TV and open a matching result prompt on
  the phone. Player 1 can replay with one tap once the completed match is ready;
  tennis keeps the currently applied full/quick format. Other players see the
  result and wait for Player 1. **Not now** dismisses without reopening on every
  state update or reconnect. Replay clears the old result and preserves the
  controller session, including its current motion setup.
- Bowling result messages contain only validated winner seat numbers and a
  bounded score; names come from the lobby roster. Stale/unauthorized results,
  duplicate winners and result fields during active play are rejected.
- Repeated tennis contact prediction now reuses scratch math objects without
  changing its contact calculation. The measured allocation reduction and real
  phone testing limits are recorded in [tennis response](tennis-response.md).

Validation: **327 game + 83 platform tests passed (410 total)**, plus TypeScript,
lint and the production build. A live built quick match finished 7–0 against
the bot, displayed its winner on TV, opened the phone result at 390 × 844, and
restarted to 0–0 from **Play again** without repeating controller setup. No
browser console errors were captured. Full-set/deuce/extended tie-break and
bowling tie/result ordering are covered by automated rule/runtime tests. Live
input used desktop buttons; real phone sensor latency remains a device check.

### Park Club foundation

- **Tennis:** the selected Park Club design is now in the game. Low-detail trees,
  hedges and a path replace the debug grid; a higher camera frames the whole
  court with less empty sky. Both views remain on by default in solo play.
  The team's court, net, player models, motion classifier, hitboxes, scoring and
  ball physics are unchanged. Lighting and camera changes are cosmetic.
- **TV display:** only the Wee brand, sport and room code stay in the header.
  Tennis has one compact strip for names, points, games, sets and the serving
  indicator, plus one coach cue. Fullscreen/windowed controls and Close lobby
  remain in a small TV display menu, available on hover, keyboard focus or touch.
- **Phone controls:** the speaker button controls TV sound; the adjacent options
  button opens appearance and live match controls. Player 1 can change assistance,
  bot challenge, timing, solo views, practice and match length, or start a new
  game. Other players keep their own appearance controls and shared sound toggle.
  New-game actions ask for a second tap because they reset everyone's score.
- **Command delivery:** settings use an authenticated, allowlisted route scoped
  to the active lobby game. The phone shows success only after the TV game applies
  the change. Stale, paused, duplicate and unauthorized requests are rejected;
  resets and bowling releases cannot cross while awaiting acknowledgement.
  Two-human tennis cannot enable solo practice, bot settings or hide a view.
- **Bowling:** the ten-frame table is always visible above the full-height lane.
  It includes individual roll boxes, three boxes for the tenth frame, cumulative
  totals, X for a strike and / for a spare. An ellipsis marks an unresolved bonus;
  the total waits for the required later rolls. Strike! and Spare! appear briefly
  after a completed delivery, without repeating on polling or reconnect. The
  final callout finishes before rankings appear. Existing result sounds remain.
  The scoring engine and rigid-body simulation are unchanged.

This section supersedes the earlier collapsed bowling table, TV sound button and
pending tennis design notes below. The four original design previews remain for
reference at `/docs/previews/tennis-designs.html` in development.

### Park Club validation

- **315 game tests + 81 platform tests passed (396 total)**, including command
  authentication, duplicate/lifecycle handling, actual Socket.IO acknowledgements,
  reset/roll ordering, scoring marks and final-frame callouts. An initial physics
  test hit its five-second timeout while the build and live games were running;
  the unchanged full suite passed with those competing tasks stopped.
- TypeScript, lint, diff checks and the production build passed. Build verification
  checked all four pages and both models. The existing Three.js bundle-size warning
  remains.
- Live solo tennis: homepage join/start, both views, phone assistance update,
  practice and return to match, quick-match reset, mute, and a successful serve.
  The phone options dialog fits a 390 × 844 viewport with no horizontal overflow.
- Live solo bowling: homepage join/start, six pins recorded in the first roll,
  ball-two progression, and phone-driven reset to an empty first frame. No console
  errors were captured. A development module load stalled during the first run;
  a clean server restart restored both standalone and homepage bowling.
- Live input used desktop button fallback. Strike/spare edge cases used automated
  scoring/runtime tests; real-phone sensor feel and sound balance still need device
  testing. No live two-human match was run. Temporary test server/tabs were stopped.

## Earlier follow-up: setup, direction and appearance

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

### Original tennis design review — A selected above

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
scoreboard layout and shared TV header were initially awaiting the user's
choice. The selected design and authenticated phone controls are now implemented
as described above. Moving tennis options to the phone uses allowlisted, authenticated
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
