# Build and run

Use Node 24 and install from the repository root with the committed npm lockfile:

```sh
npm ci
npm run compile
npm run build
```

Keep the `shared`, `server` and `client` npm workspaces. The root build produces
the homepage/lobby, tennis, bowling and phone-controller entry points in `dist/`.
It also verifies that all four HTML pages and both required GLB models were
included. The source models are in `public/assets/`; `build/`, `dist/` and
TypeScript build-info files are generated output, not integration inputs.

## Local editing and phone play

`npm run dev:local` runs the combined Node/Vite server, normally on port 5173.
Open its printed localhost address on the TV/laptop. The server also owns the
Socket.IO lobby and standalone tennis WebSocket relay; do not start a separate
client/server pair for the combined app.

For physical phone sensors, install `cloudflared` using the instructions in the
[README](../README.md#run-the-combined-app), then run:

```sh
npm run dev
```

`npm run dev:phone` does the same thing. The launcher builds the app and opens a
temporary HTTPS tunnel. Open localhost on the TV and scan the current lobby QR
on each phone. Keep the terminal open; stopping it stops that session. Restart
after source changes to rebuild. The tunnel address can change between runs.

A phone's plain `http://192.168…` address is not a secure sensor page, even on
the same Wi-Fi. Use the trusted HTTPS link and allow motion access on the phone.
Desktop localhost testing does not prove that a physical phone's permissions
or sensors work. A new tunnel hostname is a new browser origin and cannot reuse
saved calibration from the old address. On the same address, recent verified
setup can be reused; browser permission may still require a tap.

## Built app and permanent hosting

`npm run preview` serves the existing build with both relays for local checks.
`npm start` starts the combined server; with `NODE_ENV=production` it serves the
existing `dist/` build. Build before starting production. A trusted deployment
can supply `PUBLIC_GAME_URL` for its HTTPS QR origin; Railway's public domain is
also detected. See [Railway setup](../docs/railway.md) for the current deployment
configuration and in-memory room limitations.
