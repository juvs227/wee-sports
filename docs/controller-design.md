# Controller and game ownership

This is the contract for the functional PR stack. It does not include the
Classic/Island homepage experiment or Table Tennis. Read this with
[the branch order](pr-stack.md), [motion units](../shared/MOTION.md), and
[Bowling rules and recovery](bowling.md).

This document describes the complete stack. Features become available in order:

| Proposal | Availability |
| --- | --- |
| PR1 | Browser controller, authenticated input, readiness, candidate detection and room lifecycle; checkpoint requests are rejected until PR2 |
| PR2 | Upgraded TV games, scoring, practice and validated live-room checkpoints |
| PR4 | Expo controller using the shared motion contract |
| PR5 | Optional profiles, durable Bowling saves and production persistence |

## One owner for each decision

| Owner | Responsibilities | Must not do |
| --- | --- | --- |
| Phone | Permission, sensor readiness, aim preview, gesture recognition, touch controls, local preferences | Choose a player identity, award points, simulate the lane, or retry an uncertain delivery as a new throw |
| Server | Authenticate room membership; validate sport, turn, game, generation and host epoch; deduplicate actions; route input; persist valid checkpoints | Infer that a network acknowledgement means a frame was displayed, or simulate an alternative result |
| TV | Accept a legal delivery once; run physics, rules, camera and score display; publish authoritative state and stable checkpoints | Accept stale generations, let preview packets steer a released ball, or invent a mid-flight checkpoint |

Browser input travels through the controller iframe, the parent's `GameFrame`,
Socket.IO, `RoomStore`, the TV's `GameFrame`, and the game iframe. Bowling uses
this authenticated relay. Tennis additionally supports an authorized WebRTC
input path with relay fallback. An HTTPS local-development tunnel supplies phone
sensor access; it does not promise LAN latency.

## Bowling input has distinct stages

Sensor readiness and permission to release a ball are separate decisions.
There is no manual Arm button: automatic detection must reject positioning
movements before they can lock the preview or request a delivery.

| Stage | What happens | Exit condition |
| --- | --- | --- |
| Waiting | No delivery is allowed; show setup, other player, pause or connection state | Authoritative ready turn and live controller setup |
| Positioning | Fresh tilt updates the preview; 250 ms of quiet samples prepares recognition | Forward-dominant movement starts a candidate |
| Candidate | Keep the pre-movement aim privately; continue the live preview; do not lock or send a roll | At least three samples, 40 ms and 8 degrees of coherent forward pitch |
| Forward swing | Lock the pre-candidate aim; measure bounded power and curve | Existing duration, travel, peak and deceleration checks accept a complete swing |
| Awaiting result | Send one uniquely identified delivery; keep the turn latched | Explicit rejection, rolling state or authoritative next-ball boundary |
| Ball in play | TV alone simulates the ball and pins; phone adjustments cannot steer it | TV settles and scores the delivery, then announces the next turn |

Candidate onset requires at least 100 degrees/second of forward pitch and a
forward component at least 75% of total angular speed. Side-dominant motion,
reversal, subthreshold movement, invalid samples and gaps over 100 ms cancel
unconfirmed evidence. Confirmation uses the original candidate start and motion
history; it does not add a new wait after release. The complete swing still needs
its minimum 160 ms duration, 25 degrees of forward travel, 150 degrees/second peak
and valid deceleration. These are explicit engineering thresholds with synthetic
regressions, not a claim that every physical grip has been calibrated.

## Interruptions and recovery

- A brief foreground sensor gap may preserve established browser setup, but
  never joins the two halves of an interrupted gesture. Fresh aim resumes from
  current readings. Backgrounding, invalid time/sequence and screen rotation
  reset readiness; sustained silence requires fresh setup.
- Pause/reconnect changes cannot grant another roll in the same turn. A missing
  reply is not permission to resend the release. An authoritative next-ball
  transition retires the old pending action; a late reply cannot clear a newer one.
- Live aim is replaceable, sequence-checked data. A delivery is a once-only
  action carrying its own locked aim, power and curve. Dropped previews cannot
  change the committed delivery.
- TV reload resumes the last accepted stable checkpoint. It does not rerun an
  uncertain in-flight throw. Profiles add durable storage to the same contract.
- Saved tuning is validated by hand and expiry after fresh readings arrive.
  Permission, readiness and a verified stationary gyro estimate are distinct.

## Code map and evidence

| Concern | Source |
| --- | --- |
| Units, readiness and calibration | `shared/motion.js` |
| Browser lifecycle and phone UI | `src/controller/main.js` |
| Precise tilt preview | `src/controller/bowlingAim.js` |
| Automatic candidate, delivery and turn latch | `src/controller/motionGestures.js` |
| Native sensor integration | `apps/controller/src/motionCore.js` |
| Authenticated iframe/socket bridge | `client/src/components/GameFrame.jsx` |
| Room, generation and action validation | `server/src/RoomStore.js` and `server/src/app.js` |
| Lane simulation and scoring | `src/bowling/World.ts`, `physics.ts`, `match.ts` |

Checks must cover false positives as well as successful swings: diagonal wrist
positioning, brief pitch twitches, gaps, reversals, lock consistency, curved
swings, touch fallback, lost replies and a new turn. Browser integration checks
exercise joining, starting, pause/resume, scoring and checkpoint recovery.
The five recorded Tennis fixtures protect that game's existing recognition.

The automated Bowling fixtures are synthetic. Frame cadence on a local test
browser and socket round-trip timings do not establish physical-phone feel or
end-to-end motion-to-screen latency. Physical browser and Expo playtesting is
the release gate for sending the proposed PRs.
