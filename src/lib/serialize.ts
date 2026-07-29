import type { Event, Prisma } from '../generated/prisma/client.js'
import type { EventType, NotificationChannel } from '../generated/prisma/enums.js'

/**
 * Wire format for an event.
 *
 * REST responses and Socket.io broadcasts both go through this, so a client can
 * append a pushed event straight onto the list it fetched without special-casing
 * either source. `createdAt` is an ISO string because `res.json()` and Socket.io
 * serialise a `Date` differently.
 */
export type EventDTO = {
  id: string
  type: EventType
  label: string
  channel: NotificationChannel
  metadata: Prisma.JsonValue | null
  createdAt: string
}

export const serializeEvent = (event: Event): EventDTO => ({
  id: event.id,
  type: event.type,
  label: event.label,
  channel: event.channel,
  metadata: event.metadata,
  createdAt: event.createdAt.toISOString(),
})
