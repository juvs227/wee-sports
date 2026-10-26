# Wee Sports

Turn any smartphone into a motion remote for Wii-style sports games. Plug a
laptop into the TV, pick a sport, and everyone joins by scanning a QR code. No
console, no app install. The goal is zero to playing in under two minutes.

This branch (`week4-reconnect`) builds on `ready-check` with a focused Week 4
reconnect change and a separate Week 5 server stress-test command. It keeps the
existing screens and four-player ready flow.

### Week 4 reconnect behavior

- Phone or TV refreshes and temporary network drops keep the lobby, player name,
  seat, and ready state for **60 seconds after the server detects the drop**.
- The phone or TV automatically rejoins using a private token stored in that
  browser, scoped to its role and room. Rescanning the same lobby QR code works
  in the same browser and site address. Tokens never appear in the QR or public
  lobby updates. Blocked storage is reported; such sessions cannot survive a reload.
- The ready flow pauses while anyone is missing. A running countdown retains its
  remaining duration and continues only after everyone returns.
- If a phone does not return, its seat is released and the ready flow resets.
  If the TV does not return, the lobby closes. Explicit **Leave game** and
  **Close lobby** still take effect immediately.
- A second tab using the same saved session takes control; the older tab stops
  participating. A server restart ends in-memory lobbies and shows an ended-game
  message rather than silently creating a different session.

**Scope:** this branch does not merge `tutorial-vote`, calibration, or `base-game`.
The tutorial remains the team's existing placeholder. Live tennis, score recovery,
and restarting an interrupted point still need to be connected when gameplay is
integrated. This change supplies lobby/session recovery, not a completed match
reconnect implementation.

### Check the change

Run `npm test` for the existing room tests plus reconnect and real Socket.io tests,
and `npm run build` for the client build. The socket tests open local loopback ports.

For a device check, join from four separate phones/browser profiles, then:

1. Refresh a phone and the TV; verify the same room, names, seats, and readiness.
2. Temporarily disable a phone's network; verify the waiting screen and reconnect.
3. Disconnect during the five-second countdown; verify it resumes with time remaining.
4. Stay disconnected for over 60 seconds; verify seat release or TV timeout closure.
5. Reopen the same controller in a second tab; verify only the new tab has control.
6. Stop/restart the server; verify the old session reports that the game has ended.

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
[full recorded report](server/benchmarks/local-capacity.json), including the server
revision, all stages, workload, and machine details.

The underlying platform foundation includes:

- **Homepage** (`/`): the polished entry point for the TV and for phones.
- **Game server** (`server/`): Node + Socket.io rooms. Hosts open a lobby, phones join it with a 4-character code.
- **Bare stubs** (`/host/:code`, `/join`): functional placeholders that prove the join works end to end. The TV display and phone display owners restyle and own them.

## Run it

Requires Node 20 or newer.

```bash
npm install
npm run dev
```

That starts the game server on `:3001` and the web app on `:5173`.

1. On the laptop, open the URL Vite prints (`http://localhost:5173` works too).
2. Click **Tennis → Play**. The TV page shows a QR code, the code, and four seats.
3. On a phone on the **same Wi-Fi**, scan the QR code, type a name, and join. Your name fills a seat on the TV.

The QR code never points at `localhost`, because phones can't open it. When the
TV page is on localhost, `vite.config.js` finds the laptop's Wi-Fi address and
the QR code uses that instead.

> **Motion needs HTTPS on iOS.** Joining works over plain HTTP, but the
> calibration and swing screens (week 3) call `DeviceMotionEvent.requestPermission`,
> which iOS only allows on HTTPS. Use ngrok (as the `phone-orientation` branch
> does) or `@vitejs/plugin-basic-ssl` when you get there.

### Other commands

