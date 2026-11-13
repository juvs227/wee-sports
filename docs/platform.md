# Platform

The TV owns game simulation. The server owns rooms, authenticated member sessions,
seat assignment, readiness, countdowns, input generations and host epochs. Phones
own input capture and controller UI. Tennis accepts two players; bowling accepts
eight. New games, reconnects and sport switches invalidate stale input.

`shared/protocol.js`, `sportRegistry.js` and `controllerCapabilities.js` define
shared messages and capabilities. Browser and Expo controllers reuse motion
normalization and aim mapping. `RoomStore` is networking-independent; `app.js`
attaches transport, rate limits and optional profile persistence.

Checkpoint validation is injected into `RoomStore`. The platform-only branch
rejects checkpoints until the gameplay branch installs its rule-aware validator.
This prevents unsupported state from being accepted while retaining normal play.
The profile service supplies its persistence adapter explicitly, so the platform
can start without a database. Bowling supports durable settled roll checkpoints;
tennis supports stable boundaries within a live room.

The desktop entry keeps the team's sport-card homepage. Phones have a controller
homepage, QR scanner, manual entry, automatic setup and touch fallback.

See [controller ownership and state transitions](controller-design.md) for the
concrete input contract, recovery rules, source map and acceptance checks.
