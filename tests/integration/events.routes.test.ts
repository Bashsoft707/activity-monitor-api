import request from 'supertest'
import { afterAll, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { createApp } from '../../src/app.js'
import { EventType, NotificationChannel } from '../../src/generated/prisma/enums.js'
import { prisma } from '../../src/lib/prisma.js'
import type { EventDTO } from '../../src/lib/serialize.js'
import type { DispatchOutcome } from '../../src/notifications/dispatch.js'
import { hasTestDatabase } from '../setup/test-env.js'

/**
 * Exercises the HTTP layer against a real database. The realtime layer is faked
 * here so these tests can assert *that* an event was broadcast and dispatched,
 * and in what order, without a socket in the way — the real socket path has its
 * own suite in realtime.test.ts.
 */
describe.skipIf(!hasTestDatabase)('events routes', () => {
  // Records the order of side effects: the route must write, then broadcast, then
  // dispatch. A notification for an event that failed to insert would be a lie.
  let calls: string[]
  let broadcast: Mock<(event: EventDTO) => void>
  let dispatch: Mock<(event: EventDTO) => DispatchOutcome>

  const buildApp = () => {
    calls = []
    broadcast = vi.fn((_event: EventDTO) => {
      calls.push('broadcast')
    })
    dispatch = vi.fn((event: EventDTO): DispatchOutcome => {
      calls.push('dispatch')
      return { channel: event.channel, delivered: true, detail: 'faked' }
    })
    return createApp({ broadcast, dispatch })
  }

  let app: ReturnType<typeof createApp>

  beforeEach(async () => {
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "events"')
    app = buildApp()
  })

  afterAll(async () => {
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "events"')
    await prisma.$disconnect()
  })

  describe('GET /health', () => {
    it('reports ok with an uptime', async () => {
      const response = await request(app).get('/health').expect(200)

      expect(response.body.status).toBe('ok')
      expect(typeof response.body.uptime).toBe('number')
    })
  })

  describe('POST /events', () => {
    it('creates an event and returns it with its notification outcome', async () => {
      const response = await request(app)
        .post('/events')
        .send({ type: EventType.USER_SIGNUP, label: 'New signup: ada@example.com' })
        .expect(201)

      expect(response.body.data).toMatchObject({
        type: EventType.USER_SIGNUP,
        label: 'New signup: ada@example.com',
        channel: NotificationChannel.IN_APP,
      })
      expect(response.body.data.id).toMatch(/^[0-9a-f-]{36}$/)
      expect(response.body.notification).toEqual({
        channel: NotificationChannel.IN_APP,
        delivered: true,
        detail: 'faked',
      })
    })

    it('persists the row', async () => {
      const response = await request(app)
        .post('/events')
        .send({ type: EventType.ORDER_SHIPPED, label: 'Order #8821 shipped' })
        .expect(201)

      const stored = await prisma.event.findUniqueOrThrow({
        where: { id: response.body.data.id },
      })

      expect(stored.label).toBe('Order #8821 shipped')
      expect(stored.channel).toBe(NotificationChannel.WHATSAPP)
      expect(stored.createdAt).toBeInstanceOf(Date)
    })

    it('derives the channel server-side and ignores a client-supplied one', async () => {
      // Otherwise a caller could route its own events to SMS and spend real money.
      const response = await request(app)
        .post('/events')
        .send({
          type: EventType.PAYMENT_FAILED,
          label: 'Card declined',
          channel: NotificationChannel.IN_APP,
        })
        .expect(201)

      expect(response.body.data.channel).toBe(NotificationChannel.SMS)

      const stored = await prisma.event.findUniqueOrThrow({
        where: { id: response.body.data.id },
      })
      expect(stored.channel).toBe(NotificationChannel.SMS)
    })

    it('broadcasts before dispatching, and exactly once each', async () => {
      await request(app)
        .post('/events')
        .send({ type: EventType.USER_SIGNUP, label: 'ordering check' })
        .expect(201)

      expect(calls).toEqual(['broadcast', 'dispatch'])
      expect(broadcast).toHaveBeenCalledTimes(1)
      expect(dispatch).toHaveBeenCalledTimes(1)
    })

    it('broadcasts the identical payload it returns', async () => {
      // The client appends a pushed event straight onto the list it fetched, so
      // the two representations have to be the same object shape.
      const response = await request(app)
        .post('/events')
        .send({ type: EventType.USER_SIGNUP, label: 'payload parity' })
        .expect(201)

      expect(broadcast.mock.calls[0]?.[0]).toEqual(response.body.data)
    })

    it('stores metadata when given and defaults it to null when not', async () => {
      const withMetadata = await request(app)
        .post('/events')
        .send({
          type: EventType.LOGIN_FAILED,
          label: 'Failed login',
          metadata: { recipient: '+2348012345678', ip: '102.89.44.17' },
        })
        .expect(201)

      expect(withMetadata.body.data.metadata).toEqual({
        recipient: '+2348012345678',
        ip: '102.89.44.17',
      })

      const without = await request(app)
        .post('/events')
        .send({ type: EventType.USER_SIGNUP, label: 'no metadata' })
        .expect(201)

      expect(without.body.data.metadata).toBeNull()
    })

    it('trims the label', async () => {
      const response = await request(app)
        .post('/events')
        .send({ type: EventType.USER_SIGNUP, label: '   padded label   ' })
        .expect(201)

      expect(response.body.data.label).toBe('padded label')
    })

    it('accepts a label at exactly the length limit', async () => {
      await request(app)
        .post('/events')
        .send({ type: EventType.USER_SIGNUP, label: 'a'.repeat(200) })
        .expect(201)
    })
  })

  describe('POST /events validation', () => {
    it.each([
      ['a missing type', { label: 'no type' }],
      ['an unknown type', { type: 'NOT_A_TYPE', label: 'bad type' }],
      ['a non-string type', { type: 7, label: 'numeric type' }],
      ['a missing label', { type: EventType.USER_SIGNUP }],
      ['an empty label', { type: EventType.USER_SIGNUP, label: '' }],
      ['a whitespace-only label', { type: EventType.USER_SIGNUP, label: '    ' }],
      ['a non-string label', { type: EventType.USER_SIGNUP, label: 12 }],
      ['an over-long label', { type: EventType.USER_SIGNUP, label: 'a'.repeat(201) }],
      ['array metadata', { type: EventType.USER_SIGNUP, label: 'x', metadata: [1, 2] }],
      ['null metadata', { type: EventType.USER_SIGNUP, label: 'x', metadata: null }],
      ['scalar metadata', { type: EventType.USER_SIGNUP, label: 'x', metadata: 'nope' }],
      ['an array body', [{ type: EventType.USER_SIGNUP, label: 'x' }]],
      ['an empty body', {}],
    ])('rejects %s with 400 and an error message', async (_case, body) => {
      const response = await request(app).post('/events').send(body).expect(400)

      expect(typeof response.body.error).toBe('string')
      expect(response.body.error.length).toBeGreaterThan(0)
    })

    it('writes nothing and notifies nobody when validation fails', async () => {
      await request(app).post('/events').send({ label: 'no type' }).expect(400)

      expect(await prisma.event.count()).toBe(0)
      expect(broadcast).not.toHaveBeenCalled()
      expect(dispatch).not.toHaveBeenCalled()
    })

    it('names the valid types in the error, so the caller can fix the request', async () => {
      const response = await request(app)
        .post('/events')
        .send({ type: 'NOT_A_TYPE', label: 'bad type' })
        .expect(400)

      for (const type of Object.values(EventType)) {
        expect(response.body.error).toContain(type)
      }
    })
  })

  describe('GET /events', () => {
    it('returns an empty array when there are no events', async () => {
      await request(app).get('/events').expect(200).expect({ data: [] })
    })

    it('returns newest first', async () => {
      for (const label of ['first', 'second', 'third']) {
        await request(app)
          .post('/events')
          .send({ type: EventType.USER_SIGNUP, label })
          .expect(201)
      }

      const response = await request(app).get('/events').expect(200)

      expect(response.body.data.map((event: EventDTO) => event.label)).toEqual([
        'third',
        'second',
        'first',
      ])
    })

    it('caps the feed at 50 and returns the newest page', async () => {
      // The socket carries everything after the initial load, so this only has to
      // fill the first view.
      const base = new Date('2026-07-01T00:00:00.000Z').getTime()
      await prisma.event.createMany({
        data: Array.from({ length: 55 }, (_unused, index) => ({
          type: EventType.USER_SIGNUP,
          label: `event ${index}`,
          channel: NotificationChannel.IN_APP,
          createdAt: new Date(base + index * 1_000),
        })),
      })

      const response = await request(app).get('/events').expect(200)

      expect(response.body.data).toHaveLength(50)
      expect(response.body.data[0].label).toBe('event 54')
      expect(response.body.data[49].label).toBe('event 5')
    })

    it('serialises createdAt as a string', async () => {
      await request(app)
        .post('/events')
        .send({ type: EventType.USER_SIGNUP, label: 'iso check' })
        .expect(201)

      const response = await request(app).get('/events').expect(200)
      const [event] = response.body.data

      expect(typeof event.createdAt).toBe('string')
      expect(new Date(event.createdAt).toISOString()).toBe(event.createdAt)
    })

    it('orders deterministically when events share a timestamp', async () => {
      // created_at alone would let two events in the same millisecond swap places
      // between requests; the id is the tie-break.
      const sameInstant = new Date('2026-07-01T00:00:00.000Z')
      await prisma.event.createMany({
        data: Array.from({ length: 5 }, (_unused, index) => ({
          type: EventType.USER_SIGNUP,
          label: `tie ${index}`,
          channel: NotificationChannel.IN_APP,
          createdAt: sameInstant,
        })),
      })

      const first = await request(app).get('/events').expect(200)
      const second = await request(app).get('/events').expect(200)

      expect(first.body.data.map((event: EventDTO) => event.id)).toEqual(
        second.body.data.map((event: EventDTO) => event.id),
      )
    })
  })

  describe('unknown routes', () => {
    it('returns a JSON 404 rather than HTML', async () => {
      const response = await request(app).get('/does-not-exist').expect(404)

      expect(response.body).toEqual({ error: 'Not found' })
    })
  })
})
