# Testing

Run from the repository root:

```sh
npm run compile       # TypeScript check
npm test              # game/relay Vitest tests, then platform node:test tests
npm run build         # all four pages and model-asset verification
```

Focused commands:

```sh
npm run test:game      # test/**/*.test.ts and server/*.test.js
npm run test:platform  # server/src and server/scripts node:test suites
npm run test:physics   # test/ game rules, physics, movement and bot tests
npm run test:watch     # Vitest watch mode; does not watch the platform suite
npm run lint          # GTS style checks
```

The relay tests temporarily bind local ports and stop their servers afterward.
They need an environment that permits local sockets. A sandbox port-permission
failure is different from an assertion failure; report the actual failure.

Manual checks complement the automated suites:

1. Create a lobby on the TV and join from a phone over HTTPS. Enable motion and
   ready up. Verify that names, seats, sport and controller state agree.
2. Switch sports on the same address and return to the lobby. Recent motion
   setup should remain usable. A new address may require permission and setup;
   do not treat cross-origin storage isolation as a calibration regression.
3. In tennis, check server calls, service boxes, first/second faults, ordinary
   points and tie-break scoring. A set announcement must not prematurely end a
   full match. Check the final winner on TV and phone, then replay from Player 1.
4. In bowling, check forward-only release, left/right aim, bounded curve, strike
   and spare callouts, pending bonuses, tenth-frame fill balls and final results.
5. Test phone mute/options, reconnect pauses and returning to the lobby. A
   noncontrolling player must not reset or return everyone else's active match.

Use the detailed [tennis rules](../docs/tennis-scoring.md),
[bowling checks](../docs/bowling.md) and [play-polish notes](../docs/play-polish.md).
Sensor recordings validate processing, not real phone permissions, perceived
latency, vibration or rendered animation. Report which browser/device and match
mode were actually tested; do not label simulated inputs as hardware testing.

`npm run stress -- --lobbies 10,25 --seconds 5` is an optional lobby-traffic
benchmark. It is not a measurement of concurrent rendered tennis/bowling games
or production capacity; see [platform notes](../docs/platform.md).
