# Railway operations

This repository is prepared locally for Railway; no service, domain, volume or
deployment was created during the readiness pass. See
[the PR stack](pr-stack.md) for scope and [testing](../manuals/TESTING.md)
for verification commands and remaining device checks. Browser guest play is the default.
Accounts and the native controller remain optional. The display browser still
runs the sports simulation.

## Service configuration

After the owner authorizes deployment, use the Railway dashboard:

| Setting | Intended value |
| --- | --- |
| Source | `necromancerrr/wee-sports`, `main` (owner-selected deployment branch; includes the reviewed sports-platform work) |
| Repository root | `/` |
| Builder | Root `Dockerfile`; verify Railway detected it |
| Build/start overrides | Empty; Docker installs/builds and runs `node server/main.js --production` |
| Runtime | Node 24, npm root lockfile, `0.0.0.0:$PORT` |
| Replicas / region | One replica in one region near the players |
| Sleep / serverless | Disabled for active play sessions |
| Healthcheck | `/health`; suggested startup timeout 60 seconds |
| Restart | On failure, with a bounded retry limit; investigate repeated failures |
| Termination | Configure/confirm at least 15 seconds after SIGTERM; application deadline is 10 seconds |
| Persistent storage | One volume mounted at `/data`, `WEE_PROFILE_DB=/data/profiles.sqlite` |
| Public networking | One HTTPS origin for site, Socket.IO and `/swings`; generated or custom domain |

Do not run multiple replicas or overlapping writers to this volume. Rooms and
connection ownership are process-local. A shared Socket.IO adapter alone would
not make room state or display physics durable. Deploy between play sessions.
Choose region, resource limits and budget deliberately; a short local soak is
not a production capacity claim. Watch CPU, RSS, restarts and volume usage before
changing the resource allocation.

The Dockerfile runs `npm ci --include=dev` (including the compile/prepare hook)
and `npm run build`. Build tooling is required during installation. The image
starts the built app directly and runs as `node`, UID/GID 1000. It retains build
tooling for the simplest verified image; image-size optimization is optional.
Application code remains root-owned and readable by the runtime user, including
when the source checkout uses restrictive directory/file modes. Only the private
database directory needs to be writable by `node`.
The production Dockerfile uses standard certificate roots and strict TLS.
It contains no secret mounts: Railway's Dockerfile validator rejects those,
even when marked optional. Any inspecting-proxy certificate setup belongs in
the local development environment, not this deployment Dockerfile.

Use dashboard settings for this preparation; no `railway.json` or `railway.toml`
was added. Current official Railway pages were inaccessible from the audit
environment on November 8, 2026 (HTTP 403), and the expected official GitHub docs
mirror returned 404. The prompt's configuration-deprecation statement could
not be independently confirmed. Before staging, recheck the linked official
configuration, volume, networking and teardown documentation and confirm the
current dashboard controls, especially termination grace and mount ownership.

## Variables and origins

All variables below are configuration, **not secrets**. Profile passwords and
session tokens belong in neither environment examples nor logs.

| Variable | Scope | Default / requirement | Purpose |
| --- | --- | --- | --- |
| `PORT` | Runtime | Railway supplies it; local default `5173` | One HTTP/realtime listener; invalid values fail startup. `0` supports disposable local tests. |
| `NODE_ENV` | Runtime | Docker sets `production` | Production behavior and secure profile cookies; `--production` also selects the production server. |
| `PUBLIC_GAME_URL` | Runtime | Optional HTTPS origin, e.g. `https://sports.example.com` | Canonical custom-domain QR/join origin; takes precedence over Railway domain. Paths, credentials and local/private addresses are rejected in production. |
| `RAILWAY_PUBLIC_DOMAIN` | Runtime | Platform supplied after domain setup | Used as `https://<domain>` when no custom public URL is set. |
| `CLIENT_ORIGIN` | Runtime | Optional comma-separated exact HTTP(S) origins | Additional trusted browser Socket.IO/relay origins. Same request host and canonical public origin are already allowed. No wildcards, paths or credentials. Leave unset for the single-origin service. |
| `WEE_PROFILE_DB` | Runtime | Local `.wee-data/profiles.sqlite`; **set `/data/profiles.sqlite` for durable Railway profiles** | SQLite database, WAL and shared-memory files require a writable persistent directory. |
| `WEE_BUILD_DIR` | Build and runtime | `dist`; leave unset in Railway | Disposable validation output override; build and runtime must use the same directory. |
| `VITE_SERVER_URL` | Build, public bundle | Unset | Optional separate Socket.IO service for development; leave unset so deployed sockets use the page origin. |
| `VITE_PUBLIC_URL` | Build, public bundle / development runtime | Unset | Legacy local public-URL override; leave unset on Railway. Production runtime ignores this fallback. |
| `NGROK_HOST` | Build / development runtime | Unset | Legacy development tunnel host; leave unset on Railway. Production runtime ignores it. |
| `PHONE_LINK_MANAGED` | Development runtime | Unset | Private launcher IPC tunnel status when `1`; ignored by production runtime. |

