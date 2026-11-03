# Railway phone play

The app already has a Node server. Currently `npm run dev` runs it on the
developer's Mac and opens a temporary Cloudflare HTTPS tunnel. Railway would
host that Node process and the built website at a permanent HTTPS origin.
No Cloudflare account, local tunnel or running developer laptop is needed for
the hosted version. The TV/browser still runs the tennis and bowling simulation;
this change does not move physics onto the server.

## Prepared, not deployed

The root Dockerfile installs with Node 24, type-checks using the existing prepare
hook, and runs `npm run build`. It starts `node server/main.js --production`,
which serves the built pages and sockets on `0.0.0.0:$PORT`. It does not start
Vite or cloudflared. Local `npm run dev` / `dev:local` remain available.
Use npm/package-lock.json for this deployment. The inherited Bun lockfile has
not been regenerated for the existing React Router 7 upgrade.

## Team setup

1. Use a Railway project owned by the team, with GitHub access to this repository.
   Push/review the branch containing these changes first; select that branch as
   the service source. Do not point deployment at `main` by accident.
2. Create **one service from the repository root**, using the root Dockerfile.
   Leave build/start overrides empty (the Dockerfile handles both).
3. Choose a region near the people playing. US West / California is a sensible
   starting point for Seattle-area players, but compare actual delivery timing.
4. Use **one replica**, one region, and disable serverless/sleeping for play
   sessions. RoomStore is in memory; separate replicas do not share rooms.
5. Set the healthcheck path to `/health`. Generate a public domain under the
   service's Networking settings. Let Railway assign `PORT`.
6. The app reads `RAILWAY_PUBLIC_DOMAIN` at runtime for lobby QR codes. For a
   custom domain, set `PUBLIC_GAME_URL=https://your-domain` (origin only).
   Leave `VITE_SERVER_URL`, `VITE_PUBLIC_URL`, `NGROK_HOST`, `WEE_BUILD_DIR`, and
   `PHONE_LINK_MANAGED` unset on Railway. Both the TV and phone open the same
   public origin, so no separate frontend service is necessary.
7. After deployment, open the public homepage on the TV, create a tennis lobby,
   scan its QR, calibrate and try solo play. The `/api/phone-link` response should
   contain that HTTPS origin with status `ready`. Check that joining does not
   redirect repeatedly and that reconnect restores the existing seat.

Use the dashboard for these settings. Railway's current documentation says new
services cannot opt into the older `railway.json` / `railway.toml` configuration.
No project, paid service, domain or deployment has been created by this change.
Choose the team's plan and spending limit before deploying.

## Limits and next steps

- A nearby hosted server can remove the tunnel route, but it cannot remove Wi-Fi,
  sensor-recognition, animation or display delay. Compare the same phone and
  network before and after; do not promise zero latency.
- Rooms and game sessions are not durable. A server restart/redeploy loses lobby
  memory, and a TV reload resets the local match. Deploy between play sessions.
- For multiple replicas, first design shared room/session state and Socket.IO
  routing/adapters. Adding Redis alone does not persist the TV's physics state.
- After solo tuning, prioritize calibration across devices, reconnect/turn-state
  checks, and sustained session/load tests before adding more game features.

Official references checked November 2, 2026:
[Dockerfiles](https://docs.railway.com/builds/dockerfiles),
[HTTPS domains](https://docs.railway.com/networking/public-networking),
[WebSockets](https://docs.railway.com/networking/public-networking/specs-and-limits),
[healthchecks](https://docs.railway.com/deployments/healthchecks),
[regions](https://docs.railway.com/deployments/regions),
[runtime variables](https://docs.railway.com/variables/reference),
[configuration notice](https://docs.railway.com/config-as-code).
