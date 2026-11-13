# Team integration test branch

`integration/all-proposals-test` combines proposals 1, 2, 4, 5 and 6 on
`juvs227/wee-sports` main at `78d04a0`. This is a testing branch: main is unchanged
and no pull request has been opened. It includes PR 14's current head (`04fc805`)
through the reviewed platform integration.

Included: browser phone controller and automatic setup; tennis/bowling gameplay,
scoring and live recovery; Expo controller; optional profiles, saved bowling games
and production handling; Classic/Island presentation switch. Table Tennis is absent.
Classic now has its own welcome page at `/?view=classic`; Play opens the familiar
sport cards at `/home?view=classic`. Island keeps the corresponding welcome/map
flow. Phones continue to enter their controller homepage in either presentation.

## Try the combined branch

Use Node 24 and npm 11, as specified by `.nvmrc` and `package.json`.

```sh
git clone --branch integration/all-proposals-test https://github.com/juvs227/wee-sports.git wee-sports-test
cd wee-sports-test
npm ci
npm run play
```

Open the local address printed by the server for desktop/touch-control testing.
For browser motion on a physical phone, follow the existing README's secure phone
setup (`npm run dev:phone`, which requires cloudflared). Stop the local server first.
For Expo, follow `apps/controller/README.md`; use the same server/room for a mixed
browser/native session. Do not point tests at a production profile database.

## Team acceptance pass

- Open Classic, press Play, switch to Island, return to Classic, then reload.
  Verify the selected view persists and both sport choosers open working rooms.
- Join Tennis from a real iPhone and Android phone. Test both hands, automatic
  motion setup, touch fallback, pause/resume, background/foreground and reconnect.
- Play Bowling with browser and Expo controllers; verify turn ownership, scoring,
  TV reload recovery and return to lobby. Test the larger room capacity with your
  team's available devices before release.
- Register a disposable profile, change preferences, finish a bowling game and
  verify history/saved-game recovery. Guest play should remain available.
- Repeat the home flow with narrow desktop windows, keyboard only and dark mode.

## Conflict-resolution behavior

No actionable regression was found in the independent review and automated checks.
The integration intentionally keeps our gyro stroke detector and automatic setup.
PR 14's orientation readings are optional diagnostic metadata; its calibrated
orientation classifier does not replace the active gameplay detector. See
`pr14-integration.md` for the decisions and fallback/cancellation behavior.

Automated tests and exports cannot establish physical sensor accuracy, camera or
permission behavior, installed native build behavior, real Wi-Fi latency, or every
multi-device combination. Those checks are the purpose of the acceptance pass above.

## Automated verification

The combined source passed 870 Vitest tests, 74 server tests, 68 native controller
tests and Android/iOS Expo exports. Compile/lint, production build and motion
replay passed. An independent review reran 170 targeted cases covering controller
lifecycle, optional orientation, transport validation and room handling.

Browser validation covers both presentation flows, phone joining, tennis swings,
bowling rolls and TV reload recovery, profile request failure/recovery, phone
Go home/Leave/Forget behavior, and five synthetic motion recordings (19 expected
strokes with both hands). This is software verification, not measured physical
motion accuracy. Test accounts and room data use disposable local storage.

To repeat automated checks after changes:

```sh
npm run check
npm test
npm run test:server
npm run test:motion
npm run build
npm --prefix apps/controller ci
npm --prefix apps/controller test
npm --prefix apps/controller run export -- --output-dir /tmp/wee-controller-export --max-workers 2
```

The `browser-home-view-smoke.cjs`, `browser-pr-stack-smoke.cjs`,
`browser-phone-home-smoke.cjs`, `browser-profile-readiness-smoke.cjs` and
`browser-tennis-stroke-motion-smoke.cjs` scripts run against a disposable built
server with Playwright available. Set `WEE_SMOKE_URL` and `WEE_SMOKE_CHROMIUM` to
your test server/browser. For the stack flow, enable `WEE_SMOKE_RECOVERY=1` and
`WEE_SMOKE_PROFILES=1`; run once normally and once with `WEE_SMOKE_VIEW=island`.
