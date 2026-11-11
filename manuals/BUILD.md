# Build

Use Node 24 and npm 11. Run `npm ci`, `npm run check`, then `npm run build`.
The build verifies the four entry pages (`index.html`, `game.html`,
`controller.html`, `bowling.html`), player/racket models and controller font.
`npm run play` serves the built output. Use `npm run dev` for a secure phone link
or `npm run dev:local` for local development. Motion input needs HTTPS on phones.

Expo is a separate package: `npm --prefix apps/controller ci`, then
`npm --prefix apps/controller run export -- --output-dir /tmp/wee-controller-export --max-workers 2`.
See its README for device development builds.