Never put a host/member token in a URL. QR URLs are `/join?code=ABCD` on the
canonical public HTTPS origin. `/api/phone-link` must return that origin and
`status: "ready"` when configured. Without a canonical setting, the browser can
use its own HTTPS origin; configure the domain explicitly for predictable QR
links. The server never constructs a redirect from an arbitrary forwarded host.
Test custom and generated domains for redirect loops. TLS terminates at the
platform; clients use HTTPS/WSS with the same public port. Verify both Socket.IO
WebSocket and HTTP polling transports on the actual staging domain.

Browser handshakes reject unknown/malformed origins for both realtime paths;
native requests may omit Origin. Platform Socket.IO actions require room/member
authorization. The standalone `/swings` prototype relay uses its supplied room
identifier and role, without platform/profile credentials; anyone who knows its
room identifier can join with a native client. Platform game iframes use the
authenticated Socket.IO path, not that legacy relay. Neither path establishes
adversarial or ranked-game security. Per-connection action limits and stale-input
guards constrain bursts, but do not replace ingress abuse monitoring.
`CLIENT_ORIGIN` does not enable cross-origin profile HTTP cookies. Profile web
requests remain same-origin, with HttpOnly/SameSite=Strict/Secure cookies in
production. Profile authentication allows 10 attempts per account and 100 per
peer address per 15 minutes, at most four concurrent password operations. The
server does not trust arbitrary forwarded addresses for those limits.

## Storage and recovery

| Location | State and recovery boundary |
| --- | --- |
| Server memory | Live rooms, seats, connection ownership, ready/paused state, input epochs and pending delivery. Lost on process restart. |
| Display browser | Live physics/animation; mid-roll and mid-rally state is not a durable server simulation. |
| Browser/native storage | Local session identity, settings, and optional authentication credentials according to each controller adapter. Not a substitute for the database. |
| SQLite volume | Accounts, sessions, preferences, participants, committed results/history, stable checkpoints and continuation reservations. |

An in-memory reconnect can restore a valid existing seat within its grace
period. After a process restart, room codes expire. Signed-in owners can create
a new room from supported saved **solo Bowling** checkpoints;
the phone signs into the same profile and joins the new code. In-flight play
restarts at the last acknowledged stable boundary. Party archive continuation
and Tennis saved-score continuation are not implemented. A saved source allows
only one active continuation. Do not promise that a healthcheck or redeploy
preserves an active match. Guest play remains usable without profile storage;
the app must report failed saves instead of claiming a durable checkpoint.

Volumes exist at runtime, so initialize SQLite at application startup, never
in a build or pre-deploy command. The mounted `/data` directory must belong to
UID/GID **1000:1000**, permit that user to create database/WAL/SHM files, and use
mode `0700` (database `0600`). Verify platform volume provisioning with current
Railway guidance. Build-time ownership of `/app/.wee-data` does not establish
ownership of a mount that replaces it. Do not make the directory world-writable
or run the app as root to conceal a volume permission failure.

Check mount persistence and ownership using the actual runtime UID before
opening account signup to users. A missing database initializes normally in a
writable directory. Unavailable/unwritable storage or an incompatible/damaged
database logs a redacted warning and leaves guest HTTP/realtime play running; profile
requests return 503. `/health` remains 200 for guest service, with
`X-Wee-Profiles: unavailable`. This is a degraded optional feature that needs
operator attention, not evidence that accounts are durable.

The store checks database integrity and schema compatibility before making
changes. It recognizes the existing unversioned schema and schema version 1;
future or incompatible versions are rejected without resetting the database.
Older binaries might not understand future schema changes. Take a tested backup
before upgrades; assess database compatibility separately from image rollback.

## Backup, restore and rollback

Run these only against authorized data as the database-owning runtime user.
Use an access-controlled backup destination and retain copies outside the
service volume. These examples do not create a backup schedule or remote store.

```sh
node server/scripts/profile-db.js backup /data/profiles.sqlite /data/backups/profiles-20261108.sqlite
```

The command uses SQLite's backup API, including committed WAL contents, checks
integrity/schema and refuses to overwrite an existing destination or its
sidecars. Copying only `profiles.sqlite` while WAL is active can lose recent
saves. Do not manually delete a live WAL/SHM file. Treat backups as account data,
including password and session hashes; restrict access and test retention and
restore regularly.

To restore, stop the service, preserve the old database and sidecars, restore to
a **new** filename, then point `WEE_PROFILE_DB` at the restored file and start
one instance:

