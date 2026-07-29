import type { Prisma } from '../generated/prisma/client.js'
import { NotificationChannel } from '../generated/prisma/enums.js'
import type { EventDTO } from '../lib/serialize.js'

/**
 * Port for reaching clients currently attached to the realtime transport,
 * returning how many received the event.
 *
 * Socket.io implements this in `index.ts`. This module deliberately knows nothing
 * about Socket.io, which is what lets a different client — React Native over the
 * same server, say — reuse the dispatcher unchanged.
 */
export type RealtimePublisher = (event: EventDTO) => number

export type DispatchOutcome = {
  channel: NotificationChannel
  /** false for the stubbed providers: nothing actually left the process. */
  delivered: boolean
  detail: string
}

export type Dispatcher = (event: EventDTO) => DispatchOutcome

/**
 * Pulls a recipient out of the event's free-form metadata. `metadata` is
 * arbitrary JSON, so nothing about its shape can be assumed.
 */
const readRecipient = (metadata: Prisma.JsonValue | null): string => {
  if (metadata !== null && typeof metadata === 'object' && !Array.isArray(metadata)) {
    const recipient = (metadata as Record<string, unknown>)['recipient']
    if (typeof recipient === 'string' && recipient.trim().length > 0) {
      return recipient
    }
  }
  return 'no recipient in metadata'
}

/**
 * Builds the dispatcher. Only IN_APP is really delivered; SMS and WHATSAPP log
 * the message they would have sent and report `delivered: false`, so the
 * difference between a wired and a stubbed channel is visible rather than implied.
 */
export const createDispatcher = (publish: RealtimePublisher): Dispatcher => {
  return (event) => {
    const outcome = ((): DispatchOutcome => {
      switch (event.channel) {
        case NotificationChannel.IN_APP: {
          const recipients = publish(event)
          return {
            channel: event.channel,
            delivered: true,
            detail: `pushed to ${recipients} connected client(s)`,
          }
        }

        case NotificationChannel.SMS:
          return {
            channel: event.channel,
            delivered: false,
            detail: `stub: would send SMS to ${readRecipient(event.metadata)}`,
          }

        case NotificationChannel.WHATSAPP:
          return {
            channel: event.channel,
            delivered: false,
            detail: `stub: would send WhatsApp message to ${readRecipient(event.metadata)}`,
          }

        default: {
          // Same guard as the router: a new channel cannot ship undispatched.
          const unhandled: never = event.channel
          throw new Error(`No dispatcher for channel: ${String(unhandled)}`)
        }
      }
    })()

    console.log(
      `[notify] event=${event.id} type=${event.type} channel=${outcome.channel} ` +
        `delivered=${outcome.delivered} :: ${outcome.detail}`,
    )

    return outcome
  }
}
