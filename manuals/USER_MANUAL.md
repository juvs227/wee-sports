
1. Choose Tennis or Bowling on the TV.
2. Join from a phone with a playing name. Use motion or touch controls.
3. Player one starts the game when the controllers are ready. Motion setup
   completes automatically after fresh sensor readings. Settings, pause, sound
   and changing sports are in the controller tools.

To exit, tap **Go home** on the phone and confirm. **Keep playing** cancels the
exit. Confirming releases that player's seat and returns an active match to the
TV's lobby, where its QR can be used to join another game. Remaining players stay
in the room. Temporary connection drops still use the reconnect grace period;
an intentional exit does not wait for that timer. A saved room on the phone
homepage can also be released with **Leave room**.

During a temporary disconnect, the TV and phone notices show the remaining
reconnect time for each missing player. An offline phone labels its local timer
as an estimate until server updates return. Expiry is decided by the server;
host sessions held without a deadline display a waiting message instead.

Tennis supports one player against a bot or two players, with assisted positioning,
racket contact detection and court-targeted shots. This foundation branch preserves
the team's current tennis rules; PR 2 adds the scoring upgrade. Bowling supports
one to eight players and uses ten-frame scoring. Aim with the phone, then swing to
release the ball, or use the touch controls. Post-release spin is disabled for now;
there is no extra steering step after the ball leaves your hand.

Shared room membership authenticates input; old or duplicate actions cannot
become a new swing or roll after reconnect. The browser tennis controller can use
a private WebRTC data channel with the same server-authorized room boundaries and
a Socket.IO fallback.

### Tennis keyboard controls

- **J / K:** backhand / forehand swing.
- **Space:** serve when it is your turn.
- **B / Shift+B:** feed a practice ball.
- **N / Shift+N:** feed the bot.
- **H:** toggle debug hitboxes and location indicators.
