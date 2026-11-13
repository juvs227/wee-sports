# Team integration test branch

`integration/all-proposals-test` combines functional proposals 1, 2, 4 and 5 with
the separate, test-only Classic/Island experiment on `juvs227/wee-sports` main at
`78d04a0`. This is a testing branch: main is unchanged
and no pull request has been opened. It includes PR 14's current head (`04fc805`)
through the reviewed platform integration.

Included: browser phone controller and automatic setup; tennis/bowling gameplay,
scoring and live recovery; Expo controller; optional profiles, saved bowling games
and production handling; Classic/Island presentation switch. Table Tennis is absent.
The presentation switch is not included in the four functional PR branches.
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
- While Bowling is ready, tilt gently to aim and make a short positioning motion:
  the guide should keep moving without an accidental roll. A deliberate forward
  swing should lock the chosen line and release once. Post-release spin stays disabled.
- Register a disposable profile, change preferences, finish a bowling game and
  verify history/saved-game recovery. Guest play should remain available.
- Repeat the home flow with narrow desktop windows, keyboard only and dark mode.

## Validated source and integration behavior

The user accepted the functional test build `62d228e` on `test/prs-1-2-4-5`.
The current QR startup heads are `c8615f2` (PR 1), `9a537ba` (PR 2),
`f90600d` (PR 4), and `d82162a` (PR 5); each contains team main `78d04a0`.
The QR change belongs to PR 1 and is inherited by the other proposals. The
complete stack merged cleanly into integration base `47caedc`. It changes only
phone-link discovery and development-session startup, with accompanying tests
and documentation. Motion recognition, native controllers, server gameplay and
the existing Classic/Island pages remain identical to that tested base.
No gameplay changes were introduced to avoid conflicts.

Build and tunnel provisioning now overlap, but the QR still waits for a verified
public HTTPS URL. While no URL is available, the TV retries discovery every
second; a ready link returns to the normal ten-second refresh interval.

The integration keeps our gyro stroke detector and automatic setup.
PR 14's orientation readings are optional diagnostic metadata; its calibrated
orientation classifier does not replace the active gameplay detector. See
`pr14-integration.md` for the decisions and fallback/cancellation behavior.

Automated tests and exports cannot establish physical sensor accuracy, camera or
permission behavior, installed native build behavior, real Wi-Fi latency, or every
multi-device combination. Those checks are the purpose of the acceptance pass above.

## Automated verification

The QR integration passed 923 Vitest tests across 89 files, compile/lint and
its production build, including verification of the existing Island assets.
PRs 2, 4 and 5 each also passed all 38 focused QR-startup tests. Focused browser
verification checked the localhost TV's secure QR, recovery from a connecting
response, and controller loading through the advertised HTTPS phone URL.

Before this QR update, the functional integration passed 74 server tests,
recorded-motion replay, 72 native controller tests and Android/iOS Expo exports.
GitHub CI passed for its four functional repair heads. Those results describe
the preceding repair; native, gameplay and motion sources are unchanged here.

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
`browser-bowling-aim-smoke.cjs`, `browser-phone-home-smoke.cjs`, `browser-profile-readiness-smoke.cjs` and
`browser-tennis-stroke-motion-smoke.cjs` scripts run against a disposable built
server with Playwright available. Set `WEE_SMOKE_URL` and `WEE_SMOKE_CHROMIUM` to
your test server/browser. For the stack flow, enable `WEE_SMOKE_RECOVERY=1` and
`WEE_SMOKE_PROFILES=1`; run once normally and once with `WEE_SMOKE_VIEW=island`.

## Before future PRs

Accept the combined branch on real phones first, including both sports and mixed
browser/Expo play. Then submit the functional proposals in order: 1, 2, 4, 5.
After each lands, update the remaining stack onto the new team main and rerun its
checks plus the combined acceptance pass. Recheck team main before publishing
each proposal; an earlier clean merge cannot guarantee future conflict-free merges.
Keep the Classic/Island experiment separate until the team explicitly wants it.
