import { Router } from 'express'
import { prisma } from '../lib/prisma.js'
import { serializeEvent } from '../lib/serialize.js'

/**
 * How many events the feed loads up front. The socket stream carries everything
 * after that, so this only needs to fill the initial view.
 */
const FEED_LIMIT = 50

export const eventsRouter = Router()

eventsRouter.get('/', async (_req, res) => {
  const events = await prisma.event.findMany({
    // `id` breaks ties: two events can share a millisecond, and ordering by
    // created_at alone would let them swap places between requests. UUIDv7 is
    // time-ordered, so it sorts the same way created_at does.
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: FEED_LIMIT,
  })

  res.json({ data: events.map(serializeEvent) })
})
