# Activity Monitor API

Backend for a real-time activity monitor: an append-only event log in PostgreSQL,
pushed to connected clients over WebSockets as it is written, with a notification
dispatch module that routes each event to a delivery channel.

- **Live API:** _(Railway URL — pending deploy)_
- **Live frontend:** _(Vercel URL — pending deploy)_
- **Repository:** https://github.com/Bashsoft707/activity-monitor-api

## Architecture

```
Next.js on Vercel  ──REST──▶  Express on Railway  ──▶  PostgreSQL
   (socket CLIENT)  ◀─WS───    (socket SERVER)
```

The Socket.io **server** lives only inside the Express process on Railway. The
Next.js app is a Socket.io **client** and nothing more.

This is deliberate. Vercel runs Next.js route handlers as serverless functions,
which are spun up per request and torn down afterwards — they cannot hold the
long-lived TCP connection a WebSocket requires. Putting the socket server in a
Next.js API route would appear to work locally, where `next dev` is one
long-running process, and then fail in production once each request landed on a
different short-lived function instance. Railway runs a persistent container, so
that is where the server belongs.

The frontend loads the initial feed over REST (`GET /events`) and receives every
subsequent event over the socket. Both paths emit the identical `EventDTO` shape,
so the client appends pushed events straight onto the list it fetched.

## Tech stack

| Layer | Choice |
|---|---|
| Runtime | Node.js ≥ 20.19, ESM, TypeScript |
| HTTP | Express 5 |
| Realtime | Socket.io 4 |
| Database | PostgreSQL |
| ORM | Prisma 7 with the `@prisma/adapter-pg` driver adapter |
| Hosting | Railway (API + Postgres) |

Prisma 7 no longer ships a query engine inside the client, so a driver adapter is
required rather than optional — hence `@prisma/adapter-pg` and `pg`.

## Setup

**Prerequisites:** Node.js ≥ 20.19 and a PostgreSQL database.

```bash
git clone https://github.com/Bashsoft707/activity-monitor-api.git
cd activity-monitor-api
npm install

cp .env.example .env      # then fill in DATABASE_URL
npx prisma migrate deploy # applies the committed migration
npm run dev               # http://localhost:4000
```

`npm run dev` uses `tsx watch`. For a production-shaped run, `npm run build`
followed by `npm start`.

### Environment variables

| Variable | Required | Default | Notes |
|---|---|---|---|
| `DATABASE_URL` | yes | — | PostgreSQL connection string. On Railway, reference the Postgres service as `${{Postgres.DATABASE_URL}}`; from a laptop you must use the **public** proxy URL, since `*.railway.internal` only resolves inside Railway. |
| `PORT` | no | `4000` | Railway injects this. Do not set it manually there. |
| `CORS_ORIGIN` | no | `http://localhost:3000` | Comma-separated allowlist of browser origins. Applied to both the REST layer and the Socket.io handshake. |

The server fails fast on startup if `DATABASE_URL` is missing, rather than
surfacing it later as a confusing query error.

### npm scripts

| Script | Does |
|---|---|
| `dev` | `tsx watch src/index.ts` |
| `build` | `prisma generate && tsc` |
| `start` | `node dist/index.js` |
| `migrate:dev` | Create and apply a new migration (development) |
| `migrate:deploy` | Apply existing migrations (production) |
| `migrate:test` | Apply migrations to the test database |
| `test` | Run every suite once |
| `test:watch` | Re-run affected suites on change |
| `typecheck` | Type-check `src` and `tests` without emitting |
| `studio` | Open Prisma Studio |

`build` runs `prisma generate` because the generated client is gitignored — a
deploy that only ran `tsc` would fail on an unresolvable import.

## API

Base URL is the Railway domain in production, `http://localhost:4000` locally.

### `GET /health`

Liveness probe. Touches no database.

```json
{ "status": "ok", "uptime": 12.4 }
```

### `GET /events`

The 50 most recent events, newest first.

