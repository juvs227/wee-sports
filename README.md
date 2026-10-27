# Wee Sports: phone → WebSocket → World

The phone detects a completed tennis stroke and sends one event to the Mac relay.
The Three.js World receives it and triggers a preset forehand/backhand animation.
It does not reconstruct the phone's exact motion or perform ball collision logic.

## Open the game and connect your iPhone

Use **two terminals on your Mac**. Leave both running for the whole session.
There is one app server and one ngrok tunnel; you do not restart ngrok to connect
the phone.

### 1. Terminal A: start ngrok

```sh
ngrok http 5173
```

Look for the Forwarding line, for example:

```text
Forwarding https://example.ngrok-free.dev -> http://localhost:5173
```

Keep this terminal open. Copy your actual HTTPS address. `example.ngrok-free.dev`
is a placeholder, not an address you can use. Ngrok must already be installed
and authenticated. A tunnel error before the app starts is expected; continue
with step 2.

### 2. Terminal B: start the app

Open another terminal in this repository:

```sh
cd /Users/juvesanchez/403/wee-sports
```

If this is your first run or dependencies changed, run `npm install` once.
Then use the hostname from Terminal A, without `https://` or a trailing slash:

```sh
NGROK_HOST=example.ngrok-free.dev npm run dev
```

Replace `example.ngrok-free.dev` with your actual hostname. Wait for:

```text
Game: http://localhost:5173
```

Leave this terminal running too. If you already started the app without the
correct hostname, press Ctrl-C in its terminal and rerun the command above.
Leave ngrok running.

### 3. Mac browser: open the game through ngrok

Open the **HTTPS Forwarding address from Terminal A** on your Mac, for example
`https://example.ngrok-free.dev`. Continue past an ngrok visit-site screen if shown.
You should see the court, a room code, and **Open phone controller**.

`http://localhost:5173` also works on your Mac. When the app starts with
`NGROK_HOST`, its phone-controller link automatically uses that HTTPS hostname,
even if the game is open on localhost. Restart the app and refresh the game
after changing `NGROK_HOST`. Without it, links use the current page address.

### 4. iPhone: open the controller link from that game

On the Mac, right-click **Open phone controller**, copy its link, and send it to
your iPhone (for example, with AirDrop or Messages). Open it in Safari.

The link should look like:

```text
https://example.ngrok-free.dev/controller.html?room=078a4f09
```

Use the hostname and room from your current game. **Do not open a localhost link
on your iPhone**: localhost there refers to the phone, not your Mac. Both pages
must display the same room code and Connected status.

### 5. Test, then swing

First expand **Test the connection without sensors** on the phone and tap
**Send Forehand**. The Mac player should animate. Then:

1. Select Left or Right and your preferred Response mode.
2. Leave Suppress return motions enabled initially.
3. Tap Enable motion and allow access.
4. Set the phone down, tap Calibrate, and keep it still for two seconds.
5. Pick it up securely, tap Start swings, and swing in a clear space with a wrist strap.

Listening continues until you tap Stop, readings stop, or the page is hidden.
Keep Safari visible and the phone unlocked. The WebSocket remains connected
independently of sensor listening. Unknown predictions are not sent to the game.
Green means Forehand; purple means Backhand. This is a preset 650 ms animation,
not an exact reconstruction of your phone's movement.

### If it does not connect

| Symptom | Check |
| --- | --- |
| iPhone cannot connect | Its address must start with ngrok's current HTTPS hostname, not localhost. |
| Ngrok says upstream connection failed | Terminal B must still show the running app on port 5173. |
| Blocked hostname message | Restart only the app with `NGROK_HOST` matching Terminal A's hostname. |
| Address already in use / EADDRINUSE | Stop the older app server with Ctrl-C before starting another. |
| Connected but no animation | Match the room codes; try the manual Send Forehand button first. |
| No motion readings | Use HTTPS, allow permission, and keep Safari visible and unlocked. |

To stop, press Ctrl-C in both terminals. On the next session, repeat from step 1;
use the new ngrok hostname if it changes. You do not need `npm run build` or a
separate WebSocket server to follow these steps.

## Files and protocol

- `server/main.js`: HTTP/Vite host and the WebSocket relay on `/swings`.
- `server/relay.js`: validates events and forwards them only to games in the same room.
- `src/network/swingConnection.js`: shared browser WebSocket client, reconnect,
  message IDs, and bounded duplicate protection in the game.
