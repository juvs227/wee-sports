# Version control and branch integration

Keep feature work on its feature branch. For this integration, use
`update-homepage`; `main` is not the integration destination. Keep commits
focused, check the current branch and working tree before changing history,
and avoid force pushes. Follow the team's pull-request review process before
merging any feature branch.

Commit the npm lockfile alongside intentional dependency changes. Generated
`build/`, `dist/` and TypeScript build-info output should not be imported from
other branches. Do not replace unrelated local changes to resolve a conflict.

## Integration sources checked November 2, 2026

The comparison baseline was `update-homepage` at `f40114e`. Adapt compatible
features to the current shared protocol and `src/Tennis` paths rather than
copying older versions of complete gameplay files.

| Source | Adopted or retained work |
| --- | --- |
| `updated-menu` at `2fdc60b` | Return-to-lobby behavior adapted to the current authenticated host/Player 1 flow and phone options. Current reset, connection pauses and saved phone setup remain authoritative. |
| `base-game`: `ce190f7`, `bf2e665`, `d6b838a` | Relative shared-protocol imports and explicit aliases in both Vite configurations. Generated assets from `d6b838a` are excluded. |
| `beta_release_readme` at `03df7a2`, also `base-game` at `bbe01a7` | The five manuals, adapted to the combined app, current tests, HTTPS phone setup and deployment scripts. |
| `main` at `4c98b55` | Missing `*.tsbuildinfo` ignore rule; existing ignore rules already cover the other proposed patterns. |

The `base-game` tip `4e6795d` only changes the client React Router version,
which was already present here. Its `bbe01a7` documentation commit also removes
workspaces and several run/test/deployment scripts and upgrades major tool
versions. Those unrelated package and lockfile changes are not part of this
integration. The current README is retained rather than replaced by the older
standalone-tennis instructions.

`game-menu` at `d0e34fc` predates the latest `updated-menu` work and needs no
second import. `home-page`, `tv-display`, `week4-reconnect` and
`juve-game-additions` were already ancestors of this branch. Older orientation,
swing-classification and early-prediction experiments are represented by the
current adapted controller and its regression fixtures.

`angle-randomization` at `062f2ca` uses an incompatible trajectory interface,
randomized placement and older service rules. It is not imported over the
current deterministic assistance and service-box rules. `ready-check` and
`tutorial-vote` remain separate tutorial-flow work requiring protocol adaptation.

## Follow-up through `updated-menu` at `ccf8b66`

Six newer menu commits add callback-based reset, bowling pause/resume, anchored
overlay fixes and P as the shortcut instead of Escape. The combined app adapts
pause to authenticated shared lobby state and existing TV/phone controls; it
does not replace the current gameplay entry points or physics. `base-game`
remains at `4e6795d`. See the [detailed comparison](../docs/branch-integration.md).

Keep this published branch's history. Rebasing onto `base-game` would replay
existing work against intentionally excluded dependency/workspace changes.
`e54e97d` synchronizes `origin/main` into this feature branch, retaining the
broader ignore rules with no source-tree change. Do not merge this feature into
`main` without the team's separate review and real-device playtest.