| Command | What it does |
| --- | --- |
| `npm test` | Room rules tests (`node --test`) |
| `npm run stress` | Local concurrent lobby load test and JSON capacity report |
| `npm run build` | Production build of the web app into `client/dist` |
| `npm start` | Game server only, no watch |

### Environment

| Variable | Where | What it does |
| --- | --- | --- |
| `PORT` | server | Game server port (default `3001`) |
| `CLIENT_ORIGIN` | server | Comma-separated origins allowed to connect. Unset allows any, which is only right for local dev. |
| `VITE_SERVER_URL` | client | Game server URL when it isn't same-origin (e.g. Vercel + a hosted server) |
| `VITE_PUBLIC_URL` | client | Public site URL to put in the QR code (e.g. an ngrok URL) |

## Layout

```
shared/protocol.js     Event names, room-code alphabet, limits, name cleaning. Imported by server and client.
server/src/RoomStore.js  All lobby rules, no networking, so tests cover what's deployed.
server/src/app.js        Socket.io wiring: who hears about each change.
server/src/index.js      Starts the server.
server/scripts/stress.js Local Week 5 load generator; stress-server.js runs the server separately.
client/src/pages/        Home (polished), HostStub and JoinStub (placeholders).
client/src/components/   Sport tiles, join box, QR code, placeholder icons.
client/src/lib/          Shared socket, join URL, sports catalog, error text.
```

### Room rules

- Codes are 4 characters from `23456789CDFGHJKLMNPQRTVWXYZ`. They have no vowels, so a code can't spell a word, and no lookalikes (0/O, 1/I, 8/B, S).
- A lobby has one TV and up to 4 phones. Phones take the lowest open seat, so P1–P4 stay packed.
- Names are trimmed to 12 characters. A duplicate gets a number ("Sam 2").
- Clicking Close lobby closes it immediately. Refreshes, navigation away, and network loss reserve the room for 60 seconds before closing it.
- Every failure comes back as a code (`no-room`, `room-full`, `bad-name`, …) and the UI shows it in plain words.

## Where this came from, and what's next

The platform side borrows from
[gameboystudio](https://github.com/necromancerrr/gameboystudio), which already
solved phones-as-controllers for browser games. We ported the patterns into this
project's stack (JS, Node + Socket.io, Vite + React) rather than copying its
stack (TS, Next.js, Cloudflare Durable Objects).

| gameboystudio piece | Lands in Wee Sports |
| --- | --- |
| Room codes; QR + code + link invite; relay validation; host leaving closes the room; room logic testable without a network | **Week 1 (this branch)** |
| Input latency measurement | Week 5 runner measures phone-to-TV lobby delivery against the document's 75 ms / 90% target. Actual motion-to-render verification remains pending. |
| Typed input channel. Send swing *events*, not raw sensor streams, which also keeps raw motion data off the server (privacy requirement). | Week 2–3 |
| Controller page: screen wake lock; release input on `visibilitychange`/`pagehide`; keep React `setState` out of the hot input path | Week 2–3 phone controller |
| Seat memory and a reconnect token; a grace period before a host drop closes the lobby | Implemented here for the existing lobby/ready flow. Match recovery remains an integration task. |
| Concurrent sessions/load testing | Week 5: `npm run stress`. Origin allowlist is configurable; token-bucket limiting remains future work. |
| SDK contract: a game supplies `init` / `update` / `render`; a manifest declares `players` and `inputs` | Week 6 SDK |
| Forge: an LLM writes games against the SDK; a play pointer only advances when a revision passes checks | Stretch / Use Case 7 |

Branches to merge in later: `base-game` (Three.js court, player, net) becomes
the tennis scene; `phone-orientation` (swing detection) becomes the phone
controller. Both already use Vite, and the React version matches this branch.

## Team

Akshat Mundra (SDK) · Pak Ho Lam (game logic) · Stanley Kim (TV display) ·
Wesley Sluys (assets) · Yitbarek Ejigu (phone display) · Juve Sanchez Jr. (motion controls)
