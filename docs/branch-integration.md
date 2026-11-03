# Branch integration — November 2, 2026

Target: `update-homepage`. Changes are selectively adapted from the fetched
branches below; these branches were not merged wholesale. `main` is unchanged.

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
- The incoming standalone pause overlay stops only its local tennis world.
  Importing it would leave phones/server unaware of the pause and restore an
  obsolete `src/World` import. It is not added. Reconnect pause continues to
  stop play through the existing shared lobby state. A future manual pause
  should use that same server-authorized state for both sports.
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