```sh
node server/scripts/profile-db.js restore /data/backups/profiles-20261108.sqlite /data/profiles-restored.sqlite
```

The restore command cannot itself prove that another process is stopped; this
is an operator precondition. Verify profile login, history and a supported
checkpoint continuation before reopening play. For image rollback, select the
previous reviewed image/revision and restore a compatible backup when required.
Restoring older data intentionally loses changes after that backup and must be
an explicit owner decision. A redeploy always loses existing in-memory rooms.

## Health, shutdown and diagnosis

An incomplete build or invalid public/port configuration fails startup. The
static handler requires all six HTML entries; the build verifier also checks
runtime models, the local controller font. `/health` returns `ok` after
the service can start guest play. Profile availability is a separate header
read probe plus observed failures, not a guarantee that a later disk write will
succeed. Railway's deployment healthcheck is not continuous uptime monitoring.

SIGTERM/SIGINT immediately rejects new work, marks readiness 503, closes
realtime connections, drains HTTP and pending profile work, and closes SQLite.
A ten-second deadline exits with failure if incomplete requests prevent a clean
shutdown. Configure a longer platform termination grace, and do not rely on a
draining interval to save mid-flight games. Take deployments out of play hours.

| Symptom | Checks |
| --- | --- |
| Startup fails / restarting | Node 24; build entries; valid PORT/origin; runtime logs and exit status; volume schema compatibility. |
| Phone cannot join / redirects repeat | `/api/phone-link`, HTTPS origin, public domain, correct room code, request Host/forwarded HTTPS handling, Origin rejection. Never log credentials. |
| Repeated reconnect / expired room | Same service/replica/region, sleep disabled, both transports, recent restart, phone visibility/network change. Expired rooms require a new code. |
| Missing/stale artwork or audio | Asset response status/MIME, build verifier, cache headers; unknown paths must return 404. Content-hashed JS/CSS are immutable; unversioned assets revalidate with ETags. |
| Save failed / profiles unavailable | Profile API status and health header; UID/mount permissions, free disk, DB/WAL errors, backup integrity. Preserve a damaged database for investigation. |
| CPU/RSS/volume growth | Room/socket count during a bounded soak, disconnections after use, game-switch cleanup, restarts and database size/retention. Avoid raw sensor logs. |

Track external availability, reconnect/error rates, save failures, process
restarts, CPU/RSS and volume space. The application does not provision monitoring
or purchase a service. Logs should contain configuration state and fixed error
codes, never passwords, profile tokens, host credentials or sensor dumps.

## Release smoke checklist

For a built local image, the reusable container check exercises all built files,
both Socket.IO transports, profile degradation, persistent-volume restart,
online SQLite backup, offline restore and SIGTERM:

```sh
node scripts/verify-production-container.mjs --image wee-sports-readiness:local --report /tmp/wee-container-new.json
```

It requires an already-present image on the local Docker socket, never pulls or
deploys, binds HTTP only to loopback, and removes its uniquely named disposable
containers/volume. Choose a new report filename. Its synthetic stored matches
do not substitute for gameplay or physical-device verification.

1. Confirm the selected reviewed revision, one replica, no sleep, persistent
   mounted path/ownership, public domain, healthcheck and termination grace.
2. Open `/`, `/home`, `/join`, `/host/ABCD`, `/profile` directly and refresh;
   check all six game/controller HTML entries. Missing assets and unknown routes
   must return 404 with no source-file disclosure.
3. Scan the QR and join manually as a guest. Check invalid/full/expired rooms,
   motion permission denial and touch fallback, phone reconnect and host reload.
4. Play Tennis (one/two players), Bowling (up to eight)
   (one/two); complete results/rematch and same-room sport switching. Golf and
   Pool remain unavailable. Test both realtime transports on HTTPS.
5. With disposable accounts, verify isolation, save acknowledgement, history,
   restart, supported solo continuation, SQLite backup and restore. Confirm
   guest degradation when storage is unavailable.
6. Confirm SIGTERM exits within ten seconds and the platform grants at least
   fifteen. New connections/work must stop during shutdown. Existing room codes
   expire after restart; durable supported checkpoints remain available.
7. Test actual iOS Safari and Android Chrome motion, browser permissions,
   background/reconnect, sensor axes and haptics. Software sensor tests are not
   physical-device evidence. Record staging results before a production release.

Official references for the operator's current-platform check:
[Dockerfiles](https://docs.railway.com/builds/dockerfiles),
[configuration](https://docs.railway.com/config-as-code),
[networking](https://docs.railway.com/networking/public-networking/specs-and-limits),
[volumes](https://docs.railway.com/volumes),
[healthchecks](https://docs.railway.com/deployments/healthchecks),
[teardown](https://docs.railway.com/deployments/deployment-teardown),
[runtime variables](https://docs.railway.com/variables/reference).
