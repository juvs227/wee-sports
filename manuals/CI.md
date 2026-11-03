# Continuous integration

GitHub Actions runs on every push and pull request. It uses Node 24 and runs:

```sh
npm ci
npm run compile
npm test
npm run build
```

Check the workflow result before merging.
