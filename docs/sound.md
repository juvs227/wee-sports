# Tennis and bowling sound

Sound plays on the **TV/laptop**, with phone vibration as separate feedback.
Pressing **Play** in the homepage lobby now activates sound directly from that
click. The TV keeps the same audio context through the countdown and embedded
game. A compact speaker icon stays in the TV header and at the top of each phone.
Either can mute/unmute the shared TV sound, and all lobby members see the same
state. Toggling is quiet and does not play a test cue. An explicit saved mute is
respected; Play primes the context without turning sound back on. This lets a
phone unmute later without a second click on the TV.

If effects are silent, check the TV/laptop volume, selected output device and
browser tab mute. Direct standalone pages retain a single **Enable sound**
button. Browsers require a user gesture before audio starts; a suspended TV
context may need its speaker button tapped again.

The previous implementation created audio only inside the game iframe and
required a second, easy-to-miss Enable sound click after Play. The parent-page
context removes that extra activation step. This is a code-level fix to that
flow; physical output devices and listening balance still require a manual test.

## Files and sources

The 22 local, mono, 24 kHz, 16-bit PCM WAV files are under
`public/sounds/tennis/`, `public/sounds/bowling/` and `public/sounds/ui/`. Vite copies `public/` into the
production build. The server must serve `.wav` as `audio/wav`.

[Full sound credits and license/change notices](../public/sounds/ATTRIBUTION.md)
ship with the assets. Racket, ground and pin impacts use recordings; the rolling
bed uses recorded foley. Point/game/set/match and bowling-result cues are original
short synthesized chimes. They are not advertised as recorded sports effects.
The serve sound is the recorded racket impact, without a chime over the contact.
The countdown and Go cues use original bright, rounded chimes with an upbeat
family-sports feel. They contain no Nintendo recordings or copied melodies.
The existing five-second lobby countdown has a pip per displayed number, with
rising last-two pips and a distinct Go cue. Tennis serves do not restart it.

