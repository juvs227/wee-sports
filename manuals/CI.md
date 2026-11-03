# Continuous integration

The repository's [GitHub Actions workflow](../.github/workflows/ci.yml) runs on
pushes and pull requests. It uses Node 24 and runs:

```sh
npm ci
npm run compile
npm test
npm run build
```

`npm test` includes both the game/relay tests and the platform workspace tests.
The production build verifies every entry page and the required models. Keep
these scripts and npm workspaces intact when integrating another branch.

Check the actual workflow result for the pushed commit before merging. A local
pass is useful evidence but does not establish that remote CI has completed.
CI does not exercise physical phone sensors or the complete rendered UI; see
[manual checks](TESTING.md).
