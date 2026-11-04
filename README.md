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

## Use Case: Join and play a motion-controlled game

### Primary actors: Host and player

### Goal: Players join a shared game using their phones as controllers, complete the game, and view the results.

### System: Wee Sports

### Trigger: The host selects "create room"

### Preconditions: The host has opened the application, and players have network access to the shared session

### Basic Scenario

Host first chooses to create the room

1. The host creates a room, and the system/website displays a QR code
2. Players scan the QR code, enter their names, and join the room.
3. The system displays the connected players on the host's lobby screen, host selects a game.
4. Players grant motion permission, complete controller calibration instructions, and mark themselves ready.
5. Once all players are ready, host starts the game.
6. Players move their phones to perform actions in selected game.
7. The system responds to player input, displays corresponding game actions, and updates scores. Steps 6 - 7 repeated until the game is finished.
8. The system identifies a winner based on game point counts, and displays this information.
9. Results are displayed, participants may replay, return to lobby, or leave the game.

### Variation flows

2.1. Join using a room code
2.1a. Player enters room manually instead of entering a room code
2.1b. System validates code, player enters their name, and joins
2.1c. Continue at step 3

4.1. Use button controllers where supposed
4.1a. Player makes decision on using button controller instead of motion controller
4.1b. System displays supported controls, player marks themselves ready
4.1c. Continue at step 5

7.1. Tied scores
7.1a. System applies the tied game rules
7.1b. If ties are allowed, displays tied players. Else, return to step 6, repeat until game outcome is determined.

### Exception flows

2.1. Expired or invalid room code
2.1a. The system displays an error and asks player to enter a valid code
2.1b. Return to step 2, or player chooses to leave and their participation ends

4.1. Motion permission denied or sensors unavailable
4.1a. The system explains the issue and offers a retry
4.1b. Return to step 4 or follow variation 4.1
4.1c. If neither option succeeds, the player cannot become ready. They may retry or choose to leave.

4.2 Calibration fails
4.2a. System provides instructions and asks player to calibrate.
4.2b. Return to step 4. Player cannot be ready until controller setup succeeds.  

5.1. A required player is not ready
5.1a. The system keeps the game in the lobby and identifies players who are not ready.
5.1b. Return to step 4 for players that are not ready. Continue at step 5 once required players are ready.

6.1. Player disconnects
6.1a. System pauses the game.
6.1b. The player reconnects and restores controller readiness, recalibrating if needed.
6.1c. Resume step 6 only after connection and controller readiness are reachieved.
6.1d. If connection period expires, system applies the 60-second session-expiration policy where their seat is removed,, and the room closes.  

Any step- User ends session
a. The system notifies the players and closes the room.
b. Game ends without completion, active players returned to lobby.