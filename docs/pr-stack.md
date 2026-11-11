# Four proposed PR branches

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

Expo and browser/native phone UI are included. The island homepage and Table
Tennis are excluded from every branch. Desktop keeps the team's sport cards.
Profile persistence is optional; the earlier branches run without a profile DB.

PR 1 deliberately rejects game checkpoints until PR 2 adds rule-aware validation.
PR 2 supports live room recovery; PR 5 adds durable bowling storage and saved solo
game continuation. Tennis profile history is not implemented in this source.

This order avoids four copies of shared changes. It does not guarantee no future
conflicts: upstream PR 14 overlaps sensor/controller work and needs a fresh review
if it lands. Do not merge all four branches independently into the old team main.

Validation uses compile/lint, unit and server tests, recorded motion replay,
production builds and browser flows. PRs 4 and 5 also require native unit tests,
an Android/iOS Expo export and the native-to-server integration tests. Physical
phone motion remains a device test.
