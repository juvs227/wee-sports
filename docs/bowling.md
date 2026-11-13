# Bowling and phone motion

## Browser improvements and recovery

The phone now publishes a replaceable aim preview up to 20 times per second.
The room service authenticates the active player; the lane accepts only its
current game, input generation, host epoch and increasing sequence. Forward swing onset
stores an explicit immutable aim for the delivery and changes the TV line to
gold. The preview never authorizes a roll or changes a rolling ball. Aim
filtering uses elapsed time with an 84 ms time constant, approximately matching
the old 0.18-per-sample response at 60 Hz. Identical sampled step responses at
30, 60 and 100 Hz now agree. This is a cadence fix, not hardware feel evidence.

Solo practice resets a fresh rack after each settled delivery. Select it in
game options, or use **Practice a fresh rack** on the standalone bowling page.
Switch back to a ten-frame game between deliveries; switching during a roll
is rejected. Touch aim, curve and power remain available without sensors.

The TV exports versioned checkpoints only before a delivery or after settlement.
They contain the settled delivery history and full position/quaternion of every
standing pin. Restore replays the rules to derive the score and next turn,
checks the roster and pin transforms, and preserves off-spot pins. It refuses
to restore moving balls or accept a late restore after local gameplay began.
The service owns storage, revision and host-epoch authorization; raw movement
is not included. An interrupted in-flight delivery resumes from the last
accepted settled boundary, not from a fabricated mid-flight simulation.

The canonical adapter uses the W3C DeviceMotion rotationRate convention:
`alpha=X`, `beta=Y`, `gamma=Z`, in degrees per second at the browser boundary.
Canonical motion uses radians per second; conversion back to the recognizer
preserves browser signals. With screen up and the phone top toward the TV,
positive X is the expected forward pitch, and positive Y requests a curve right
on the TV. Physical iOS/Android grip trials remain required to verify native
sensor signs and comfort; synthetic tests establish deterministic signal mapping,
not hardware feel. Cannon-es coefficients and forward release thresholds are unchanged.

Signed-in profile preferences can supply initial hand, motion response, vibration
and button-mode defaults. Explicit choices on this device and an active setup
take precedence over a late profile response. The local preference record is
separate from calibration, contains no gyro bias or account credentials, and
cannot grant sensor permission. Motion response changes the bounded aim/power
mapping, not the release detector; touch power stays exactly as selected. Turning
off vibration keeps visible confirmation and contact feedback available.

## Rules implemented

One to four players complete ten frames in order. A frame normally has two
rolls; a strike ends it immediately. A strike earns the next two deliveries as
bonus points; a spare earns the next one. Unresolved cumulative scores remain
blank. The tenth frame grants two fill deliveries for a strike or one for a
spare. Fresh-rack rules apply separately to each tenth-frame delivery, so X7/
preserves seven-pin first-fill pinfall until the second fill, while XX starts a
fresh rack. Equal final totals share a rank. The TV can replay with the same
players after everyone completes the tenth.

The source of truth for scoring is the USBC playing rules, Rule 2:

