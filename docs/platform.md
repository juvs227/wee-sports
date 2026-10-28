# Platform lobby, reconnect, and stress testing

### Week 4 reconnect behavior

- Phone or TV refreshes and temporary network drops keep the lobby, player name,
  seat, and ready state for **60 seconds after the server detects the drop**.
- The phone or TV automatically rejoins using a private token stored in that
  browser, scoped to its role and room. Rescanning the same lobby QR code works
  in the same browser and site address. Tokens never appear in the QR or public
  lobby updates. Blocked storage is reported; such sessions cannot survive a reload.
- The ready flow pauses while anyone is missing. A running countdown retains its
  remaining duration and continues only after everyone returns.
- If a phone does not return, its seat is released. Before play, readiness resets;
  during tennis, losing P1 or P2 returns to the lobby, while a spectator can expire without
  restarting the game. Every bowling seat is a controller, so losing any bowler
  ends the match and returns the remaining group to the lobby.
  If the TV does not return, the lobby closes. Explicit **Leave game** and
  **Close lobby** still take effect immediately.
- A second tab using the same saved session takes control; the older tab stops
  participating. A server restart ends in-memory lobbies and shows an ended-game
  message rather than silently creating a different session.

**Integration scope:** tennis uses one phone against the bot or two phones
playing each other. Bowling supports one to four players through ten frames,
with turn validation and game acknowledgements; see [bowling details](bowling.md). Both controllers open before Play and stay loaded through the
countdown. Each must report successful motion calibration or an explicit button-control
choice before Ready. Reloading a controller clears its setup and pauses an active
match until setup is completed again. A simple network reconnect keeps calibration. Embedded swings use the same lobby session; standalone prototypes
retain their separate relay. The TV's game stays mounted and
pauses during a lobby disconnect. TV refresh still resets its local game;
score recovery and restarting the interrupted point remain future work.
`tutorial-vote` remains separate. See the root README for the combined flow.

### Check the change

Run `npm test` for the existing room tests plus reconnect and real Socket.io tests,
and `npm run build` for the client build. The socket tests open local loopback ports.

For a device check, start with one phone, then repeat with up to four separate
phones/browser profiles (all four play bowling; in tennis P1/P2 play and P3/P4 watch):

1. Refresh a phone and the TV; verify the same room, names, and seats. Refinish controller setup after a reload. The TV starts a fresh world on reload.
2. Temporarily disable a phone's network; verify the waiting screen and reconnect.
3. Disconnect during the five-second countdown; verify it resumes with time remaining.
4. Stay disconnected for over 60 seconds; verify seat release or TV timeout closure.
5. Reopen the same controller in a second tab; verify only the new tab has control.
6. Stop/restart the server; verify the old session reports that the game has ended.
7. Try both playing hands, motion calibration, button controls, serving, returning,
   and scoring. Verify P2 disables the bot, and either controller leaving returns
   everyone to the lobby.

### Week 5: measure concurrent lobby capacity

```bash
npm run stress
```

The runner starts the existing server in a separate process on an unused local
port. It opens **10, 25, 50, 100, then 200 lobbies**, retaining earlier connections.
Each lobby has **four simulated phones and one TV**. One phone per lobby toggles
ready every 250 ms; the other three remain not ready so the lobby stays in the
ready phase. Each toggle uses the real Socket.io handler and broadcasts to the
whole lobby. Each stage measures 10 seconds of traffic after connections finish.

Latency runs from the phone's send to its matching TV update, using the same
clock in the load generator. A stage passes when at least **90% of scheduled
updates arrive within 75 ms**, with **zero setup errors, failed updates, missed
sends, or unexpected disconnects**. Missed sends count as failures even if the
load generator is the bottleneck. Automatic client reconnection is disabled so
it cannot hide a dropped connection. Setup time is recorded separately.

The runner stops at the first failed stage and writes a JSON report to
`stress-results/latest.json` (ignored by Git). It reports the **highest passing
tested load**, not an exact maximum. If every stage passes, increase the cap;
if a stage fails, try smaller steps between the last passing and failing loads:

```bash
npm run stress -- --lobbies 100,200,400,800 --seconds 30
npm run stress -- --lobbies 100 --seconds 60 --interval-ms 100 --output stress-results/faster-input.json
npm run stress -- --help
```

Exit codes are `0` for all requested stages passing, `1` for a failed stage, `2`
for invalid options or a runner error, and `130` for interruption. The runner
cleans up its connections and local server on completion or Ctrl+C. It does not
connect to the running development server or a hosted deployment.

**Scope:** these are local lobby/ready measurements, with both processes sharing
one computer. Four phones are connected per lobby, but only one sends updates.
Results depend on the hardware, event rate, and duration. They do not establish
tennis capacity, phone-motion-to-render latency, Wi-Fi behavior, reconnect-storm
capacity, or the document's ten-minute gameplay reliability requirement. Repeat
the measurement with real game events and deployment hardware after integration.

Local reference run on **2026-10-26**, Apple M4 / 16 GiB / Node 22.23.1, 10 seconds
per stage and one update every 250 ms per lobby:

| Lobbies | Connected phones | Total connections (including TVs) | TV delivery p90 | Result |
| --- | --- | --- | --- | --- |
| 100 | 400 | 500 | 1.11 ms | Pass |
| 400 | 1,600 | 2,000 | 2.40 ms | Pass |
| 800 | 3,200 | 4,000 | 2.83 ms | Pass |
| 2,000 | 8,000 | 10,000 | 6.93 ms | Pass |

All seven tested stages passed with no errors, missed sends, or disconnects.
**The run reached its 2,000-lobby cap, so the maximum remains unknown.** These
short, synthetic results are not a supported production player limit. See the
[full recorded report](../server/benchmarks/local-capacity.json), including the server
revision, all stages, workload, and machine details.