Research favored isolated effects over long match recordings: the Freesound
[racket hit](https://freesound.org/people/kletton97/sounds/710041/) and
[ground bounce](https://freesound.org/people/14GPanskaValaChristoffer/sounds/420173/)
identify the actual tennis actions; [Bruce Burbank's pin
recording](https://freesound.org/people/Bruce%20Burbank/sounds/151204/) identifies the
physical material; [qubodup's rolling
foley](https://opengameart.org/content/bowling-ball-rolling) provides a quiet,
loopable bed. The first, pin and rolling sources use CC0; the bounce requires
CC BY 4.0 attribution, which is included. These choices are based on the published
source descriptions and signal inspection. **They have not been auditioned in
this task; final perceived balance and timbre need the team's listening test.**

Leading silence was removed from impact samples to avoid adding audible delay
to an already accepted collision. A short tail fade prevents clicks. The rolling
loop has a crossfaded seam; impact and notification samples are one-shots. The
master gain is 0.55, with lower individual levels for rolling and score cues.
There is no continuous music or voice announcing every countdown.

## Event mapping

| Sport   | Event      | Trigger                                   | Sound                                               |
| ------- | ---------- | ----------------------------------------- | --------------------------------------------------- |
| Both    | `countdown` | Lobby numbers 5, 4 and 3                 | Short bright pip                                    |
| Both    | `countdown-2`, `countdown-1` | Final lobby numbers      | Rising pips                                         |
| Both    | `start`    | Countdown enters play                     | Original short Go chime                             |
| Tennis  | `hit`      | Accepted racket/ball contact in a rally   | Racket impact                                       |
| Tennis  | `serve`    | Ball actually served                      | Same racket impact; replaces `hit` for this contact |
| Tennis  | `bounce`   | Actual court bounce                       | Ground impact                                       |
| Tennis  | `point`    | A point is awarded, without ending a game | Short two-note cue                                  |
| Tennis  | `game`     | A game is won, without ending a set       | Three-note cue                                      |
| Tennis  | `set`      | A set is won, without ending the match    | Four-note cue                                       |
| Tennis  | `match`    | Match is won                              | Longer finish cue                                   |
| Tennis  | `fault`    | First serve fault                         | Soft low cue                                        |
| Tennis  | `let`      | Serve is replayed                         | Gentle repeated-note cue                            |
| Bowling | `release`  | An accepted delivery begins               | Short release/thump                                 |
| Bowling | `roll`     | Ball begins rolling                       | Quiet loop; only one instance                       |
| Bowling | `pin`      | First actual ball/pin contact per delivery | Recorded pin knock                                 |
| Bowling | `gutter`   | Delivery enters a gutter                  | Soft descending cue                                 |
| Bowling | `strike`   | Recorded result is a strike               | Ascending strike cue                                |
| Bowling | `spare`    | Recorded result is a spare                | Distinct three-note cue                             |
| Bowling | `result`   | Other completed delivery                  | Short finish cue                                    |
| Bowling | `match`    | Bowling match completes                   | Match finish cue                                    |
| Bowling | `roll-end` | First pin impact, gutter, settlement or turn end | Stops the loop; no new sound                   |

Emit only the highest tennis scoring event for a point, rather than playing point,
game, set and match cues together. Events must come from accepted game transitions
or contact results, not from sensor packets, scoreboard rendering or every frame.
This avoids false hits, repeated score sounds and sound storms.

## Integration and lifecycle

`client/src/lib/useTvAudio.jsx` owns the parent context and prefetches encoded
sound bytes while the lobby is open. It calls `unlock({respectMute: true})`
directly in Play, before waiting for fullscreen or a server acknowledgement.
Creating/resuming the context stays inside the user gesture. Decoding finishes
as individual assets arrive; one slow or missing sample does not hold up others.

The embedded game emits `{type: 'wee:game-audio', gameId, sport, event}`. The
homepage bridge accepts only its current iframe, same origin, current game and
sport, active connection and allowlisted event. It calls `onAudio(event)` on the
existing parent manager; the iframe does not create a second audio context.
`roll-end` stops the bowling rolling loop; a 12-second audio-clock deadline also
ends it if a final event is lost. `stop` clears all effects on reset or
teardown. Pause and document visibility also stop active effects.

`src/audio/tvAudioSession.ts` remembers countdown progress and whether each
current game has started. Snapshot polling, reconnect, backgrounding or skipped
countdown numbers cannot replay expired pips or Go sounds. Restoring directly
into an existing game is silent. A new lobby match can play a new countdown.
An explicit Play again/replay action may request the Go cue without repeating
the lobby countdown; ordinary serves never do.

`sound:set` carries only the desired boolean mute state. The server resolves the
current member's lobby, ignores any supplied room code, and publishes `soundMuted`
to that room. New lobbies initialize once from the TV's saved preference; subsequent
initialization/reconnect cannot overwrite a phone's choice. Replaced or disconnected
members cannot change sound. Mute updates neither reset the game nor change readiness.

Standalone pages use the same audio manager locally:

```ts
import {createSportsAudio} from './audio/sportsAudio';

const sound = createSportsAudio('tennis'); // or 'bowling'
sound.mountButton(document.querySelector<HTMLElement>('.game-panel')!);
sound.play('hit'); // returns false if silent, not ready, or throttled
sound.setActive(!paused); // pause stops every live source
sound.stop('roll'); // bowling settlement, reset or leaving the lane
sound.dispose(); // release sources, downloads, listeners and context
```

`mountButton` creates an accessible button and includes shared compact CSS.
Keep its container visible in immersive/fullscreen play. If providing a custom
control, call `unlock()` directly in its click handler, and use `setMuted(true)`
to mute. Never call `unlock()` from a socket update or a timer.

The audio manager can prefetch bytes before the click and decodes them after activation.
`play()` never waits, fetches, resumes a context, or queues events. A hit received
before its buffer is ready is dropped; it cannot play late. A missing asset,
denied browser permission or failed audio device stays silent without throwing
into gameplay. The button offers a retry if no buffers load. At most eight
sources play simultaneously, with impact cooldowns and only one rolling loop.
Mute, pause, hidden-tab and disposal paths stop current effects. Returning to the
tab never replays old contacts or restarts a stale rolling sound.

This follows MDN's guidance for
[user-gesture audio activation](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay),
[Web Audio buffer playback](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Using_Web_Audio_API),
and [game audio](https://developer.mozilla.org/en-US/docs/Games/Techniques/Audio_for_Web_Games).
Decoded buffer sources keep these short effects off the network path during play;
this does not remove Bluetooth/output-device latency or change motion latency.

## Rebuilding and checking

`python3 scripts/generate-sounds.py` regenerates only the original notification
cues. It neither downloads nor plays audio. Imported effects remain intact.

To reproduce the imported processing, obtain the public HQ preview MP3 files
linked by the source pages above and the OpenGameArt archive. Place these in a
temporary source directory with the following names, then run
`python3 scripts/generate-sounds.py --source-dir /path/to/sources` (requires ffmpeg):

- `wee-tennis-hit.mp3`
- `wee-tennis-bounce.mp3`
- `wee-pin.mp3`
- `wee-bowling-source/qubodup-bowling-roll/qubodup-bowling_roll-nofadeout.ogg`

Offline checks: `npx vitest run test/sportsAudio.test.ts`. These mock Web Audio;
they do not launch the game or play sound. They cover explicit activation, late
downloads, cooldowns, voice limits, loops, mute, pause, visibility, retry, disposal
and every manifest file's PCM header, size, sample format, non-silent content,
clipping bounds and prompt attack. The whole pack is bounded below 1 MB.

Manual test on the TV/laptop: press Play. Confirm pips follow the initial
countdown, Go sounds once, and serving or
scoring does not restart that countdown. Serve and rally, confirm a
point/game/set/match gets one appropriate result cue, then mute. A new match
must retain the mute preference. Unmute from the phone and verify the TV follows.
In bowling, confirm release → quiet rolling → actual pin impacts → result, and
that rolling stops at first pin contact or gutter entry, and on settlement. Pause or background either game during an
effect; returning should be silent until the next real event. Adjust the manifest
volumes after listening on your team's speakers, especially for repeated pins.
