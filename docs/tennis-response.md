# Tennis response and strength

## What was delaying a hit

The existing path is phone sensors → local classification → parent page → Node
relay → TV page → tennis animation/contact. Fast mode previously required a
peak of 800 degrees/second and waited for motion to fall below half that peak
for 40 ms. Gentler recognized swings waited for full completion. Messages carried
only stroke direction and hand, so tennis did not know how strongly you swung.

## Focused changes

- Fast mode keeps the team's direction rules and strength floor. It confirms
  after a sustained decline below 72% of peak, with at least 40 ms since peak,
  24 degrees of travel and sustained motion evidence. A single sharp jolt or
  small grip adjustment cannot trigger a completed stroke. Gentle fast strokes
  require observed stillness first so returning the phone does not send a second
  shot. Follow-through suppression and sensor-gap handling remain in place.
- Calibrated peak rotation maps smoothly to a bounded strength input. This is a
  game control, not a force measurement. Power saturates at 1200 degrees/second;
  swinging harder adds nothing. The phone briefly shows Gentle/Medium/Strong.
- Strength makes a small change to target flight time (54–66 ticks around the
  previous 60-tick baseline). The existing trajectory solver still checks net
  clearance and landing area and can choose a slower safe arc. Court targets,
  gravity, bounce response, contact hitboxes and scoring are preserved. Buttons,
  bots and old clients retain the previous medium-strength default.
- A phone serve skips the opening 20% of the animation. It still needs
  actual racket contact; no hit is awarded just for detecting motion.
- Solo play now shows both your view and the bot's view by default. **Play options
  & practice → Show my view and the bot’s view** can turn it off; two human seats
  retain both views.
- Socket.IO tries WebSocket first with polling fallback. Controller help shows
  acknowledgement round-trip timing, measured on one clock. It excludes motion
  recognition and does **not** measure time to visible ball contact; standalone
  prototype timing reaches only the server, while lobby timing includes TV
  delivery acknowledgement.

## Your manual test

Restart your existing session yourself with `npm run dev`, then use the new QR.
The secure session rebuilds its pages; refreshing an old built session alone
will not apply code changes. Keep Response on **Fast confirmation** and the
return-motion filter enabled.

1. Calibrate, start solo tennis and try relaxed deliberate swings from rest.
2. Compare gentle and stronger strokes. Tiny grip changes should do nothing;
   returning the phone should not create another stroke.
3. Try both forehand and backhand. Vibration should follow real contact only.
4. If it still feels late, open Settings → Motion settings / Controller help and
   capture the recognition and delivery numbers, plus the phone/browser used.
   Large delivery time points toward the network; fast delivery with late contact
   points toward timing/rendering and needs a different fix.

The team's five saved recordings retain all 19 expected stroke labels and peaks.
Offline replay recognizes them 17–134 ms earlier after peak than the previous
fast mode. These are detector measurements, not live network or device results.
No browser, game server, tunnel, Docker image or Railway deployment was launched
for this change. Physical phone play and hosted deployment remain manual checks.

See [Railway setup](railway.md) for permanent hosting.

## Separate response measurements

**Controller settings → Response timing** keeps up to 40 recent valid samples
per stage and shows median/p95, rather than mixing different delays into one number:

- **Motion confirmation:** detected motion start to the phone's accepted stroke.
  This includes the deliberate gesture itself; it is not network latency.
- **Delivery acknowledgement round trip:** phone send to acknowledgement. In a
  homepage lobby this includes TV delivery acknowledgement; in standalone mode it
  reaches the relay server only. It does not wait for a racket hit.
- **TV arrival to contact:** time from the TV accepting that input to its actual
  racket contact. Successful contacts only; available through the homepage lobby.

Each stage uses one local monotonic clock. The values are not synchronized
one-way measurements and must not be added to claim total motion-to-screen latency.
Contact results carry a swing ID, game ID and player seat. The server only routes
a result from the current TV for a recent input to that input's phone. Paused,
disconnected, duplicate, wrong-game and expired results do not update the metrics.
These diagnostic messages are optional and are never required to finish a swing.

The latest result distinguishes hit, miss or rejected input and includes the
TV's reason. Brief miss guidance appears on the clean play screen; the detailed
measurements stay in settings. See [the complete upgrade guide](tennis-upgrade.md)
for practice, match options, serving rules and sound activation.

## Comfortable-swing rehearsal

After still calibration, tennis offers **Tune comfortable swings**. It is optional;
**Skip for now** retains the existing power curve and does not block readiness.
The same card is available under **Controller settings**. Hold the phone upright
in the chosen playing hand, make three relaxed forehands and then three backhands,
and pause at rest between them. The controller stays awake during this step when
the browser supports it.

Rehearsal uses the team's existing completed-stroke classifier in a separate
stream. Unknown, early, simple-mode, duplicated, unusually large, incomplete or
wrong-step strokes do not train it. It does not send practice swings to the TV.
The phone temporarily clears its ready setup while rehearsing, which pauses an
active match; cancelling, finishing or timing out restores the calibrated setup.
Disconnected, hidden or stale-sensor sessions cancel incomplete rehearsal data.

Three consistent recognized peaks for each stroke produce a median-based power
multiplier, bounded to 0.75–1.75. The existing smooth 0.2–1 power curve still clips
at its endpoints. Recognition thresholds, the team's forehand/backhand rules and
return-motion suppression are unchanged. This is a comfortable game-power scale,
not a physical force measurement or automatic classifier retraining.

The profile stays only in this controller session. Changing the playing hand,
starting a new calibration or selecting **Use default strength** clears it.
Reloading starts with the default curve. A failed retuning leaves an existing
valid profile unchanged; only six accepted, sufficiently consistent strokes can
replace it. No profile is inferred from ordinary match play.

The grip instruction follows the [W3C Device Orientation and Motion specification](https://www.w3.org/TR/orientation-event/):
motion coordinates belong to the physical device; rotating the displayed page
does not automatically rotate those axes. This feature intentionally does not
remap the team's gyro axes based on screen orientation.

Offline checks cover profile bounds, monotonic power, rejected/duplicate samples,
timeouts, real sensor-to-rehearsal flow, isolated practice input, cancellation and
reset behavior. The five team recordings still retain all 19 expected labels.
Comfort and perceived power across different real phones remain a manual test.
