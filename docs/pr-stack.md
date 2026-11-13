# Four proposed PR branches and a separate UI experiment

These are stacked changes based on team main `78d04a0`. No PR has been opened.
Review each branch against its predecessor to see only that proposal's changes.
Open PR 1 against team main first. After it lands, update PR 2 onto the resulting
team main, then repeat for PR 4 and PR 5. A squash merge requires rebasing the
remaining stack. These fork-only branches cannot be selected as base branches
for a PR in the team repository until the team creates matching branches.

| Proposal | Branch | Built on | Scope |
| --- | --- | --- | --- |
| 1 | `pr/1-platform-phone-controller` | team `main` | Shared protocol, authenticated input and reconnect lifecycle, automatic setup, browser phone UI, QR scanner, controller homepage, eight-player room capacity |
| 2 | `pr/2-gameplay-and-scoring` | PR 1 | Tennis/bowling gameplay, scoring, aim, feedback, TV rendering, stable live-room checkpoints |
| 4 | `pr/4-expo-controller` | PR 2 | Expo native controller, camera join, motion/touch input, local preferences, session recovery, native CI |
| 5 | `pr/5-profiles-and-production` | PR 4 | Optional web/native profiles, preferences, bowling history and durable saved games, backup/recovery and production hardening |

Expo and browser/native phone UI are included. Table Tennis is excluded from
every branch. PRs 1, 2, 4 and 5 keep the card homepage and exclude the island.
The Classic/Island work previously labeled PR 6 remains a test-only experiment;
it is not part of the four proposals being prepared for main.
Profile persistence is optional; the earlier branches run without a profile DB.

PR 1 deliberately rejects game checkpoints until PR 2 adds rule-aware validation.
PR 2 supports live room recovery; PR 5 adds durable bowling storage and saved solo
game continuation. Tennis profile history is not implemented in this source.

This order keeps shared changes in the platform proposal. It does not guarantee no future
conflicts: upstream PR 14 at `04fc805` is integrated into PR 1 and inherited by
the stack. Its eight shared-file conflicts are resolved. A changed or squash-merged
PR 14 still needs a fresh comparison. Do not merge these branches independently into the old team main.

Validation uses compile/lint, unit and server tests, recorded motion replay,
production builds and browser flows. PRs 4 and 5 also require native unit tests,
an Android/iOS Expo export and the native-to-server integration tests. Physical
phone motion remains a device test.


The homepage experiment is preserved in the separate fork branch and the Juv
integration test branch. Its homepage switch uses native
radio controls, preserves focus while loading, and remembers the choice locally.
Explicit `?view=classic` and `?view=island` links override the stored preference.
Island mode includes `/` (welcome) and `/home` (sports map); Classic works at both.
Phones retain the controller homepage. Both desktop views use one guarded room
creation path, so changing the presentation does not change lobby or game behavior.
Classic does not load island assets until selected, and stays available if an
island image or JS chunk fails. The island map offers Tennis and Bowling, with
Golf marked coming soon. No Table Tennis entry points, registry entries or assets
are added.

The browser checks can be repeated against a disposable built server using
`scripts/browser-home-view-smoke.cjs` and `scripts/browser-pr-stack-smoke.cjs`.
Set `WEE_SMOKE_VIEW=island` on the latter to exercise the island's game launches;
its default exercises Classic. Both accept `WEE_SMOKE_URL` and
`WEE_SMOKE_CHROMIUM`; the stack script also accepts `WEE_SMOKE_RECOVERY=1` and
`WEE_SMOKE_PROFILES=1`. They require Playwright on the Node module path.


The published functional repair heads are `fc97950` (PR 1), `76d1f38` (PR 2),
`aa6a20b` (PR 4), and `d02bf16` (PR 5). Each preserves its original branch history
and passed compile/lint, its full unit/server suites, recorded-motion replay and
production build. PRs 4 and 5 also passed their native tests; the combined repair
passed both Expo platform exports. Final PR5's application code is identical to
the accepted `test/prs-1-2-4-5` build at `62d228e`.


## Combined team test branch

`integration/all-proposals-test` combines the four functional proposals and the
test-only homepage experiment on team main in `juvs227/wee-sports`. Its existing
Classic welcome screen leads to the card chooser. The controller repair update
preserves both published homepage modes and does not add their UI to the four
functional branches. Both repositories' main branches remain unchanged.
See [integration-testing.md](integration-testing.md) for running and accepting it.
