import { Router } from 'express'
import type { Prisma } from '../generated/prisma/client.js'
import { EventType } from '../generated/prisma/enums.js'
import { prisma } from '../lib/prisma.js'
import { serializeEvent, type EventDTO } from '../lib/serialize.js'
import { resolveChannel } from '../notifications/channel-router.js'
import type { Dispatcher } from '../notifications/dispatch.js'

type EventsRouterDeps = {
  broadcast: (event: EventDTO) => void
  dispatch: Dispatcher
}

/**
 * How many events the feed loads up front. The socket stream carries everything
 * after that, so this only needs to fill the initial view.
 */
const FEED_LIMIT = 50

const LABEL_MAX_LENGTH = 200

const EVENT_TYPES = Object.values(EventType)

type CreateEventInput = {
  type: EventType
  label: string
  metadata?: Prisma.InputJsonObject
}

type ParseResult = { ok: true; value: CreateEventInput } | { ok: false; error: string }

/**
 * Validates the request body by hand rather than pulling in a schema library —
 * three fields does not justify the dependency. Note that `channel` is not
 * accepted: the server decides it, so a client cannot pick its own delivery route.
 */
const parseCreateEvent = (body: unknown): ParseResult => {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'Request body must be a JSON object' }
  }

  const { type, label, metadata } = body as Record<string, unknown>

  if (typeof type !== 'string' || !EVENT_TYPES.includes(type as EventType)) {
    return { ok: false, error: `type must be one of: ${EVENT_TYPES.join(', ')}` }
  }

  if (typeof label !== 'string' || label.trim().length === 0) {
    return { ok: false, error: 'label must be a non-empty string' }
  }

  if (label.trim().length > LABEL_MAX_LENGTH) {
    return { ok: false, error: `label must be at most ${LABEL_MAX_LENGTH} characters` }
  }

  if (
    metadata !== undefined &&
    (metadata === null || typeof metadata !== 'object' || Array.isArray(metadata))
  ) {
    return { ok: false, error: 'metadata must be a JSON object when provided' }
  }

  return {
    ok: true,
    value: {
      type: type as EventType,
      label: label.trim(),
      // Safe narrowing: the body came from express.json(), so every value in it
      // is already a parsed JSON value.
      ...(metadata === undefined ? {} : { metadata: metadata as Prisma.InputJsonObject }),
    },
  }
}

export const createEventsRouter = ({ broadcast, dispatch }: EventsRouterDeps): Router => {
  const router = Router()

  router.get('/', async (_req, res) => {
    const events = await prisma.event.findMany({
      // `id` breaks ties: two events can share a millisecond, and ordering by
      // created_at alone would let them swap places between requests. UUIDv7 is
      // time-ordered, so it sorts the same way created_at does.
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: FEED_LIMIT,
    })

    res.json({ data: events.map(serializeEvent) })
  })

  router.post('/', async (req, res) => {
    const parsed = parseCreateEvent(req.body)

    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error })
      return
    }

    const { type, label, metadata } = parsed.value

    const created = await prisma.event.create({
      data: {
        type,
        label,
        // Derived server-side, then stored, so the row records what the routing
        // policy actually decided.
        channel: resolveChannel(type),
        ...(metadata === undefined ? {} : { metadata }),
      },
    })

    const event = serializeEvent(created)

    // Write first, then push: a failed insert must never produce a notification
    // for an event that does not exist.
    //
    // The feed gets every event; the notification only fires on whichever channel
    // the router picked. Broadcasting first means the monitor stays current even
    // if a notification provider later fails.
    broadcast(event)
    const notification = dispatch(event)

    res.status(201).json({ data: event, notification })
  })

  return router
}
