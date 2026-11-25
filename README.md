# Wee Sports

Play Tennis or Bowling on a computer or TV with a phone as the controller.
The desktop homepage uses sport cards. Phones open the controller homepage with
QR scanning, manual room entry and reconnect support. Golf remains coming soon.

## Run locally

Use Node 24 and npm 11 (`.nvmrc` and `packageManager` pin the supported tools).
Phone motion requires HTTPS. Install the official `cloudflared` tunnel client
once; the development launcher creates a temporary secure link automatically.
No Cloudflare account or domain is required.

On macOS:

```sh
brew install cloudflared
```

For Windows or Linux, use the
[official cloudflared downloads](https://developers.cloudflare.com/tunnel/downloads/).
Then, from the project folder:

```sh
npm ci
npm run dev
```

Open `http://localhost:5173` on the TV or laptop, choose a sport, and scan the
lobby QR on your phone. The QR appears after the launcher verifies that its HTTPS
address is reachable. `npm run dev:phone` starts the same launcher. Keep the
terminal open while playing; Ctrl+C stops the game and tunnel together. Scan a
new QR after restarting because the temporary address changes. Restart
`npm run dev` after source changes to rebuild the phone-play session.

Motion sensors require HTTPS and a permission gesture on supported browsers.
Touch controls remain available when sensors are unavailable.

### Local editing or an existing tunnel

`npm run dev:local` starts local development without a public tunnel. For phone
motion with an existing HTTPS tunnel, pass its origin when starting the server:

```sh
PUBLIC_GAME_URL="https://your-tunnel-domain" npm run dev:local
```

The TV can stay on localhost; its QR uses the secure origin. Plain HTTP on a LAN
does not provide phone motion access. `npm run play` builds and serves production
assets; provide a trusted HTTPS origin for phone sensors when using that command.

## Play
Check out [User Manual](manuals/USER_MANUAL.md)

## Check changes

```sh
npm run check
npm test
npm run test:server
npm run test:motion
npm run build
```

`npm run check` compiles TypeScript and runs ESLint without changing files.
Use `npm run fix` explicitly to apply lint fixes. Browser checks use a disposable
local server and Playwright. Physical phone motion, camera permissions and feel
still require device testing.

See the [test-writing walkthrough](TESTING.md), [testing guide](manuals/TESTING.md),
[version-control guide](manuals/VERSION_CONTROL.md),
[bug-tracking guide](manuals/BUG_TRACKING.md), [build guide](manuals/BUILD.md),
[CI guide](manuals/CI.md) and [four-branch plan](docs/pr-stack.md).
