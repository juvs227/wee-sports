# wee-sports

A browser-based tennis game controlled by keyboard input or phone motion.

## Setup

Requires Node 24.

```sh
npm ci
npm run dev
```

Open the game shown by the server. The phone controller is available from the
same server when supported.

## Controls

- **J/K**: backhand/forehand swing
- **B / Shift+B**: feed a practice ball
- **N / Shift+N**: feed the bot
- **H**: toggle debug displays
- **W/A/S/D**: move manually

## Features

- Phone and keyboard swing input
- Racket contact and collision detection
- Assisted player positioning
- Optional Player 2 bot
- Court-targeted shot trajectories

## Development

- [Version control](VERSION_CONTROL.md)
- [Bug tracking](BUG_TRACKING.md)
- [Build system](BUILD.md)
- [Testing](TESTING.md)
- [Continuous integration](CI.md)

The project follows the Google TypeScript Style Guide and uses GTS for
formatting and linting.
