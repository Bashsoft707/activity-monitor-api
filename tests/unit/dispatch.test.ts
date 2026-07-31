import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NotificationChannel } from '../../src/generated/prisma/enums.js'
import { createDispatcher } from '../../src/notifications/dispatch.js'
import { buildEventDTO } from '../helpers/factories.js'

describe('createDispatcher', () => {
  let logs: string[]

  beforeEach(() => {
    logs = []
    // The log line is the deliverable for the stubbed channels — it is the only
    // evidence of which channel would have been used — so it is asserted, not
    // merely silenced.
    vi.spyOn(console, 'log').mockImplementation((message: unknown) => {
      logs.push(String(message))
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('in-app push — the one implemented channel', () => {
    it('publishes to the realtime transport and reports delivery', () => {
      const publish = vi.fn().mockReturnValue(3)
      const event = buildEventDTO({ channel: NotificationChannel.IN_APP })

      const outcome = createDispatcher(publish)(event)

      expect(publish).toHaveBeenCalledExactlyOnceWith(event)
      expect(outcome).toEqual({
        channel: NotificationChannel.IN_APP,
        delivered: true,
        detail: 'pushed to 3 connected client(s)',
      })
    })

    it('reports a recipient count, not a delivery receipt', () => {
      // Zero connected clients is still a successful dispatch: the event went to
      // the transport. Nobody happened to be listening.
      const outcome = createDispatcher(vi.fn().mockReturnValue(0))(
        buildEventDTO({ channel: NotificationChannel.IN_APP }),
      )

      expect(outcome.delivered).toBe(true)
      expect(outcome.detail).toBe('pushed to 0 connected client(s)')
    })
  })

  describe('stubbed channels', () => {
    it.each([
      [NotificationChannel.SMS, 'stub: would send SMS to +2348012345678'],
      [NotificationChannel.WHATSAPP, 'stub: would send WhatsApp message to +2348012345678'],
    ])('%s logs what it would have sent and reports delivered=false', (channel, detail) => {
      const publish = vi.fn()

      const outcome = createDispatcher(publish)(
        buildEventDTO({ channel, metadata: { recipient: '+2348012345678' } }),
      )

      expect(outcome).toEqual({ channel, delivered: false, detail })
      // The important half: a stubbed channel must not quietly fall back to the
      // socket, or an SMS event would surface as an in-app notification.
      expect(publish).not.toHaveBeenCalled()
    })
  })

  describe('recipient extraction from free-form metadata', () => {
    it.each([
      ['a string recipient', { recipient: '+2348012345678' }, '+2348012345678'],
      ['no recipient key', { plan: 'free' }, 'no recipient in metadata'],
      ['null metadata', null, 'no recipient in metadata'],
      ['an array', ['+2348012345678'], 'no recipient in metadata'],
      ['a non-string recipient', { recipient: 42 }, 'no recipient in metadata'],
      ['a blank recipient', { recipient: '   ' }, 'no recipient in metadata'],
    ])('handles %s', (_case, metadata, expected) => {
      // metadata is arbitrary JSON supplied by the caller, so nothing about its
      // shape can be assumed — a malformed value must not throw mid-dispatch.
      const outcome = createDispatcher(vi.fn())(
        buildEventDTO({ channel: NotificationChannel.SMS, metadata }),
      )

      expect(outcome.detail).toBe(`stub: would send SMS to ${expected}`)
    })
  })

  describe('logging', () => {
    it('names the channel and delivery state for every dispatch', () => {
      const dispatch = createDispatcher(vi.fn().mockReturnValue(1))

      dispatch(buildEventDTO({ channel: NotificationChannel.IN_APP }))
      dispatch(buildEventDTO({ channel: NotificationChannel.SMS }))
      dispatch(buildEventDTO({ channel: NotificationChannel.WHATSAPP }))

      expect(logs).toHaveLength(3)
      expect(logs[0]).toContain('channel=IN_APP')
      expect(logs[0]).toContain('delivered=true')
      expect(logs[1]).toContain('channel=SMS')
      expect(logs[1]).toContain('delivered=false')
      expect(logs[2]).toContain('channel=WHATSAPP')
      expect(logs[2]).toContain('delivered=false')
    })

    it('includes the event id so a log line ties back to a row', () => {
      createDispatcher(vi.fn().mockReturnValue(1))(
        buildEventDTO({ id: '019fb4ba-dead-7408-8a0e-000000000001' }),
      )

      expect(logs[0]).toContain('event=019fb4ba-dead-7408-8a0e-000000000001')
      expect(logs[0]).toMatch(/^\[notify]/)
    })
  })
})
