import { describe, expect, it } from 'vitest'
import { EventType, NotificationChannel } from '../../src/generated/prisma/enums.js'
import { resolveChannel } from '../../src/notifications/channel-router.js'

/**
 * The routing policy stated as data. Typing it as a total Record over EventType
 * means adding a type to the schema without deciding its channel fails to
 * compile here, alongside the `never` guard in the router itself.
 */
const EXPECTED_CHANNEL: Record<EventType, NotificationChannel> = {
  [EventType.USER_SIGNUP]: NotificationChannel.IN_APP,
  [EventType.PAYMENT_RECEIVED]: NotificationChannel.IN_APP,
  [EventType.PAYMENT_FAILED]: NotificationChannel.SMS,
  [EventType.LOGIN_FAILED]: NotificationChannel.SMS,
  [EventType.ORDER_SHIPPED]: NotificationChannel.WHATSAPP,
  [EventType.SUBSCRIPTION_EXPIRING]: NotificationChannel.WHATSAPP,
}

describe('resolveChannel', () => {
  it.each(Object.entries(EXPECTED_CHANNEL))('routes %s to %s', (type, channel) => {
    expect(resolveChannel(type as EventType)).toBe(channel)
  })

  it('routes every event type the schema defines', () => {
    // A compile-time Record cannot catch a type added to the enum at runtime by a
    // regenerated client, so the count is checked too. If this fails, an event
    // type exists that no one has assigned a delivery channel.
    expect(Object.keys(EXPECTED_CHANNEL).sort()).toEqual(Object.values(EventType).sort())
  })

  it('never returns a channel outside the enum', () => {
    const channels = Object.values(NotificationChannel)
    for (const type of Object.values(EventType)) {
      expect(channels).toContain(resolveChannel(type))
    }
  })

  it('is pure — the same type always resolves the same way', () => {
    // The route is persisted on the row, so a non-deterministic decision would
    // make the stored channel disagree with the policy on a later read.
    expect(resolveChannel(EventType.PAYMENT_FAILED)).toBe(
      resolveChannel(EventType.PAYMENT_FAILED),
    )
  })

  it('reserves SMS for the events that lose value if missed', () => {
    // Guards the cost policy described in the written note: SMS costs per message,
    // so only revenue- and security-critical events may use it.
    const smsTypes = Object.values(EventType).filter(
      (type) => resolveChannel(type) === NotificationChannel.SMS,
    )
    expect(smsTypes).toEqual([EventType.PAYMENT_FAILED, EventType.LOGIN_FAILED])
  })
})
