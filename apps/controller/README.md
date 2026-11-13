# Optional Wee Sports controller

The normal phone-camera QR link still opens the complete browser controller.
This Expo app is an additional client for the same rooms, rules and shared
motion core. Installing it is never required to play.

## Try it from your PC

Use Node 24 and keep your phone and PC on the same Wi-Fi. This app uses **Expo
SDK 58**. On Android, install the matching **SDK 58 Expo Go** from
[Expo's download page](https://expo.dev/go), rather than assuming the store
version matches. The camera, sensors, haptics and secure storage used here are
included in Expo Go; no custom native module is required for this path.

From the repository root, install the controller dependencies once:

```sh
npm run expo:install
```

Keep the game running in one terminal:

```sh
npm run dev
```

Open `http://localhost:5173` on your TV/PC and create a room. In a second
terminal, also at the repository root:

```sh
npm run expo
```

1. Scan the **terminal's Expo QR** with Expo Go to open Wee Sports Controller.
2. Inside the controller, tap **Scan TV code** and scan the **TV's room QR**.
3. Enter your playing name, tap **Play**, and allow motion if asked. The first phone taps **Start game** when the
   group is ready. Keep both terminals running.

The first QR opens the app; the second joins your game. The TV QR still opens
the browser controller when scanned with your phone's normal camera.

If Expo cannot reach your PC over Wi-Fi, restart only the Expo terminal with
`npm run expo -- --tunnel`. Expo's tunnel loads the native app; the game server
has its own HTTPS tunnel from `npm run dev`. Local Wi-Fi is preferable for
loading the app. A tunnel does not establish low gameplay latency.

### Using an iPhone from Windows, Linux or Mac

The App Store version of Expo Go stops at SDK 54, so it **cannot open this SDK
58 project**. Use a development build of this controller instead. The included
[`eas.json`](eas.json) has a `development` profile for installation on your own
devices, with `expo-dev-client` already installed.

On any PC, Expo's hosted build service can compile the iPhone app. This route
needs an Expo account and **paid Apple Developer Program membership**. Before
your first signed build, set `ios.bundleIdentifier` in `app.json` to an app ID
you control. From the repository root, install dependencies, then work in the
controller folder:

```sh
npm run expo:install
cd apps/controller
npx eas-cli@latest login
npx eas-cli@latest build:configure
npx eas-cli@latest device:create
npx eas-cli@latest build --profile development --platform ios
```

Follow Expo's prompts to connect your project and Apple signing account, choose
an app identifier you own, and register your iPhone. Open the resulting install
link on that registered iPhone. Signing credentials belong in Expo's CLI/account
flow, never in the repository. This uploads source and creates an internal
development build; it does not submit an App Store release. Hosted build quotas
or fees depend on your Expo plan. These commands are for you to run; no remote
build, upload or signing was performed in this workspace.

After installation, return to the repository root. Keep `npm run dev` running
for the TV, and run `npm run expo:dev` in a second terminal. Open the installed
controller and connect to that Metro QR/link. Then tap **Scan TV code** inside
the controller and scan the TV's room QR. Later JavaScript changes need only
Metro; rebuild after native dependency or native configuration changes.
The current Tools, icons and scoring update adds no native dependencies. Your
existing matching iPhone development client can reload it from Metro. If it
still shows an older screen, run `npm run expo:dev -- --clear` and reload.

On a Mac with Xcode and a connected iPhone, you can build locally instead:

```sh
npm run expo:install
npm --prefix apps/controller run ios -- --device
```

Xcode/device provisioning must be set up for your Apple account. Start the
installed app on later runs with `npm run expo:dev`. The browser controller
remains available without an Expo or Apple developer account.

An SDK 58 Expo Go build distributed through your own TestFlight internal team
is another option; that needs Apple Developer Program membership. Physical iOS
Expo Go also requires Expo CLI and the app to use the same Expo account. Those
distribution/account steps are separate from this repository.

For an Android development build instead of Expo Go, install Android Studio's
SDK/JDK and connect a phone with USB debugging, then run
`npm --prefix apps/controller run android -- --device`. On later runs use
`npm run expo:dev`.

### Connection and validation

For a physical phone, the game server must have a reachable **HTTPS** origin.
The standard `npm run dev` command supplies it in the TV's room QR. Your name
and manual entry are optional. The scanner
accepts only HTTPS `/join?code=XXXX` links, unmounts its camera after scanning,
and never accepts a private account or room token in a QR. Manual room entry
and **Continue in browser** are always available. In development builds only,
the origin field also allows HTTP localhost, 127.0.0.1 and Android's 10.0.2.2
emulator bridge. It does not permit arbitrary plaintext LAN servers.

The native project has its own lockfile. It imports `../../shared` and the pure
bowling recognizer from the repository; keep it in this checkout. Expo SDK
58.0.23, React 19.3.0, React Native 0.88.1 and the camera, sensor, secure-storage
and feedback modules are pinned to the versions listed by this SDK. From the
repository root:

```sh
npm --prefix apps/controller test
npm --prefix apps/controller run export
```

`export` produces JavaScript/Hermes bundles, not an installable APK/IPA. The
checked-in application IDs (`dev.weesports.controller`) are development defaults.
Choose owned IDs and distribution/signing configuration before publishing.

Compatibility instructions checked against Expo's official
[SDK 58 camera](https://docs.expo.dev/versions/v58.0.0/sdk/camera/),
[sensors](https://docs.expo.dev/versions/v58.0.0/sdk/sensors/),
[SecureStore](https://docs.expo.dev/versions/v58.0.0/sdk/securestore/),
[version mismatch](https://docs.expo.dev/troubleshooting/expo-go-version-mismatch/),
[iOS sign-in](https://docs.expo.dev/troubleshooting/expo-go-sign-in-required/),
[development builds](https://docs.expo.dev/develop/development-builds/introduction/)
and [internal distribution](https://docs.expo.dev/build/internal-distribution/)
documentation on 7 November 2026.

## Try the controller

Optional profiles use the same server's `/api/profile` API. Sign-in tokens and
room recovery tokens and guest-history ownership proofs are kept in SecureStore and scoped to the confirmed
server origin. Account identity is provided only through the Socket.IO
authentication handshake. Preferences and history are available without making
accounts a prerequisite for play. Signing in claims saved guest results only on
their original server. Raw sensor recordings and device calibration
are not uploaded to profiles.
Profile requests have a ten-second deadline, including response-body loading.
If a request times out, reopen the profile before trying a change again; the
server may already have accepted it. Guest-result claiming stops at the first
temporary failure and retains unsubmitted ownership proofs for a later sign-in.
Scan the QR from the same running TV/server you use in the browser to reach
the same rooms and profile data. Expo's Metro QR only loads the app; it does
not choose a separate game server or create a separate profile service.

## Measurement and remaining device checks

Local recognition and host-confirmed contact use different haptic
cues. Haptics may be disabled or unavailable without blocking play. The camera
is closed before motion play. Pause, suspension and newer input generations
cannot replay old poses or feedback.

Verified in this cloud workspace:

- 62 native transport/scanner/automatic-setup/sensor-lifecycle, gravity fixture, touch-paddle and guest-claim tests, including cancellation
  while either sensor permission request is unresolved, native tennis forehand /
  backhand traces and transient inactivity without sequence replay or reconnect.
- An iPhone source-based fixture with a 12-second permission prompt and delayed
  first sensor callback reaches automatic readiness, phone-led Start and one
  actual `ControllerSession` roll. Additional fixtures cover raw sensor fallback,
  upright-to-screen-up play, and 30 Hz gravity with 60 Hz gyro during fast aiming.
- Delayed roll acknowledgements and outcome checks cannot revive an abandoned
  match or unlock a newer delivery; pause generations preserve unresolved rolls.
- Tools suppress actual bowling/swing input while deliberate game commands and
  neutral TT freshness keep working. Tests cover quiet return, completed-input
  suppression, left-handed poses, failed-leave identity retention and live scores.
- The 60 Hz pose and bowling-aim streams, burst bounds and congestion drops
  through the real native session class.
- Metro/Hermes export for Android and iOS, using the pinned SDK dependencies.
- Installed versions checked against the SDK's bundled native-module manifest.
- The root `npm run expo` command starts Metro in Expo Go mode; local Android
  and iOS SDK 58 manifests and development bundles returned HTTP 200. This
  validates the loading path, not installation or execution on a phone.
