import { describe, expect, it } from 'vitest'
import type { Event } from '../../src/generated/prisma/client.js'
import { EventType, NotificationChannel } from '../../src/generated/prisma/enums.js'
import { serializeEvent } from '../../src/lib/serialize.js'

const buildRow = (overrides: Partial<Event> = {}): Event => ({
  id: '019fb4ba-4051-7408-8a0e-809375239c1e',
  type: EventType.USER_SIGNUP,
  label: 'New signup: ada@example.com',
  channel: NotificationChannel.IN_APP,
  metadata: { recipient: 'ada@example.com' },
  createdAt: new Date('2026-07-30T20:32:12.881Z'),
  ...overrides,
})

describe('serializeEvent', () => {
  it('renders createdAt as an ISO string', () => {
    // res.json() and Socket.io serialise a Date differently, so the conversion
    // happens here — otherwise the same event reaches the client in two shapes
    // depending on whether it arrived over REST or the socket.
    expect(serializeEvent(buildRow()).createdAt).toBe('2026-07-30T20:32:12.881Z')
    expect(typeof serializeEvent(buildRow()).createdAt).toBe('string')
  })

  it('exposes exactly the wire fields', () => {
    expect(Object.keys(serializeEvent(buildRow())).sort()).toEqual([
      'channel',
      'createdAt',
      'id',
      'label',
      'metadata',
      'type',
    ])
  })

  it('passes metadata through untouched, including null', () => {
    const metadata = { recipient: '+2348012345678', trackingId: 'GIG-8821', nested: { a: 1 } }
    expect(serializeEvent(buildRow({ metadata })).metadata).toEqual(metadata)
    expect(serializeEvent(buildRow({ metadata: null })).metadata).toBeNull()
  })

  it('survives a JSON round trip unchanged', () => {
    // What the socket does to the payload. If this were lossy, a pushed event and
    // a fetched event would not be interchangeable on the client.
    const dto = serializeEvent(buildRow())
    expect(JSON.parse(JSON.stringify(dto))).toEqual(dto)
  })
})
