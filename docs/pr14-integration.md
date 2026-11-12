# PR 14 compatibility

The platform branch merges team PR 14 at `04fc805aaaedb9a543ed7ff4fe2cc395203e9188`.
The later proposals inherit this merge; it is not a separate feature proposal.

- Retain the current phone UI, automatic setup, gyro stroke recognition, placement,
  reconnect/pause behavior and `GameFrame`; do not restore `PrototypeFrame`.
- Integrate PR 14's Android quaternion source and iOS gyro/gravity estimate as
  optional orientation metadata. `netNormal` is the initial direction for this
  play session, not a measurement of the court. It does not decide aim, readiness
  or scoring. Touch and Expo controllers work without this metadata.
- Preserve the two normal vectors through relay, embedded and direct input.
  Validate and copy them; accept both the placement-object and PR 14 argument forms.
- Clear stale readings and references across pause, cancellation and sensor
  fallback. Failed or unavailable native sensors fall back without an extra prompt.
- Keep the TV's debug display behind its existing D toggle and fix timeout cleanup.
- Keep the orientation diagnostic page, with an allowlisted server and loopback
  default. Use a trusted LAN or HTTPS tunnel for optional phone diagnostics.

Regression coverage exercises native failure/cancellation, fallback data validity,
metadata transport, pause/reconnect, protocol validation and legacy orientation
classification cases. Recorded browser motion is replayed; real iOS/Android sensor
hardware still requires a device check. The unchanged PR 14 head is an ancestor of
all proposal branches, which removes its current merge conflicts. Future upstream
edits or a squash merge may require another compatibility pass.
