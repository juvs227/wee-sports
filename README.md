# Wee Sports

A React/Vite prototype for recording phone swings using browser motion sensors.

## Run

```bash
npm install
npm run capture
```

Open the local URL to view the UI. For phone sensors, keep the capture server running and start an HTTPS tunnel in another terminal:

```bash
ngrok http 5173
```

Ngrok must already be installed and authenticated. Open its HTTPS forwarding URL on your iPhone. If the hostname changes, add the exact hostname to `server.allowedHosts` in `vite.config.js`.

## Record a swing

1. Open the HTTPS page on your phone and tap **Enable motion**. Allow access when prompted.
2. Select Tennis or Bowling and your playing hand. For tennis, choose a manual Forehand, Backhand, or Unknown label. These are reference labels, kept separate from the experimental gyro predictions. Keep the same phone grip and starting pose across examples.
3. Set the phone down, tap **Calibrate**, and leave it still for two seconds. Calibration estimates gyroscope bias and rejects obvious movement.
4. Pick up the phone securely, tap **Record swing**, perform one controlled swing, and tap **Stop recording**. Recording stops automatically after ten seconds, when readings stop, or when the page is hidden.
5. Review acceleration and rotation graphs, then download the JSON for permanent storage. The latest recording is backed up locally every 500 ms and when stopped. Reloading restores its samples, labels, and export metadata; starting another recording replaces it. Enable motion and recalibrate after a reload.

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

JSON version 3 includes the manual stroke label, playing hand, raw orientation, corrected rotation rates, and starting orientation. Relative orientation uses wrapped per-axis differences in [-180, 180), referenced to the first available angle reading during recording. These Euler differences are not a full relative 3D rotation. Orientation older than 500 ms is omitted. Compare the reference labels with the experimental predictions to evaluate the rules.

On your phone, test orientation permission, angle changes during tilt, and signed graph values during opposite rotations. Check an export for labels, units, and null values when orientation is unavailable.

## Experimental screenshot-based classification

After calibration, select Tennis and record one or several swings, returning to
rest between them. Each completed rotation burst receives Forehand, Backhand, or
Unknown, with a reason, signed rates at peak rotation, and approximate integrated
rotation in degrees. The actual-stroke selector never affects predictions.

Rules in `src/classifySwing.js` use the supplied screenshots only. Numerical
cutoffs are provisional engineering choices, not measurements recovered from raw
recordings. The original rules apply to a right-hand grip matching the examples. Version 5
adds separate left-hand rules from supplied recordings, rather than flipping
every axis. Bowling is not classified.

A burst starts at 250 °/s rotation magnitude. Version 3 ends it after 100 ms below the greater of 120 °/s or 35% of its peak, allowing separation without a full return to rest.
Accepted windows need at least five samples, 80–1500 ms duration, and a peak of
350 °/s. At peak rotation:

- Alpha below −250 and beta below −200 °/s suggests Backhand.
- Gamma below −450 °/s and at least 1.2 times the absolute alpha/beta rates
  suggests the alternate Backhand pattern.
- Beta above 250, alpha above 100, and gamma above −450 °/s suggests Forehand.
- Other patterns and incomplete windows return Unknown. Left-hand rules are described below.

Missing axes or gaps over 100 ms split windows. These rules cannot establish
classification accuracy from screenshots. Test fresh forehands, backhands, and
non-swing motions with the same grip before relying on the labels.

Degrees use trapezoidal integration of bias-corrected rates within each detected
window. They exclude motion outside the window and are per-axis approximations,
not full 3D rotations. They are displayed for inspection, not used as classification
thresholds because the screenshots contain no measured angle ranges.
JSON exports include classifier version, predictions, reasons, and features.

Run `node --test src/classifySwing.test.js` for synthetic rule and segmentation
checks. These tests verify implementation behavior, not real-world accuracy.

## Recording recovery

The latest recording is backed up in this browser's local storage, including
partial recordings. Reloading recovers it as a stopped recording; it does not
resume sensor capture or reuse calibration for new captures. An abrupt browser
termination can lose samples since the last half-second checkpoint. If storage
is blocked or full, the app displays a warning and recording remains available
in memory for JSON download. Clearing browser data removes the backup.

Recovery requires the same browser and origin (protocol, hostname, and port).
Changing the ngrok hostname gives the app a different storage area. Download
JSON before switching URLs. Storage is a recovery aid, not a permanent archive.

If the development server connection is causing reloads, use the built app while
capturing: run `npm run build`, then `npm run preview -- --host 0.0.0.0`, and tunnel
its displayed port (normally `ngrok http 4173`). This avoids development hot
reloads. The cause of the reported phone restart has not been reproduced.

Verify on iPhone: record, stop, reload the same URL, and confirm the sample count,
predictions, and JSON metadata survive. Also reload during recording and check
that recent progress returns. Run `node --test src/*.test.js` for storage recovery,
corruption, quota handling, and classifier checks.

## Stable phone capture and gentler swings

Use `npm run capture` for phone testing. Stop the existing dev server with Ctrl-C
first, then run this command and keep `ngrok http 5173` pointing at the same port.
Capture builds the app and serves static files without Vite's development client,
hot updates, or its reconnect-triggered reloads. It refuses to silently switch
ports if 5173 is occupied. Reload the phone once after switching servers. Future
code changes require stopping and rerunning `npm run capture`, then refreshing.
Use `npm run dev` when you want automatic updates during UI development.

