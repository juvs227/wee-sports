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

- [Version control](manuals/VERSION_CONTROL.md)
- [Bug tracking](manuals/BUG_TRACKING.md)
- [Build system](manuals/BUILD.md)
- [Testing](manuals/TESTING.md)
- [Continuous integration](manuals/CI.md)

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

### 2. Install the phone tunnel client once

Phone motion needs HTTPS, including when the phone and laptop share Wi-Fi.
The development launcher creates a temporary HTTPS connection automatically
using Cloudflare Quick Tunnels. No account or domain is required.

On macOS:

```bash
brew install cloudflared
```

For Windows or Linux, use the
[official cloudflared downloads](https://developers.cloudflare.com/tunnel/downloads/).

### 3. Install dependencies

From the project folder:

```bash
npm ci
```

### 4. Run the game and phone connection

```bash
npm run dev
```

This builds the app, starts the server and secure tunnel, and checks that the
phone link is reachable. Open `http://localhost:5173` on the TV/laptop, choose a
sport, and scan the lobby QR with your phone. The QR uses the HTTPS address
automatically. There is no separate ngrok command or URL to configure.
`npm run dev:phone` is an alias for the same launcher.

Keep the terminal open while playing. Press Ctrl+C to stop the server and
tunnel together. The temporary public link changes on restart, so scan the new
QR each session. Anyone with the link can reach the app while it is running.
Re-run `npm run dev` after source changes to rebuild the phone-play session.

### Local editing or an existing tunnel

For local editing with Vite or keyboard-only testing:

```bash
npm run dev:local
```

This starts the local server without a tunnel. Plain HTTP on a LAN cannot
provide phone motion access. To use an existing HTTPS tunnel such as ngrok,
start that tunnel for port 5173 and pass its origin when starting the server:

```bash
PUBLIC_GAME_URL="https://your-tunnel-domain" npm run dev:local
```

The TV can stay on `http://localhost:5173`; its QR will use that secure origin.

## Operational Use Case

This prototype demonstrates a full end-to-end multiplayer web application:
- **Host / Display (TV/Laptop):** Connects to the local Vite/Node server, renders the 3D court/lane using Three.js and Cannon-es physics running at 120Hz, and displays an auto-generated QR code for phone pairing.
- **Controller (Smartphone):** Scanning the QR code opens the phone controller over a secure HTTPS tunnel. Reading device gyroscope/accelerometer motion data, it streams calibrated swing and roll inputs back to the host via WebSockets.
- **Full Flow:** Players pair their phones, calibrate motion, select Tennis or Bowling, and play an active match with live motion detection, score tracking, and automated bot or 2-player support.

## Play with built assets

Run `npm run play` to build once and serve the production assets on port 5173.
Stop an existing server on that port first. This avoids Vite development serving
overhead, but does not alter motion detection thresholds or network latency.
For phone sensors, keep using a trusted HTTPS tunnel or deployment and provide
its origin through `PUBLIC_GAME_URL` when needed. The bottom tennis swing-status
pill is hidden; scores and the serving marker remain in the top scoreboard.