- [2026–27 USBC Playing Rules](https://images.bowl.com/bowl/media/assets/usbc/rules/general%20pdfs/usbc-playing-rulebook-26-27.pdf)
- [USBC scoring examples](https://images.bowl.com/bowl/media/legacy/internap/bowl/rules/pdfs/ScoreHowto.pdf)
- [PBA Universal Playing Rules, 2.1.1](https://www.pba.com/pba-league-bowler-certification/rules/universal-playing-rules)

## Physics and presentation

Three.js renders the alley, ball, compound-profile pins and moving camera.
cannon-es resolves gravity, ball–pin and pin–pin collisions at a fixed 240 Hz.
The release starts with forward skid and wrist-controlled side rotation. A
smooth oil-to-dry transition from 10.5 to 13.5 metres increases contact friction:
the ball travels mostly straight initially, hooks, then rolls when its contact
slip is exhausted. Positive spin bends right; negative bends left. A slower
delivery has more time to hook. The visible trail records the actual simulated
path, without steering the ball or promising a predicted strike.

For the installed cannon-es 0.20 solver, friction equation limits clamp impulses.
The contact coefficients are scaled by the fixed timestep so that the original
release rotation is not consumed near the foul line. This also lets fallen pins
slide and carry into other pins. Catch surfaces contain deflected bodies. The
alley keeps the existing lane geometry with forest-green clubhouse panels,
ceiling lights, lane numbers and warm wood.

Pinfall is measured from settled bodies; it is never sampled from random odds.
A bounded delivery timeout prevents an unsettled body from blocking the match.
The second roll sweeps deadwood and retains standing pins in their displaced
positions. A guttered ball stays out of play. Pause stops both simulation time
and the result reveal timer.

USBC dimensions informed the 60-foot foul-line-to-headpin distance, 41.5-inch lane
width and 12-inch pin spacing. The model uses SI units. Phone aim and curve are
bounded arcade inputs; gyro speed maps to a bounded ball speed rather than
claiming to measure real release speed. Bowling needs its own rigid bodies; the
tennis game's per-tick trajectory constants are not a bowling physics model.

- [USBC Equipment Specifications](https://bowl.com/getmedia/08ef148d-c0e4-4e00-9e0d-855ba4729ad5/equipment-specs-manual.pdf)
- [USBC Ball Motion Study](https://images.bowl.com/bowl/media/legacy/uploadedfiles/Equip_and_Specs/Equip_and_Specs_Home/08ballmotionstudy.pdf)
- [USBC: skid, hook and roll phases](https://images.bowl.com/bowl/media/legacy/internap/bowl/equipandspecs/pdfs/articles/skid_hook_roll_v3_final.pdf)
- [USBC entry-angle guidance](https://bowl.com/adjusting-entry-angle)
- [cannon-es World API](https://pmndrs.github.io/cannon-es/docs/classes/World.html)
- [cannon-es GSSolver impulse limits](https://github.com/pmndrs/cannon-es/blob/v0.20.0/src/solver/GSSolver.ts)

This is an arcade approximation: simplified lane oil/friction and compound pin
geometry, no oil carrydown or certified ball-core simulation. There is no foul
line sensor; releases are legal by design. It does not claim USBC equipment
certification or tournament-grade realism.

## Play screen and sound lifecycle

The lane fills the game viewport, including shorter laptop windows. The old
640px minimum page height and scorecard below the canvas have been removed.
A compact top scoreboard shares its player colors, point cards and typography
with tennis. It shows each player's total, the active player and the current
frame/ball. **Full scorecard** expands the ten-frame history when needed; it
scrolls within the overlay instead of shrinking or cutting off the lane.
The alley, moving camera, ball/pin models, scoring and physics are unchanged.

Rolling audio now ends at the first real pin impact or gutter entry. It no
longer continues underneath the pin-impact sound while every body settles.
Settlement, pause, reset and disposal also stop the rolling bed, without
replaying it on resume. Each outcome still produces one strike/spare/result
cue after its score is recorded. A bounded audio-clock deadline is a final
backstop if an end event is lost. See [sound controls and event mapping](sound.md).

The live layout check at 1280 × 600 confirmed the lane, canvas and app all fill
the viewport without overflow. Offline delivery-lifecycle regressions cover
early loop termination on pin/gutter contact and stopping an unfinished roll
on reset. Speaker balance and real-phone delivery feel remain device checks.

## Motion setup and delivery

The initial motion choice requests browser permission from a tap; an embedded
controller reuses that granted intent without a second prompt. Permission alone
cannot make it ready: five real gyro readings covering at least 150 ms are required.
This allows immediate provisional zero bias while moving. A quiet safe boundary
refines bias without interrupting play. Missing readings for more than 250 ms
revoke automatic readiness. Provisional values are never saved as verified
stationary calibration. Optional Reset motion in Settings retains the explicit
stationary calibration workflow for drift diagnosis; it is not a play requirement.

Bowling needs no Arm button. On the current player's ready turn, 250 ms of quiet
fresh readings prepares one delivery. Hold the phone screen up with its top toward
the TV; tilt left/right to aim. Aim locks only when a positive X forward segment
starts. The existing pitch dominance, travel, peak and 80 ms deceleration checks
release once. Power uses forward peak speed with gravity-free acceleration assist.
Backswing never charges a shot. A release stays latched through acknowledgements,
timeouts and reconnects until an authoritative new delivery boundary.

Y wrist rotation through that same forward and deceleration window sets curve:
6 degrees of dead zone, then a linear response capped at 55% spin after another
45 degrees. Positive requests TV-right, negative TV-left, independent of hand.
Movement after release cannot alter the ball. The brief result readout shows
curve direction and strength relative to this bounded motion range. Touch controls
keep aim and Roll visible, with optional curve and power adjustments. Hand selection,
sensor diagnostics and power tuning stay in Settings. Tennis keeps its existing
post-peak classifier and optional simple shot mapping.

- [MDN: motion permission and transient activation](https://developer.mozilla.org/en-US/docs/Web/API/DeviceMotionEvent/requestPermission_static)
- [W3C Device Orientation and Motion](https://www.w3.org/TR/orientation-event/)

Button deliveries also work over LAN HTTP. Input IDs use `getRandomValues()`
when secure-context-only `randomUUID()` is unavailable, with a per-tab fallback
for older WebViews. These IDs deduplicate actions; they are not session tokens.
See [MDN Crypto.getRandomValues](https://developer.mozilla.org/en-US/docs/Web/API/Crypto/getRandomValues).

The homepage parent owns the authenticated socket. The server validates bounded
inputs, stamps the seat/match ID, checks the current turn, deduplicates delivery
IDs and locks a pending delivery. The TV acknowledges only after the game accepts
the roll. A late roll for an old match cannot affect a new one. All four bowling
seats require setup before Ready. Reloading the TV resets the local match;
network reconnection without a page reload preserves it.

## Verification

Automated tests cover 300/150/0 scoring, chained bonuses, tenth-frame racks,
scorecard strike/spare notation, tied ranks, an 80-delivery four-player game, stable
upright pins, a physical pocket strike, gutter misses, spin in both directions,
remaining-pin preservation, collision step sizes and finite body states.
Controller tests exercise permission requests, real-data gates, settling, auto
start, explicit Stop, hidden/pause handling, underhand releases and acknowledgements.
Real Socket.io tests cover all four seats, spoofed inputs, turn restrictions,
duplicates, host acceptance/rejection, room isolation and reconnection.

Run `npm run compile`, `npm test`, `npm run check`, and `npm run build`.
Browser testing supplements these checks; physical iPhone/Android gyroscope
permissions and the feel of a real swing still require device playtesting.

### Rules review — 2 November 2026

The integration review checked strike/spare bonuses, tenth-frame fill deliveries,
remaining-pin handling and tied final totals against the current implementation,
its tests, and [USBC Rules 2, 6 and 7](https://images.bowl.com/bowl/media/assets/usbc/rules/general%20pdfs/usbc-playing-rulebook-26-27.pdf).
The [USBC scoring examples](https://bowl.com/keeping-score) also explain why a
spare earns one fill delivery and a strike earns two, including the tenth frame.

Fixed one presentation inconsistency: a tenth-frame spare followed by ten pins
(`6 / X` or `– / X`) already displayed X and scored correctly, but its result
metadata did not trigger the strike announcement. The final fresh-rack strike
now announces once and still ends the game. A gutter followed by ten remains a
spare, including `X – /`; no extra delivery or bonus is awarded.

Regression tests cover final-fill strike/spare classification, unchanged totals,
rejected extra deliveries, matching scorecard marks and once-only callouts.
The targeted scoring, callout, feedback and sound suites passed 42 tests after
this fix. No physics constants or numerical scoring formulas changed. This
review does not establish real-device motion quality, equipment certification,
or professional officiating accuracy; the arcade approximations above remain.
