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

1. Choose Tennis or Bowling on the TV.
2. Join from a phone with a playing name. Use motion or touch controls.
3. Player one starts the game when the controllers are ready. Motion setup
   completes automatically after fresh sensor readings. Settings, pause, sound
   and changing sports are in the controller tools.

Tennis supports one player against a bot or two players, with assisted positioning,
racket contact detection and court-targeted shots. Its upgraded rules use best of
three sets, seven points per set, winning by two. Bowling supports
one to eight players and uses ten-frame scoring. Aim with the phone, then swing to
release the ball, or use the touch controls. Post-release spin is disabled for now;
there is no extra steering step after the ball leaves your hand.

Shared room membership authenticates input; old or duplicate actions cannot
become a new swing or roll after reconnect. The browser tennis controller can use
a private WebRTC data channel with the same server-authorized room boundaries and
a Socket.IO fallback.

### Tennis keyboard controls

- **J / K:** backhand / forehand swing.
- **Space:** serve when it is your turn.
- **B / Shift+B:** feed a practice ball.
- **N / Shift+N:** feed the bot.
- **H:** toggle debug hitboxes and location indicators.

Player positioning is assisted by default; manual movement keys do not override
that assistance.

## Expo controller

```sh
npm run expo:install
npm run expo
```

Scan the TV from the native app. The Expo controller shares motion normalization,
automatic setup, room lifecycle and gesture logic with the browser controller.
See [native setup](apps/controller/README.md) for development builds and device
permissions. Simulator/export checks do not establish real phone sensor latency.

## Optional profiles and recovery

Guest play remains available. Profiles provide preferences and bowling history.
Bowling saves stable roll boundaries to SQLite; solo saved bowling games can be
continued after a restart. Tennis supports live room boundary recovery, but does
not yet save profile match history. Interrupted swings and rolls are never replayed.

The production database defaults to `.wee-data/profiles.sqlite`. Configure
`WEE_PROFILE_DB` on durable storage for deployment. See [deployment](docs/railway.md)
and [profile backup commands](server/scripts/profile-db.js). Never put credentials
or reconnect tokens into public QR URLs.

## Check changes

```sh
npm run check
npm test
npm run test:server
npm run test:motion
npm run build
npm --prefix apps/controller test
npm --prefix apps/controller run export -- --output-dir /tmp/wee-controller-export --max-workers 2
```

`npm run check` compiles TypeScript and runs ESLint without changing files.
Use `npm run fix` explicitly to apply lint fixes. Browser checks use a disposable
local server and Playwright. Physical phone motion, camera permissions and feel
still require device testing.

See the [test-writing walkthrough](TESTING.md), [testing guide](manuals/TESTING.md),
[version-control guide](manuals/VERSION_CONTROL.md),
[bug-tracking guide](manuals/BUG_TRACKING.md), [build guide](manuals/BUILD.md),
[CI guide](manuals/CI.md) and [four-branch plan](docs/pr-stack.md).
