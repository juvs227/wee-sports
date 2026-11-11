# Continuous integration

GitHub Actions runs on every push and pull request. It uses Node 24 and runs:

```sh
npm ci
npm run check
npm test
npm run test:server
npm run test:motion
npm run build
```

The root npm workspace installs `@wee/shared` automatically. The Node server
suite exercises actual Socket.IO authorization, input generations, host epochs
and lost acknowledgements in addition to in-memory state transitions. `check`
includes the TypeScript compiler and semantic ESLint checks for all first-party
JavaScript/JSX/TypeScript, including shared and native controller sources.

A separate `native-controller` job installs the pinned dependencies in
`apps/controller`, runs its scanner, session and sensor-lifecycle tests, and
exports Android/iOS bundles with two Metro workers. Native bundle output is
isolated in the runner's temporary directory and retained on export failure.
CI does not sign apps, deploy services, need production secrets, or establish
real-device acceptance. Both jobs use `.nvmrc` and their own npm lockfile cache.

Check the workflow result before merging.