```json
{
  "data": [
    {
      "id": "019fadc8-6b2d-776f-8498-af298ef76325",
      "type": "PAYMENT_FAILED",
      "label": "Card declined for invoice #1042",
      "channel": "SMS",
      "metadata": { "recipient": "+2348000000000" },
      "createdAt": "2026-07-29T12:10:20.845Z"
    }
  ]
}
```

Ordered by `created_at` **and** `id`. Several events can be written within the
same millisecond, and ordering on the timestamp alone would let them swap
positions between requests; `id` is a UUIDv7, so it sorts in the same direction as
the timestamp and settles ties deterministically.

### `POST /events`

Records an event, broadcasts it, and applies the notification policy.

**Request**

```json
{
  "type": "PAYMENT_FAILED",
  "label": "Card declined for invoice #1042",
  "metadata": { "recipient": "+2348000000000" }
}
```

| Field | Required | Rules |
|---|---|---|
| `type` | yes | One of the `EventType` values below |
| `label` | yes | Non-empty, ≤ 200 characters |
| `metadata` | no | A JSON object; arrays and primitives are rejected |

**`channel` is not accepted from the client.** The server derives it from `type`
and stores what it decided, so a caller cannot downgrade a fraud alert onto a free
channel.

**Response — `201`**

```json
{
  "data": { "...": "the created event, same shape as GET /events" },
  "notification": {
    "channel": "SMS",
    "delivered": false,
    "detail": "stub: would send SMS to +2348000000000"
  }
}
```

`delivered` distinguishes a channel that really ran from one that is stubbed.

**Response — `400`**

```json
{ "error": "label must be a non-empty string" }
```

### Errors

| Status | Body |
|---|---|
| `400` | `{ "error": "<what was wrong>" }` |
| `404` | `{ "error": "Not found" }` |
| `500` | `{ "error": "Internal server error" }` |

## WebSocket events

Connect a Socket.io client to the API's base URL. The server emits two distinct
messages, and the difference matters:

| Event | Carries | Why |
|---|---|---|
| `event:created` | **Every** logged event | This is the activity feed. Gating it on channel would hide events routed to SMS or WhatsApp from the monitor entirely. |
| `notification:push` | Only `IN_APP` events | This is an actual notification — the one channel that is really delivered. |

Both payloads are the same `EventDTO` as the REST responses.

```js
import { io } from 'socket.io-client'

const socket = io(process.env.NEXT_PUBLIC_API_URL)
socket.on('event:created', (event) => appendToFeed(event))
socket.on('notification:push', (event) => showToast(event))
```

## Data model

A single `events` table acts as the audit log.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | UUIDv7, generated by Prisma. Time-ordered, so it doubles as a stable sort key. |
| `type` | `EventType` | Postgres enum |
| `label` | `text` | Human-readable feed line |
| `channel` | `NotificationChannel` | Postgres enum; written by the router, never by the client |
| `metadata` | `jsonb` | Nullable, free-form per-event context |
| `created_at` | `timestamptz(3)` | Defaults to `now()`, indexed |

`EventType`: `USER_SIGNUP`, `PAYMENT_RECEIVED`, `PAYMENT_FAILED`, `LOGIN_FAILED`,
`ORDER_SHIPPED`, `SUBSCRIPTION_EXPIRING`

`NotificationChannel`: `IN_APP`, `SMS`, `WHATSAPP`

### Two deliberate additions to the brief

The brief specified `id`, `label`, `channel` and `created_at`. Two extra columns
were added on purpose:

- **`type`** — the dispatch module has to decide a channel per event. With only a
  free-text `label` to work from, that decision becomes string-matching on display
  copy. A typed enum gives the router something structured to switch on, and
  because both switches end in a `never`-typed default, adding an `EventType`
  without routing it is a **compile error** rather than a silent runtime fallthrough.
- **`metadata`** — gives the audit log somewhere to record per-event context, and
  gives the stubbed SMS and WhatsApp dispatchers a recipient to log without
  requiring a `User` table that is out of scope here.

## Notification dispatch

`src/notifications/` is deliberately two pieces:

