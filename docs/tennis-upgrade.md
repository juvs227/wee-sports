# Tennis playability upgrade

For the later UI, shared phone mute, calibration reuse and response fixes, see
[play polish](play-polish.md), including live browser verification.

Implemented on `update-homepage`. This change keeps the team's authored racket
animations, stroke classifier and actual ball/racket collision path. It adds
controls around them and makes the rules and feedback explicit.

## Six changes

| Change | What is implemented | Where to use it |
| --- | --- | --- |
| Predictable direction | Bounded input timing and stroke side choose a repeatable target. The existing safe trajectory solver still checks the shot. | Rally normally; earlier input favors a wider angle and later input a straighter shot. |
| Practice and useful feedback | Repeating forehand/backhand/alternating feeds, both playing hands, landing markers, return counts and streaks. Misses and point endings explain the known reason. | TV → **Play options & practice**. Match score and pending second serve are preserved. Returning replays the current point. |
| Comfortable power | Optional three forehands and three backhands tune a bounded power multiplier to comfortable recognized swings. | Phone → **Controller settings → Tune comfortable swings**, after still calibration. Match play pauses during rehearsal. Skip keeps the default. |
| Separate timing diagnostics | Rolling median/p95 for motion confirmation, delivery acknowledgement round trip, and TV arrival to actual contact. | Phone → **Controller settings → Response timing**. Contact measurements require the homepage lobby. |
| Match and assistance options | Full best-of-three sets or a quick seven-point tie-break; Beginner/Standard assistance; independent bot difficulty, movement and timing assistance. | TV → **Play options & practice**. Choose a format then **Start new match** to reset the score. |
| Service and net rules | Diagonal service boxes, alternating service side, first/second faults, double faults, lets, receiver-before-bounce rules, line contact and swept net collision. Assisted serves and receiver placement use the same court dimensions. | Watch the server/side/attempt call on the TV and **Your serve / Your second serve** on the phone. |

The detailed rules and deliberate simulation limits are in
[tennis scoring, controls and practice](tennis-scoring.md). Physical spin,
body violations and full officiating remain outside this party-game simulation.
Actual phone power is a game input, not a force measurement; calibration does
not retrain the team's stroke classifier or lower its recognition thresholds.

## Both views in solo play

Solo tennis now shows your camera and the bot's camera by default, matching the
requested base-game behavior. The checkbox **Show my view and the bot’s view**
lets you use one camera if preferred. Two human seats continue to use both views.
Practice is a solo tool and temporarily stops the bot from returning feeds.
Choose the same playing hand on the practice panel and the phone controller.

## Sound on the TV

The homepage **Play** click now activates a persistent audio context on the TV
page. It survives the countdown and game iframe, so an extra click inside the
court is no longer needed. An explicit saved mute is respected.

A compact speaker icon on the phone and TV controls shared game sound. Toggling
is quiet, and the lobby keeps the selected mute state through reconnects.
The existing match-start countdown has a pip for each number and a Go cue;
ordinary serves do not restart that countdown. Explicit rematches have a Go cue.

Tennis uses actual hit, bounce, serve, fault, let and scoring events. Bowling uses
release, rolling, actual pin contact and result events, and stops rolling audio
on first pin contact or gutter entry, as well as settlement. The pack includes original bright family-sports chimes;
it contains no Nintendo recordings or copied melodies. See [sound setup, event
mapping and source credits](sound.md).

## Testing this update yourself

1. Restart your session with your usual command and reload both the TV and phone
   so all pages use the updated protocol. For a built session, rebuild it first.
2. On the TV, start solo tennis. Confirm
   countdown pips, a single Go, both camera views, and sound at actual contact.
3. Calibrate the phone. Optionally tune six comfortable swings, then return to
   the controller. Check gentle/stronger strokes and both forehand/backhand.
4. Open TV practice, match its hand to your phone and try alternating returns.
   Confirm counters increase, points stay unchanged and returning keeps the
   score. A pending second serve should still be the second serve.
5. Try Beginner/Standard and a quick match. Check that server/side calls match
   the play, the receiver waits for the service bounce, and ordinary points do
   not repeat the opening countdown.
6. If a swing feels late, check the three phone timing measurements separately.
   Record the phone/browser and stage that grows. Do not treat their sum as
   measured end-to-end latency.
7. Pause/reconnect or background the phone, then return. No queued old hit sound,
   old diagnostic result or old practice stroke should replay. In bowling,
   check release → rolling → pin impact → result and that the loop stops.

The initial six-feature implementation was checked offline with simulated sensors, real model poses,
rules/physics tests, mocked audio and iframe messages, room-state tests, TypeScript
and lint. Those initial checks did not launch the app or play audio; the later
[polish update](play-polish.md) adds full build, socket and live browser checks.
Phone feel, audible balance and live two-human play remain manual
checks. The team should also run its normal build/network integration checks
before deployment.

Recorded offline results for the initial six-feature update:

- `vitest run --exclude server/relay.test.js`: 244 tests passed across 34 files.
- `node --test server/src/RoomStore.test.js`: 37 tests passed.
- `tsc --noEmit` with temporary build metadata, `npm run check`, and
  `git diff --check`: passed.

The live relay suite was deliberately excluded because it starts servers.

## Design references

- [USTA serving rules](https://www.usta.com/en/home/improve/tips-and-instruction/national/tennis-serving-rules.html): service order, boxes, faults and lets.
- [ITF-hosted 2026 ATP rulebook](https://www.itftennis.com/media/15604/atp-2026-rulebook.pdf): Rules of Tennis and court dimensions.
- [Microsoft XAG 108](https://learn.microsoft.com/en-us/xbox/accessibility/xbox-accessibility-guidelines/108): configurable challenge and assistance.
- [W3C motion specification](https://www.w3.org/TR/orientation-event/): device-coordinate motion and permission model.
- [MDN autoplay guide](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay): activate browser audio from a user gesture.
- [MDN high-precision timing](https://developer.mozilla.org/en-US/docs/Web/API/Performance_API/High_precision_timing): monotonic local duration measurements.
