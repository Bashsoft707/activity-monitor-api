import { EventType, NotificationChannel } from '../../src/generated/prisma/enums.js'
import type { EventDTO } from '../../src/lib/serialize.js'

/**
 * A wire-format event. Overrides let a test name only the field it cares about,
 * so the assertion reads as the thing under test rather than as setup.
 */
export const buildEventDTO = (overrides: Partial<EventDTO> = {}): EventDTO => ({
  id: '019fb4ba-4051-7408-8a0e-809375239c1e',
  type: EventType.USER_SIGNUP,
  label: 'New signup: ada@example.com',
  channel: NotificationChannel.IN_APP,
  metadata: { recipient: 'ada@example.com' },
  createdAt: '2026-07-30T20:32:12.881Z',
  ...overrides,
})