- **`channel-router.ts`** — a pure function from `EventType` to
  `NotificationChannel`. It runs *before* the insert so the resolved channel can be
  persisted with the row.
- **`dispatch.ts`** — the side-effecting part. `IN_APP` is really delivered; `SMS`
  and `WHATSAPP` log the message they would have sent and report
  `delivered: false`.

The dispatcher receives a `RealtimePublisher` function rather than importing
Socket.io. Nothing in the notification layer knows which transport is attached,
which is what makes the mobile story below straightforward.

Every dispatch writes one line:

```
[notify] event=019fadc8… type=PAYMENT_FAILED channel=SMS delivered=false :: stub: would send SMS to +2348000000000
```

## Tests

```bash
npm test          # 66 tests
npm run test:watch
```

Vitest, split into suites that need a database and suites that do not.

| Suite | Kind | Covers |
|---|---|---|
| `tests/unit/channel-router.test.ts` | unit | Every event type routes to the expected channel, exhaustively |
| `tests/unit/dispatch.test.ts` | unit | In-app publishes and reports delivery; SMS and WhatsApp log their intent and never touch the socket; recipient extraction from arbitrary metadata |
| `tests/unit/serialize.test.ts` | unit | Wire shape, ISO timestamps, JSON round-trip fidelity |
| `tests/integration/events.routes.test.ts` | integration | HTTP against a real database: persistence, server-side channel assignment, 13 validation rejections, feed ordering and the 50-row cap |
| `tests/integration/realtime.test.ts` | integration | Real Socket.io server and real clients over a websocket |

The realtime suite is the one worth reading. It assembles the production stack —
`createRealtime()`, the dispatcher wired to it, the Express app, Socket.io
attached in the same order as `index.ts` — binds it to an ephemeral port, and
connects actual socket clients. Nothing is mocked, because the behaviour under
test is the interaction: that a created event reaches the feed, that only an
in-app event *also* reaches the push channel, that a broadcast reaches every
connected client, and that the reported recipient count is real.

Proving an event does **not** arrive needs a wait rather than an assertion, so
`expectSilence` listens for a fixed window and fails if the event shows up. That
is how the SMS and WhatsApp cases confirm they stay off `notification:push`.

Two tests exist purely as regression guards for hazards documented in the source:
that REST still works while a socket is attached (the engine.io attach-ordering
trap in `realtime/socket.ts`), and that closing the realtime layer releases the
port rather than leaking a listener.

### Test database

Integration tests truncate the events table between tests, so they need their own
database — never the one holding data you care about.

```bash
cp .env.test.example .env.test   # then set DATABASE_URL
npm run migrate:test             # apply the schema to it
```

Any PostgreSQL works: a local instance, a Docker container, or a second database
on the same hosted provider. `tests/setup/test-env.ts` loads `.env.test` before
any application module reads `DATABASE_URL`, which works because Vitest runs
`setupFiles` first and `dotenv` does not overwrite variables that are already set.

Without `.env.test` the unit suites still run and the integration suites skip with
a message, so `npm test` is never blocked on having a database to hand.

Tests live outside `src/`, so `tsc` never emits them into `dist`. `npm run
typecheck` covers both using `tsconfig.test.json`.

## Project structure

```
src/
  index.ts                     server assembly, listen, graceful shutdown
  app.ts                       Express app factory
  env.ts                       env loading and validation
  lib/
    prisma.ts                  Prisma client + pg driver adapter
    serialize.ts               EventDTO — the single wire format
  routes/
    events.ts                  GET /events, POST /events, request validation
  notifications/
    channel-router.ts          EventType -> NotificationChannel (pure)
    dispatch.ts                channel dispatchers, in-app real / SMS + WhatsApp stubbed
  realtime/
    socket.ts                  Socket.io server, broadcast + push
tests/
  setup/test-env.ts            points the process at the test database
  helpers/                     socket client helpers, DTO factory
  unit/                        router, dispatcher, serializer
  integration/                 HTTP against a real DB, real socket clients
prisma/
  schema.prisma
  migrations/
```

