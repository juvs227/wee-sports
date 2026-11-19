# Four-PR review stack

The four proposals are open in `juvs227/wee-sports` as **#19 → #20 → #21 → #22**.
Their source branches are in `necromancerrr/wee-sports`. The November 18 sync uses
team main `6efe90e01e1c6578ae91460ea7aa2c7b28e4d434` as its upstream baseline;
the previous submission was based on `78d04a0`.

| Proposal | GitHub PR | Source branch | Review base in team repo | Scope |
| --- | --- | --- | --- | --- |
| 1 | [#19](https://github.com/juvs227/wee-sports/pull/19) | `pr/1-platform-phone-controller` | `main` | Shared protocol, authenticated input and reconnect lifecycle, automatic setup, browser phone UI, QR scanner, controller homepage, eight-player room capacity |
| 2 | [#20](https://github.com/juvs227/wee-sports/pull/20) | `pr/2-gameplay-and-scoring` | `pr/1-platform-phone-controller` | Tennis/bowling gameplay, scoring, aim, feedback, TV rendering, stable live-room checkpoints |
| 4 | [#21](https://github.com/juvs227/wee-sports/pull/21) | `pr/4-expo-controller` | `pr/2-gameplay-and-scoring` | Expo native controller, camera join, motion/touch input, local preferences, session recovery, native CI |
| 5 | [#22](https://github.com/juvs227/wee-sports/pull/22) | `pr/5-profiles-and-production` | `pr/4-expo-controller` | Optional web/native profiles, preferences, bowling history and durable saved games, backup/recovery and production hardening |

PR #19 targets team main. PRs #20–22 are drafts against matching copied branches
in the team repo, so each review shows only its proposal's incremental changes.
Keep those copied review bases aligned when a prerequisite source branch changes.
After each prerequisite lands in main, update/rebase the next branch onto the
resulting main, retarget its PR to main, rerun checks and then mark it ready.
A squash merge requires rebasing the remaining stack. Do not merge the drafts
into temporary review-base branches or merge all four independently into main.

## Scope boundaries

Expo and browser/native phone UI are included. Island, Classic/Island switching,
the experimental landing page and Table Tennis are excluded from every proposal.
Desktop keeps the team's sport cards. Profile persistence is optional; the earlier
branches run without a profile DB.

PR 1 deliberately rejects game checkpoints until PR 2 adds rule-aware validation.
PR 2 supports live room recovery; PR 5 adds durable bowling storage and saved solo
game continuation. Tennis profile history is not implemented in this source.

## November 18 upstream sync

PR #14 is already merged into team main through `28e6608`; it is no longer a
pending dependency at its earlier `04fc805` review snapshot. Its orientation
support remains optional metadata for compatibility. The gyro-based detector
continues to recognize gameplay gestures automatically, with the existing motion
thresholds and setup flow. The sync does not introduce a manual arming step or
re-enable post-release Bowling spin.

The team's live Bowling aim feedback is preserved through the authenticated
controller-input stream. Preview updates remain tied to the current room, player,
game and input epoch; they do not bypass the existing release/turn checks.
PR 1 retains main’s thicker line; PR 2 uses its existing filled arrow with locked
feedback and reusable geometry, preserving that visibility without a second guide.

Upstream already contains the lint/config cleanup from #42 and #53, the new test
walkthrough from #54 and generated-output cleanup from #55. Preserve those fixes
without repeating the old GTS import problem or replacing our comprehensive,
non-mutating `npm run check` with a narrower auto-fixing CI command. The combined
configuration keeps Node 24/npm 11, shared declarations, ESNext/bundler resolution,
no emitted TypeScript build output, and the existing server/motion/QR checks.
`TESTING.md` uses the preserved acceleration detector for its example; the active
phone detector has a different input format.

This order avoids four copies of shared changes. It does not guarantee conflict-free
future merges: compare against the exact current team main and prerequisite head
whenever the stack changes.

## Validation status

### Historical submission before the November 18 sync

These successful runs validate the previously submitted heads, not the new merge
with `6efe90e`:

| Proposal | Previous head | Historical CI |
| --- | --- | --- |
| 1 | `c8615f2` | [Passed](https://github.com/necromancerrr/wee-sports/actions/runs/43370160817) |
| 2 | `9a537ba` | [Passed](https://github.com/necromancerrr/wee-sports/actions/runs/43370161025) |
| 4 | `f90600d` | [Passed](https://github.com/necromancerrr/wee-sports/actions/runs/43370160558) |
| 5 | `d82162a` | [Passed](https://github.com/necromancerrr/wee-sports/actions/runs/43370160468) |

### Current November 18 sync

| Proposal | Latest-main validation |
| --- | --- |
| 1 | Compile/lint, 783 unit tests, 31 server tests, 19-stroke motion replay and production build passed; browser smoke recorded in PR #19 |
| 2 | Compile/lint, 849 unit tests, 51 server tests, motion replay, production build and browser recovery passed |
| 4 | Compile/lint, 849 unit tests, 53 server tests, production build, 68 native tests and Android/iOS export passed |
| 5 | Compile/lint, 896 unit tests, 74 server tests, motion replay, production build, 72 native tests and Android/iOS export passed; browser results recorded in PR #22 |

Validation uses compile/lint, unit and server tests, recorded motion replay,
production builds and browser flows. PRs 4 and 5 also require native unit tests,
an Android/iOS Expo export and native-to-server integration tests. Record the
resulting heads and fresh results in each PR description after checks finish. Physical phone
motion and real phone-to-TV latency remain device tests; prior CI or browser
results do not establish device feel for a newly synced branch.
