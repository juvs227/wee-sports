# Build system

Use Node 24 and install dependencies with:

```sh
npm ci
```

Build the game and controller with:

```sh
npm run build
```

The build also checks that the required models exist in `public/assets/`.

For phone play, install `cloudflared` once (`brew install cloudflared` on macOS),
then run:

```sh
npm run dev
```

The launcher builds into `.phone-build/`, starts the combined server and a
temporary HTTPS tunnel, and configures the lobby QR automatically. Open
`http://localhost:5173` on the TV/laptop and keep the terminal running.
`npm run dev:phone` is an alias. Restart after source changes to rebuild.

Use `npm run dev:local` for local Vite editing without a phone tunnel. See the
[root README](../README.md#running-the-system) for setup on other systems and
existing HTTPS tunnels.
