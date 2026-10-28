# Bowling and phone motion

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
- [USBC entry-angle guidance](https://bowl.com/adjusting-entry-angle)
- [cannon-es World API](https://pmndrs.github.io/cannon-es/docs/classes/World.html)

This is an arcade approximation: simplified lane oil/friction and compound pin
geometry, no oil transition or certified ball-core simulation. There is no foul
line sensor; releases are legal by design. It does not claim USBC equipment
certification or tournament-grade realism.

## Motion setup and delivery

A direct Calibrate tap requests motion permission while the browser still has
user activation. Permission alone is not success. Calibration ignores 800 ms of
settling and then requires a fresh continuous 1.2-second still window, with a
10-second timeout and explicit failure reason. Missing/null gyroscope readings
cannot pass. Live diagnostics distinguish denied access, absent data, movement
and insecure HTTP. Motion starts automatically once calibrated and playing;
explicit Stop, hidden pages, pauses and disconnects discard partial gestures.

Bowling arms one delivery at a time. A sustained pitch-axis motion followed by
deceleration releases once, with power derived from peak angular speed. Aim and
curve remain explicit sliders. Tennis uses the team’s post-peak fast confirmation by default, retaining the
physical motion window to avoid duplicate follow-through and missed repeat swings.
The automatic classifier still offers
explicit simple shot mappings for devices/grips that cannot satisfy it.

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
