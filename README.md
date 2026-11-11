# Wee Sports

Play Tennis or Bowling on a computer or TV with a phone as the controller.
The desktop homepage uses sport cards. Phones open the controller homepage with
QR scanning, manual room entry and reconnect support. Golf remains coming soon.

## Run locally

Use Node 24 and npm 11 (`.nvmrc` and `packageManager` pin the supported tools).

```sh
npm ci
npm run dev
```

`npm run dev` starts the game and the secure phone-link launcher. Follow its URL
on the TV and scan the room QR on your phone. Motion sensors require HTTPS and a
permission gesture on supported browsers. Touch controls remain available when
sensors are unavailable. `npm run dev:local` starts local development without a
public tunnel. `npm run play` builds and serves production assets.

## Play

1. Choose Tennis or Bowling on the TV.
2. Join from a phone with a playing name. Use motion or touch controls.
3. Player one starts the game. Setup completes automatically after fresh sensor
   readings; settings, pause, sound and changing sports are in the controller tools.

Tennis supports one player against a bot or two players. Its upgraded rules use
best of three sets, seven points per set, winning by two. Bowling supports one to
eight players and uses ten-frame scoring. Shared room membership authenticates
input; old or duplicate actions cannot become a new swing or roll after reconnect.
The browser tennis controller can use a private WebRTC data channel with the
same server-authorized room boundaries and a Socket.IO fallback.

## Expo controller

```sh
npm run expo:install
npm run expo
```

Scan the TV from the native app. The Expo controller shares motion normalization,
automatic setup, room lifecycle and gesture logic with the browser controller.
See [native setup](apps/controller/README.md) for development builds and device
permissions. Simulator/export checks do not establish real phone sensor latency.

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

Browser checks use a disposable local server and Playwright. Physical phone motion,
camera permissions and feel still require device testing. See
[testing](manuals/TESTING.md) and the [four-branch plan](docs/pr-stack.md).
