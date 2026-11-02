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
- Solo play uses one camera again. Split-screen remains for two human seats.
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
