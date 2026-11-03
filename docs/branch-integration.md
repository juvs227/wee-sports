# Branch integration — November 2, 2026

Target: `update-homepage`. Teammate gameplay changes are selectively adapted
from the branches below rather than merged wholesale. The `main` branch is
unchanged.

## Follow-up branch check

`updated-menu` advanced from `2fdc60b` to `ccf8b66` with six commits:

| Commit | Teammate change |
| --- | --- |
| `eb5b97e` | Reset uses a callback instead of importing the tennis world. |
| `83b952f` | Correct pause-overlay background. |
| `a49bf5c` | Bowling pause/resume and page-suspension handling. |
| `29896d4` | Anchor the pause controls inside the game; fix bowling layout. |
| `d4760c6` | Use P instead of Escape so pausing does not exit fullscreen. |
| `ccf8b66` | Update the runtime shortcut test. |

`base-game` remains at `4e6795d`; it has no new commits since the prior port.
Neither branch introduces new physics or scoring algorithms in this follow-up.

The pause behavior is adapted to the combined app: Player 1's phone options and
the existing TV display menu control a server-authorized pause for either sport.
The TV's P shortcut also works while the embedded game has focus. Pausing does
not discard a match or controller setup. Resuming a manual pause cannot override
a disconnected device or unfinished controller setup. The current reset/replay
and return-to-lobby actions remain in use rather than adding a second reset path.
Hidden game pages stay stopped until page restoration receives fresh lobby state.

### Rebase and main readiness

Do not rebase this published feature branch onto `base-game`. Compatible changes
are already adapted; replaying the history would also encounter older package,
workspace and documentation changes that were deliberately excluded. A read-only
merge simulation at `93675c7` found seven conflicting paths against `base-game`,
ten against `updated-menu`, and one `.gitignore` conflict against `origin/main`.

Commit `e54e97d` incorporates `origin/main` (`4c98b55`) into this feature branch,
resolving the ignore conflict by retaining the existing broader rules. Its tree
is identical to its first parent: no gameplay changes or local edits were lost.
This does not merge the feature into `main`. The comparison with main spans
over 200 files, including earlier platform, game, asset and test work. Passing
tests and a clean merge are evidence for review, not a replacement for teammate
review and real-phone/two-player playtesting.

Git's [rebase documentation](https://git-scm.com/docs/git-rebase#_recovering_from_upstream_rebase)
also explains why rewriting a shared upstream can force downstream collaborators
to repair their histories.

## Included

- `updated-menu` (`2fdc60b`): the return-to-lobby behavior, adapted to the
  existing phone options and discreet TV display menu. Host or Player 1 can
  confirm the return; player seats, controller setup and sound preference stay
  in the room. Readiness and the finished game are cleared. Requests use the
  authenticated room and current game ID, so an old match cannot end a new one.
  The server remains the authority even during a reconnect pause.
- `base-game`: relative shared-protocol imports from `ce190f7`, the root Vite
  alias from `bf2e665`, and the client Vite alias portion of `d6b838a`. These
  make shared-code resolution explicit without changing dependency versions.
- `beta_release_readme` (`03df7a2`) / `base-game` (`bbe01a7`): the team manual
  structure, updated for this branch's integrated homepage, scripts, testing
  and HTTPS phone setup. The existing README remains the main entry point.
- `main` (`4c98b55`): ignore new TypeScript build metadata. Existing tracked
  generated files are not rewritten as part of this integration.

## Preserved or excluded

- The current Park Club court, lower camera, `src/Tennis` folder, phone settings,
  new-match/replay commands, calibration restoration and winner cards remain.
- The incoming overlay now supports both games through callbacks, but it still
  pauses locally rather than telling the phones/server. Its behavior is adapted
  to shared lobby state and current controls; its complete older game entry
  points and additional standalone overlay are not copied over this UI.
- `game-menu` is older than `updated-menu`, so it is not integrated separately.
- `base-game`'s documentation commit also changes dependency major versions,
  removes workspaces and removes integrated development/deployment/test scripts.
  Those unrelated changes and its generated build output are excluded.
- `angle-randomization` uses an older shot API and service planner. Current
  deterministic placement, legal service targets and racket contact remain.
- Earlier motion experiments are superseded by the current controller pipeline.
  `ready-check` and `tutorial-vote` change the onboarding state machine and are
  separate work, not requirements for this play-flow update.
- `home-page`, `tv-display`, `week4-reconnect` and `juve-game-additions` are
  already ancestors of this branch.

## Rules and results

The rules review found one concrete presentation bug: clearing a fresh final
rack after a tenth-frame spare displayed `X` but failed to announce a strike.
The roll classification now agrees with the scorecard. It still ends the game
after that bonus delivery; totals and physics parameters are unchanged.

Tennis set/match winners and bowling winners/ties remain visible on the TV.
The phone offers replay; a completed match does not restart automatically.
Tennis advantage, tie-break service order and best-of-three completion, and
bowling bonuses, tenth-frame racks and final totals have regression coverage.
See [tennis scoring](tennis-scoring.md) and [bowling](bowling.md) for rule sources
and the limits of the simulation.

Validation for this integration is recorded in [play polish](play-polish.md).
