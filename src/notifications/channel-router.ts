import { EventType, NotificationChannel } from '../generated/prisma/enums.js'

/**
 * Decides which channel an event should be delivered on.
 *
 * Pure and synchronous: it runs before the row is written so the resolved channel
 * can be persisted alongside the event. The policy is cost-shaped — in-app push
 * is free, so anything the user can catch up on next time they open the app goes
 * there. SMS costs per message but reaches a handset with no app installed, so it
 * is reserved for events that lose value if they are missed. WhatsApp sits in
 * between: cheaper than SMS at volume and supports richer content, so it carries
 * updates worth reading but not worth paying SMS rates for.
 */
export const resolveChannel = (type: EventType): NotificationChannel => {
  switch (type) {
    // Informational — no harm if it waits for the next session.
    case EventType.USER_SIGNUP:
    case EventType.PAYMENT_RECEIVED:
      return NotificationChannel.IN_APP

    // Revenue- or security-critical — must land without depending on the app.
    case EventType.PAYMENT_FAILED:
    case EventType.LOGIN_FAILED:
      return NotificationChannel.SMS

    // Worth reading and benefits from rich content, but not urgent enough for SMS.
    case EventType.ORDER_SHIPPED:
    case EventType.SUBSCRIPTION_EXPIRING:
      return NotificationChannel.WHATSAPP

    default: {
      // Adding a value to EventType without routing it fails to compile here,
      // rather than silently falling through to a default channel at runtime.
      const unrouted: never = type
      throw new Error(`Unrouted event type: ${String(unrouted)}`)
    }
  }
}
