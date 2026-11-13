# Forehand and backhand repair

The reported symptoms were both a missing racket animation and an animation
that missed the ball. These are separate input and contact failures.

## Reproduced causes

1. The recognizer discarded the reading before a stroke crossed its trigger
   threshold. A compact swing could therefore fail the distinct-rise check even
   after real stillness. It now retains that approach evidence without treating
   a sensor gap or a recovery movement as rest.
2. Direction rules required individual axes to reach hard-swing magnitudes.
   Smaller versions of the same recorded movement became unknown. Direction
   floors now scale within bounded limits; minimum total strength, angular
   travel, sustained samples and recovery suppression remain.
3. Some preparation movements resembled the opposite stroke and were committed
   early, swallowing the actual hit in the same latched window. Ambiguous
   left-hand preparation now waits for the distinguishing evidence. A valid
   compact stroke no longer waits for completion solely because its peak is
   below the former 800 degrees/second fast-confirmation gate.
4. Deep returns could pass below the backhand's fixed animation. Assisted play
   now adjusts the visible hand/racket height toward the predicted intercept,
   bounded to 0.7 court units. The same adjustment is applied to the animation,
   contact forecast and recent-contact check. Feet do not teleport, hitboxes do
   not grow, and a hit still needs a legal racket/ball intersection. Keyboard
   play with assistance disabled retains its authored path.
5. A repeated browser replay missed the fourth compact backhand even though
   the room stayed connected and all recognized strokes reached the TV. Its
   two corroborating direction readings arrived **15.4 ms apart**, below the
   previous rigid 16 ms check. Direction support now allows a bounded 12 ms
   interval, retaining repeated samples, total travel and post-peak checks.
   Replaying the captured failing samples now recognizes all seven strokes
   across that run's two recordings. Forty combinations of recording,
   strength and ±2 ms delivery jitter cover this scheduling edge case.

The first contact probe reproduced this on both `ba6affa` and `18711e9`, so a
rollback to the preceding build would not resolve that failure.

## Evidence

- The five original recordings still produce their expected 19 stroke labels
  and peaks, without additional return-motion hits.
- At half the recorded angular speeds, correct detection increased from
  **16/19 to 19/19** (84% to 100%, a 16 percentage-point increase). This is a
  controlled transformation of existing recordings, not fresh hardware data.
- A right-hand backhand recording at 35% strength improved from **1/4 to 4/4**;
  each stroke confirms within 67 ms after its recorded peak. Some other traces
  at that strength remain below recognition evidence requirements; the full
  50–100% range is covered separately.
- In the first-seat varied-rally matrix, successful returns increased from
  **30/36 to 36/36**. Backhands improved from **13/18 to 18/18**. The regression
  suite additionally covers the opposite seat: **72 combinations** of seat,
  hand, stroke, left/center/right placement and short/normal/deep incoming shots.
- [Motion replay measurements](system-plan/tennis-compact-stroke-replay.json)
  retain the before/after labels and fixture-clock timings, including misses.

These checks do not establish zero latency, physical iPhone recognition
accuracy, TV frame rate or Seattle-to-Railway round-trip time. No network wait
budget or fullscreen behavior is changed by this repair.

## Historical validation before this split

The results below belong to the original repair. The current split has 828 root
tests, 74 server tests and 68 native tests; use `manuals/TESTING.md` to rerun checks.

- TypeScript, repository lint and production build/asset verification passed.
- **871 Vitest tests across 90 files** passed, including both-seat model-contact
  coverage, mixed-hand recordings, noise/recovery rejection and timing jitter.
- **85 native-controller tests** passed, including the actual Expo motion core
  receiving scaled recordings in its native radians-per-second format.
- The final built web-controller/TV browser check passed **19/19 strokes** from
  all five recordings at half strength, with matching hand/label and once-only
  delivery. It uses synthetic sensor events and a local authenticated room.
  [Browser evidence](system-plan/tennis-compact-stroke-browser.json) also records
  the earlier inconsistent runs and the timing defect found from their trace;
  the final pass is after that fix, not an unexplained retry.
- **8/8 Chromium contact cases** passed with the shipped player/racket models:
  both hands and strokes, at the ball's arrival and with 120 ms injected delay.
  Each input produces one correlated hit and returns the actual ball.
  [Contact evidence](system-plan/tennis-stroke-repair-contact-browser.json).