`index.ts` assembles in a specific order, and it is load-bearing: the realtime
layer hands out `broadcast`/`publish` first, the dispatcher and app are built from
them, and Socket.io attaches **last**. `engine.io`'s `attach()` snapshots the HTTP
server's existing `'request'` listeners and forwards non-socket traffic to them, so
attaching before Express is registered leaves both answering handshakes and the
process dies with `ERR_HTTP_HEADERS_SENT`.

## Architecture notes

### Shipping the same backend to React Native / Expo

Very little would change server-side, because the transport boundary is already
drawn in the right place. A React Native client would use the same REST call for
the initial feed and the same `socket.io-client` — which ships a React Native
build — for `event:created`, so the contract is untouched. The main structural
move is extracting `EventDTO` and the two enums out of the API into a shared
workspace package so web, mobile and server compile against one definition rather
than three hand-copied ones. Auth is the real gap: there is none today, and adding
it means a token on the REST calls plus the same token on the socket handshake via
`io(url, { auth: { token } })`, validated in a Socket.io middleware so an
unauthenticated socket never joins. Beyond that, mobile needs a `Device` table
mapping a user to their Expo push tokens and platform, since a phone is the one
client whose address you must store to reach it.

The interesting part is that `IN_APP` stops meaning one thing. A web tab is either
open with a live socket or gone; a mobile app is also *backgrounded*, where the
socket is dead but the OS will still surface a notification. So the in-app channel
becomes "socket if the device is connected, Expo Push (APNs/FCM) if not" — and
that is a second implementation of the existing `RealtimePublisher` port, not a
change to the routing policy. `channel-router.ts` never learns that mobile exists.
That seam is the reason the dispatcher takes an injected publisher instead of
importing Socket.io directly, and it is what keeps a multi-client rollout from
turning into a rewrite of the notification logic.

### Choosing between push, SMS and WhatsApp in a cost-conscious product

The channels differ by roughly an order of magnitude in cost and in the delivery
guarantee they buy. In-app and mobile push are effectively free and infinitely
retryable, but they only reach someone who installed the app and will open it.
WhatsApp costs cents per conversation, supports rich content and links, and is
markedly cheaper than SMS at volume in the markets where it dominates — but it
requires pre-approved templates and a session window, so it is not a channel you
can improvise on. SMS is the most expensive and the price swings by more than 10×
between countries, yet it has the highest deliverability floor of the three: it
needs no app, no data connection and no account. So the operating rule is to send
on the cheapest channel that still meets the delivery guarantee the event actually
requires, rather than the one that feels most urgent. Anything a user can catch up
on next time they open the app — signups, successful payments, most activity —
belongs on push, which is why they route to `IN_APP` here. Reserve SMS for events
where non-delivery costs money or compromises security: a failed payment that will
dunning-cancel a subscription, a suspicious login, an OTP. WhatsApp takes the
middle band, where the message benefits from rich formatting and should arrive
today but does not justify SMS rates — shipping updates, expiring subscriptions.

Treating that as a fixed table is the naive version, though, and I would not stop
there. The stronger model is escalation rather than selection: send push first,
and only if it goes unread past a threshold escalate to WhatsApp and then SMS, so
the expensive channel is paid for only when the cheap one has demonstrably failed.
Several refinements follow from taking cost seriously — per-country routing
tables, because SMS economics in Nigeria and the US are not comparable; digesting
high-frequency low-value events into one message instead of ten; suppressing
duplicates and honouring quiet hours so spend is not wasted on notifications that
annoy. The decision should ultimately be measured, not asserted: track cost per
channel per event type against the action rate each one drives, and demote any
event type whose SMS spend fails to beat push on outcome. That turns the routing
table from a set of assumptions into something the data can correct — and it is
why `channel` is stored on every row rather than recomputed, since you cannot
audit a policy you did not record.

## Postman

`postman/activity-monitor-api.postman_collection.json` covers every endpoint,
including the validation failures. Import it and set the `baseUrl` collection
variable — it defaults to `http://localhost:4000`; point it at the Railway domain
to exercise the deployed API.
