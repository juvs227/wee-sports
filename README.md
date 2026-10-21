# Wee Sports

A React/Vite prototype for recording phone swings using browser motion sensors.

## Run

```bash
npm install
npm run dev
```

Open the local URL to view the UI. For phone sensors, keep Vite running and start an HTTPS tunnel in another terminal:

```bash
ngrok http 5173
```

Ngrok must already be installed and authenticated. Open its HTTPS forwarding URL on your iPhone. If the hostname changes, add the exact hostname to `server.allowedHosts` in `vite.config.js`.

## Record a swing

1. Open the HTTPS page on your phone and tap **Enable motion**. Allow access when prompted.
2. Select Tennis or Bowling and your playing hand. For tennis, choose a manual Forehand, Backhand, or Unknown label. These are recording labels, not automatic predictions. Keep the same phone grip and starting pose across examples.
3. Set the phone down, tap **Calibrate**, and leave it still for two seconds. Calibration estimates gyroscope bias and rejects obvious movement.
4. Pick up the phone securely, tap **Record swing**, perform one controlled swing, and tap **Stop recording**. Recording stops automatically after ten seconds, when readings stop, or when the page is hidden.
5. Review acceleration and rotation graphs, then download the JSON before refreshing. Starting another recording replaces the previous one.

Use a wrist strap. Keep hold of the phone throughout a simulated bowling release.

## Captured data and limits

Each sample includes elapsed time in milliseconds, browser sample interval, acceleration without gravity when available, acceleration including gravity, and rotation rate. Missing sensor vectors are stored as null, not zero. Acceleration is in m/s²; rotation is in degrees per second. Rotation magnitude uses the calibration bias correction; raw rotation rates are preserved in the export.

The UI shows live magnitudes, peak values, recording duration, and observed sample rate. Duration measures the captured window, not an automatically detected swing. Sensor availability and sampling rate depend on the phone/browser. Keep the page visible and phone unlocked.

This prototype does not estimate position, ball speed, swing phases, or a 3D trajectory. A future replay could use integrated rotation for a short approximate animation, with explicit drift and pivot assumptions.

## Validation

```bash
npm run build
```

On an iPhone, verify permission grant/denial, still and moving calibration, changing readings during motion, manual and automatic recording stops, background interruption, and JSON download. Confirm the file contains timestamped samples and units. On a computer without sensors, controls should remain unavailable and the page should explain the missing sensor stream.

## Orientation and stroke comparisons

Enabling motion also requests orientation permission when required. Motion recording remains available if orientation permission is denied. Live phone angles show alpha, beta, and gamma in degrees; missing or stale readings appear as dashes.

Three signed rotation graphs preserve alpha/beta/gamma direction, with a zero baseline and a reported range. Values are in degrees per second after gyroscope bias correction. Axis signs depend on grip and playing hand; they do not directly identify a stroke.

JSON version 2 includes the manual stroke label, playing hand, raw orientation, corrected rotation rates, and starting orientation. Relative orientation uses wrapped per-axis differences in [-180, 180), referenced to the first available angle reading during recording. These Euler differences are not a full relative 3D rotation. Orientation older than 500 ms is omitted. Compare labeled recordings to identify useful features before building a classifier.

On your phone, test orientation permission, angle changes during tilt, and signed graph values during opposite rotations. Check an export for labels, units, and null values when orientation is unavailable.