Version 2 rules lower the rotation start threshold from 350 to 250 °/s, minimum
peak from 500 to 350 °/s, and forehand beta/alpha cutoffs from 350/150 to 250/100
°/s. The quiet threshold is now 120 °/s. This accepts gentler motions but can admit
more false positives; direction, duration, and Unknown checks remain in place.
The plotted peaks are still the measured values, not clamped or scaled.

Static capture removes one possible reload source; it cannot prevent Safari tab
termination, manual refreshes, or ngrok connectivity issues. The local recording
backup remains active. Keep the same ngrok URL to access that backup.

## Recorded-sequence segmentation fix (version 3)

The supplied two-forehands/one-backhand recording exposed a merged 2.83-second
window spanning the second and third swings. Its peak directions were usable,
but the duration check rejected the entire window. Version 3 uses a relative
quiet threshold (35% of the current peak, with a 120 °/s floor) to separate bursts
while the player is still moving. Completed bursts below 350 °/s are ignored.
To suppress broad recovery movements, a completed peak must rise from at most
half its magnitude within the preceding 250 ms of the window. Peaks at a window
boundary are retained because the approach is unavailable.

The trimmed gyro fixture in `src/fixtures/two-forehands-one-backhand.json` retains
only sample timestamps and corrected axis rates from the supplied recording.
The regression test expects three separate predictions: Forehand, Forehand,
Backhand, at 1142, 2575, and 4142 ms. This verifies the reported failure; it is not
an independent accuracy evaluation. Slower, broader strokes may require further
tuning. JSON export records classifier version `gyro-valleys-v3`.

## Offset gyro peaks (version 4)

The four-backhand recording showed beta reaching its negative peak slightly
before total rotation. The first and fourth swings had beta rates of roughly
−191 and +64 °/s at peak rotation, although nearby samples showed strong negative
alpha/beta agreement. Version 4 also accepts a backhand when alpha is below
−250 °/s at peak and at least two samples within ±60 ms have alpha below −250
and beta below −200 °/s, spanning at least 16 ms. Negative alpha alone or one
isolated beta spike does not activate this extension. Original peak-direction
rules and segmentation checks remain in place.

The trimmed `four-backhands.json` fixture verifies all four labels, alongside the
previous mixed sequence. Both recordings informed these rules; fresh recordings
are needed to assess accuracy. Export version is `gyro-peak-window-v4`.

## Left-hand reference recording (rules pending)

`src/fixtures/left-four-forehands.json` preserves trimmed corrected gyro samples
and the user-reported four-forehand sequence. The current detector produces five
candidates. Four have positive alpha and negative beta/gamma near 1.022, 2.188,
3.505, and 4.805 seconds; the extra candidate near 4.122 seconds has reversed
signs and may be recovery motion. That interpretation is not independently
verified. Do not label all five windows as forehands or use the extra window as
a backhand training example. This reference was collected before left-hand classification was enabled; see
the version 5 update below.

## Left-hand classification (version 5)

Select Left before recording. Separate rules now classify left-hand swings:

- Forehand: peak alpha above 250, beta below −150, gamma below 100 °/s,
  with repeated positive-alpha/negative-beta agreement within ±60 ms.
- Backhand: peak alpha below −250 °/s and at least 75% of rotation magnitude,
  with beta at most 100 or gamma at least 250 °/s. Repeated negative alpha
  within ±60 ms is required.
- Support needs at least two samples spanning 16 ms. Ambiguous directions stay
  Unknown. Duration, peak, and segmentation guards still apply.

This is an empirical mapping for the recorded grip, not a mirror of all axes.
The beta/gamma guard keeps the extra reversed movement in the four-forehand
recording Unknown. It cannot guarantee rejection of all return movements.

The left mixed fixture returns Forehand, Backhand, Forehand, Backhand. The four
forehands return four Forehands plus one Unknown recovery candidate. Both original
right-hand regression recordings still pass. The four-backhand file was inspected
but became unavailable before its raw samples could be saved; tests for it use
synthetic bursts at the observed peak rates, not a full recording replay.

Version `gyro-handed-v5` is included in JSON exports. These examples informed
the rules; test fresh recordings to evaluate accuracy. Restart `npm run capture`
and refresh the same phone URL to load the update.

## Left backhands with variable beta/gamma (version 6)

The second four-left-backhand recording exposed an overly strict beta/gamma
filter: three valid swings were detected but returned Unknown. Their negative
alpha peaks ranged from roughly −969 to −1282 °/s, while beta and gamma varied.
Version `gyro-handed-v6` adds a backhand path when alpha remains dominant
(at least 75% of peak rotation magnitude) and at least two samples within ±60 ms
of the peak have alpha below −850 °/s, spanning at least 16 ms. This bypasses the
beta/gamma direction guard; all other detection and hand checks remain.

The threshold is empirical and conservative, not a physical distinction between
strokes and return motion. A strong return movement could still be mislabeled;
a gentler backhand may remain Unknown. The previous forehand fixture's reversed
return stays Unknown. Regression coverage includes all four new backhands, both
mixed-hand fixtures, and rejection of an isolated strong-alpha spike. Fresh
recordings are still needed for accuracy evaluation.
