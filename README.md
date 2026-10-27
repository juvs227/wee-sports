# Wee Sports

Turn any smartphone into a motion remote for Wii-style sports games. Plug a
laptop into the TV, pick a sport, and everyone joins by scanning a QR code. No
console, no app install. The goal is zero to playing in under two minutes.

This branch (`home-page`) is the week 1 platform foundation:

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
server/src/index.js      Socket.io wiring: who hears about each change.
client/src/pages/        Home (polished), HostStub and JoinStub (placeholders).
client/src/components/   Sport tiles, join box, QR code, placeholder icons.
client/src/lib/          Shared socket, join URL, sports catalog, error text.
```

### Room rules

- Codes are 4 characters from `23456789CDFGHJKLMNPQRTVWXYZ`. They have no vowels, so a code can't spell a word, and no lookalikes (0/O, 1/I, 8/B, S).
- A lobby has one TV and up to 4 phones. Phones take the lowest open seat, so P1–P4 stay packed.
- Names are trimmed to 12 characters. A duplicate gets a number ("Sam 2").
- When the TV page leaves or reloads, the lobby closes and every phone is told. Nobody waits on a dead screen.
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
| `measure-room-latency.mjs` (round trip ÷ 2, p50/p95) | Week 2: check the 100 ms responsiveness requirement |
| Typed input channel. Send swing *events*, not raw sensor streams, which also keeps raw motion data off the server (privacy requirement). | Week 2–3 |
| Controller page: screen wake lock; release input on `visibilitychange`/`pagehide`; keep React `setState` out of the hot input path | Week 2–3 phone controller |
| Seat memory and a reconnect token; a grace period before a host drop closes the lobby | Week 4 reconnect (Use Case 5) |
| Token-bucket rate limit; origin allowlist | Week 5 stress test |
| SDK contract: a game supplies `init` / `update` / `render`; a manifest declares `players` and `inputs` | Week 6 SDK |
| Forge: an LLM writes games against the SDK; a play pointer only advances when a revision passes checks | Stretch / Use Case 7 |

Branches to merge in later: `base-game` (Three.js court, player, net) becomes
the tennis scene; `phone-orientation` (swing detection) becomes the phone
controller. Both already use Vite, and the React version matches this branch.

## Team

Akshat Mundra (SDK) · Pak Ho Lam (game logic) · Stanley Kim (TV display) ·
Wesley Sluys (assets) · Yitbarek Ejigu (phone display) · Juve Sanchez Jr. (motion controls)
