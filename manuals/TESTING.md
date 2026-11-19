# Testing

Run `npm run check`, `npm test`, `npm run test:server`, `npm run test:motion`
and `npm run build`. Native branches also run `npm --prefix apps/controller test`
and an Expo export. Unit and integration tests cover scoring, motion fixtures,
authenticated transport, replay prevention, reconnects, profile storage and recovery
when those features are present in the branch.

The branch smoke runner checks the real built browser application against a
disposable local server. It covers the card homepage, phone entry, a bowling roll,
a tennis swing and phone/TV state. Use a separate temporary `WEE_PROFILE_DB` for
profile checks. Do not run automated account or room tests against production.

Synthetic motion recordings check the software pipeline; physical iPhone/Android
motion, camera access, haptics, background recovery and perceived responsiveness
still need hardware acceptance testing.
