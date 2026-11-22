# Motion contracts and compatibility

`motion.js` is pure JavaScript shared by the browser and optional Expo controller. Samples use monotonic receipt time in seconds, radians per second, metres per second squared, and Hamilton quaternions `{x,y,z,w}`. The phone frame is X to the right edge, Y toward the top, Z out of the screen. `screenAngle` is retained separately; tennis aim applies the explicit screen transform. Missing sensors stay absent. Total acceleration is not called gravity unless linear acceleration can be subtracted.

An optional `orientationTimeSeconds` identifies when the cached absolute
orientation was received, on the same local clock as `timeSeconds`. It is not a
hardware capture timestamp or a network latency measurement. It must accompany
an orientation and be between zero and the containing sample's time. Browser
motion samples can carry the same orientation timestamp when gyro events arrive
more often than orientation events. The aim integrator applies that attitude once and
integrates fresh gyro between updates, instead of repeatedly snapping back to
the cached pose. If attitude starts arriving after gyro setup, it anchors to the
current pose without a jump. Samples without this optional field retain the
existing contract that their attitude is fresh. Local recordings preserve the
field for faithful replay; these attitude samples remain local to motion processing.

`normalizeWebMotion` maps browser rotation-rate alpha → X, beta → Y, gamma → Z, converting degrees to radians. `normalizeNativeGyroscope` keeps native Gyroscope X/Y/Z and radians unchanged. `toLegacyMotionSample` reverses the browser mapping and returns the existing millisecond/degree fields. The unit conversion preserves recognizer inputs; it does not itself change detection thresholds. All five selected team-motion recordings pass through this round trip without changing recognized labels or peaks.

The primary [W3C rotation-rate definition](https://w3c.github.io/deviceorientation/#device-motion-event-rotation-rate-api) maps alpha=X, beta=Y, gamma=Z. This is independently corroborated by [Chromium's gyro event conversion](https://github.com/chromium/chromium/blob/main/third_party/blink/renderer/modules/device_orientation/device_motion_event_pump.cc) and [WebKit's native motion conversion](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/platform/ios/WebCoreMotionManager.mm). DeviceOrientation **Euler** alpha/beta/gamma use Z/X/Y instead; those are distinct fields. An earlier implementation relied on an inconsistent MDN/TypeScript description and permuted these axes incorrectly. The canonical conversion and inverse legacy adapter are corrected together, preserving browser detector values while restoring native/browser axis equivalence. Tests independently exercise a native X-axis underhand trace and reject pure Y/Z-axis traces. Synthetic equivalence does not replace real-phone grip and sign validation.

`createAutomaticMotionSetup` enables play after a short continuous real sensor stream (default 150 ms and at least five samples), even while the player is moving. Its initial zero bias is explicitly provisional; permission alone or cached values do not establish readiness. It refines a bounded bias estimate only after quiet samples at a caller-declared safe boundary. Neutral orientation updates are optional and safe-boundary-only, never midstroke. `read(nowSeconds)` revokes readiness after silent sensors without replaying an old sample. Gaps, rotation and background reset partial input; resuming collects fresh samples automatically. These timings are engineering defaults for real-device validation, not measured universal device guarantees.

`createMotionCalibration` remains available for diagnostics and requires a continuous stillness window and estimates bias in rad/s. Calibration is local and carries a screen angle/revision; `applyMotionCalibration` rejects a changed screen orientation. Automatic readiness replaces mandatory calibration UI. Tennis recognition and Bowling’s final release checks are preserved; Bowling now separately confirms forward-dominant candidate motion before locking aim (see `docs/controller-design.md`). `createRelativeAimController` outputs normalized orientation `[x,y,z,w]`, bounded reach and angular intent; it does not integrate acceleration into hand position. Duplicate samples are ignored; gaps, new calibration revisions and screen changes clear partial movement. Recenter/first resumed samples have zero angular velocity. The host determines contact and score.

`createTimeConstantFilter` uses `1 - exp(-dt/tau)`, so the same stationary target has the same response at 30, 60 and 100 Hz. It holds on out-of-order samples and resets after a long gap. Bowling uses its own adaptive filter in `src/controller/bowlingAim.js`: 12–35 ms depending on movement, with no integration through a sensor dropout. The former 84 ms setting is not the current implementation. None of these settings is a measured hardware latency result.

Automatic setup distinguishes startup continuity (`maxGapSeconds`, default 250 ms)
from established readiness (`readyGapSeconds`, defaulting to the same limit).
The browser retains established setup across foreground gaps up to 1.5 seconds;
the native default stays 250 ms. This preserves calibration/readiness only, never
partial gesture evidence or a quiet-bias fitting window. Backgrounding, invalid
time/sequence and screen rotation still invalidate setup. Saved browser Tennis
strength is restored only after fresh sensor readiness and same-hand/expiry
validation; it cannot turn provisional gyro bias into a verified calibration.

`createWebMotionAdapter` owns permission, browser motion/orientation subscriptions, visibility and page lifecycle. Start it directly from a player action. It does not infer successful calibration from permission. Optional orientation permission failure keeps gyro/touch usable. Dispose removes every listener. The existing controller uses `readLegacyWebMotion` so its degree-based recognizer contract is preserved; the tennis aimler can use the complete adapter.

Run `node scripts/replay-motion.mjs --json /tmp/wee-motion-report.json` to reproduce recognition measurements. Its report includes fixture Git blob and SHA-256 hashes, commit/runtime, sample counts, mode, confirmation timestamps and min/median/p95/max. These are offline recognition measurements; they do not measure phone capture, network travel, host contact, display latency or actuator onset. `npx vitest run server/tests/shared-motion.test.js` verifies unit/sign conversion, the recorded traces, time-based filtering, calibration continuity, pause/recenter behavior, trace privacy, permission cancellation and capability negotiation.

`controllerCapabilities.js` negotiates the protocol and supported tennis/bowling versions. Optional haptics and sensors never block a touch-capable controller. Unknown sports are not advertised or accepted.
