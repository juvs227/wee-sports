# Wee Sports: phone → WebSocket → World

The phone detects a completed tennis stroke and sends one event to the Mac relay.
The Three.js World receives it and triggers a preset forehand/backhand animation.
It does not reconstruct the phone's exact motion or perform ball collision logic.

## Run

```sh
npm install
npm run dev
```

Open `http://localhost:5173` on your Mac. The game creates a room and displays a
phone-controller link. Open that link in a second browser tab and use **Send
Forehand** / **Send Backhand** to test the relay and player animation without sensors.
The socket and HTTP pages share port 5173; a separate WebSocket tunnel is unnecessary.

## Use your iPhone

Start `ngrok http 5173` in a second terminal. Stop and restart the app with the
exact ngrok hostname allowed (hostname only, no https://):

```sh
NGROK_HOST=your-host.ngrok-free.dev npm run dev
```

Open the HTTPS ngrok URL **on your Mac**, then send that page's phone-controller
link to your iPhone. Both pages must have the same room code. Opening the game
through ngrok ensures the controller link uses the reachable HTTPS hostname.
The socket automatically uses `wss://` for HTTPS pages and `ws://` for localhost.

On your phone, choose Left or Right, tap **Enable motion**, set it down and tap
**Calibrate**, then pick it up securely and tap **Start swings**. Perform controlled
swings. Completed Forehand/Backhand predictions are sent once per detected window;
Unknown is displayed but not sent. Listening continues until you tap Stop, readings stop, or the page is hidden.
The WebSocket stays connected independently of sensor listening. Completed
windows are consumed and old idle samples are discarded to bound memory. Use a wrist strap and clear your swing area.

The game shows the received hand and stroke. Green is Forehand; purple is
Backhand. The player rotates through a 650 ms animation; hand reverses its
animation direction. A new stroke replaces an animation already in progress.

## Files and protocol

- `server/main.js`: HTTP/Vite host and the WebSocket relay on `/swings`.
- `server/relay.js`: validates events and forwards them only to games in the same room.
- `src/network/swingConnection.js`: shared browser WebSocket client, reconnect,
  message IDs, and bounded duplicate protection in the game.
- `src/controller/main.js`: phone permissions, gyro calibration, detection, and sending.
- `src/controller/classifySwing.js`: unchanged `gyro-handed-v6` classifier copied
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
