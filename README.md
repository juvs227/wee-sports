# wee-sports

A browser-based tennis game controlled by keyboard input or phone motion.

## Controls

- **J/K** or **Phone Swing**: backhand/forehand swing 
- **B / Shift+B**: feed a practice ball
- **N / Shift+N**: feed the bot
- **H**: toggle debug displays (hitboxes and location circle)
- **W/A/S/D**: move manually (disabled)

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

## Running the system
### 1. Installing Node.js 24

Install Node.js 24 for your operating system from the
[official Node.js website](https://nodejs.org/en/download).

Verify the installation:

```bash
node --version
npm --version
```

### 2. Install Cloudflare (optional)

Cloudflare is only needed for deployment or an alternative tunnel. Follow the
[official Cloudflare guide](https://developers.cloudflare.com/tunnel/downloads/).

### 3. Installing dependencies
Open a terminal in the project folder, run
```bash
npm ci
```
to install dependencies from ``package-lock.json``

### 4. Install and use ngrok

ngrok is optional for local play. You need it to connect your phone when it is
not on the same local network as your computer.

Install ngrok from the [official ngrok website](https://ngrok.com/download),
then authenticate it with your ngrok token:

```bash
ngrok config add-authtoken YOUR_AUTH_TOKEN
```

After starting the game in Part 5, open a second terminal and run:

```bash
ngrok http 5173
```

Open the generated HTTPS URL on your phone. Do not share or commit your auth
token.

### 5. Running the game

```bash
npm run dev
```

For local play, open the link printed in the terminal, usually
`http://localhost:5173`.
An actual link printed in the terminal like ``https://rarity-underfoot-finale.ngrok-free.dev/`` also works (but requires ngrok configuration).

That is all the setup required to run the system. Cloudflare and ngrok are not
needed for local play (with keyboard control); ngrok is only needed for phone access outside your local
network.