- `src/controller/main.js`: phone permissions, gyro calibration, detection, and sending.
- `src/controller/classifySwing.js`: `gyro-handed-v6` directional rules originally copied
  from branch `juve-swing-classification`. Future classifier edits must be synced
  deliberately; Git branches do not share live files.
- `src/World/World.js`: receives strokes via `world.swing(event)` and updates animation.
- `src/World/components/player.js`: stroke animation for the placeholder player.

Example message:

```json
{"type":"swing","id":"unique-event-id","label":"Forehand","hand":"Left"}
```

Clients connect to `/swings?room=<room-code>&role=phone` or `role=game`. The relay
returns an `ack` with the number of game connections it forwarded to; that is not
an acknowledgement that the game rendered the animation. Events while disconnected
are dropped, not replayed later. The game reconnects without reloading the page.

The original React recording UI remains on `juve-swing-classification`. To connect
it instead, reuse `swingConnection.js` with a relay URL on the Mac's HTTPS host
(its current default uses the page's origin), and send only newly completed
predictions. This branch includes a compact phone controller so the integration
can be tested end to end without running two branches at once.

This is an unauthenticated prototype: the room code routes messages but is not
account authentication. Use a trusted group and don't treat it as a public service.
The HTTP server binds all interfaces. Change `PORT` if 5173 is occupied and tunnel
the matching port. The relay requires Node; serving `dist` alone won't run it.

## Validation

```sh
npm test
npm run build
```

Tests cover relay room isolation, invalid messages, game/phone roles, and animation
direction/reset. On devices, verify both manual test buttons, left/right strokes,
permission denial, calibration failure, reconnect after a server restart, and no
animation for Unknown. The classifier is heuristic and still needs fresh recordings
to evaluate accuracy.

## Early prediction experiment

Branch `experiment/early-swing-prediction` adds a Response selector on the phone:
**Early · experimental** (default) and **Wait for completion**. Select before
starting. Early mode checks on every valid sensor event, requires at least 80 ms
of motion and 30 ms of repeated directional agreement, and sends immediately
without waiting for the 100 ms end-of-swing quiet period. It latches one event
until the motion drops below the existing relative quiet threshold for 100 ms.
A prediction can therefore precede the true peak and be wrong; it is not corrected
or resent when the motion later finishes. Return movements can still create
false events after the detector rearms. Sensor gaps reset temporal evidence.

Completion mode retains the existing classifier, now checked every 30 ms rather
than 150 ms. Calibration and sensor-timeout checks also run on that timer. Early
mode displays the measured time from its motion-threshold crossing to prediction.
That number excludes WebSocket transport and game rendering; it is not total
end-to-end latency. Compare fresh mixed sequences in both modes using the same
grip and hand, noting incorrect, missed, or extra swings as well as responsiveness.

Restart `npm run dev` if needed, refresh the controller at the same URL, and select
Early. Neither device needs a new room or tunnel. Existing workspace changes were
carried into the experiment branch and have not been committed; changing branches
alone does not save or discard those changes. The completion option provides an
in-app comparison without checking out another branch.

## Suppress return motions

The phone's **Suppress return motions** checkbox is enabled by default and applies
in both Early and Wait for completion modes. After an actionable prediction,
the detector enters Recovering. It accepts another swing only when both conditions
are satisfied: at least 400 ms since prediction delivery to the controller, and
250 ms of continuous rotation magnitude below 120 °/s. The quiet interval can
run during the cooldown; it is not an additional mandatory 250 ms afterward.
Movement resets quiet evidence, and sensor gaps do not count as stillness.

The phone shows Recovering or Ready. Recovery readings continue to be collected
in a bounded 150-sample diagnostic buffer available through the stream's
`recoverySamples` getter; they cannot trigger a stroke. This buffer is transient,
not an exported recording. Unknown predictions do not activate recovery. The
cooldown begins on a local actionable prediction even if the socket is currently
disconnected, so replaying a failed stroke cannot bypass the guard.

Stop listening to change the checkbox. Disable it to compare the original rearm
behavior. Suppression can miss rapid intentional strokes and cannot guarantee
rejection of a return performed after recovery has ended. Refresh the controller
to load the changes and test the option against your normal playing pace.
