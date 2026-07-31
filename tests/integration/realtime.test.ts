import { createServer, type Server as HttpServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Socket } from 'socket.io-client'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../../src/app.js'
import { EventType, NotificationChannel } from '../../src/generated/prisma/enums.js'
import { prisma } from '../../src/lib/prisma.js'
import type { EventDTO } from '../../src/lib/serialize.js'
import { createDispatcher } from '../../src/notifications/dispatch.js'
import { createRealtime, FEED_EVENT, PUSH_EVENT } from '../../src/realtime/socket.js'
import { closeAll, connectClient, expectSilence, waitForEvent } from '../helpers/socket.js'
import { hasTestDatabase } from '../setup/test-env.js'

/**
 * Drives the whole stack as it runs in production: the real Socket.io server, the
 * real dispatcher wired to it, and real clients over a websocket. Nothing is
 * mocked, because the thing under test is the interaction — that a created event
 * reaches the feed, and that only an in-app event also reaches the push channel.
 */
describe.skipIf(!hasTestDatabase)('realtime event stream', () => {
  let realtime: ReturnType<typeof createRealtime>
  let httpServer: HttpServer
  let baseUrl: string
  let clients: Socket[]

  const postEvent = async (
    body: Record<string, unknown>,
  ): Promise<{ status: number; data: EventDTO; notification: { detail: string } }> => {
    const response = await fetch(`${baseUrl}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const payload = (await response.json()) as { data: EventDTO; notification: { detail: string } }
    return { status: response.status, ...payload }
  }

  beforeAll(async () => {
    // Same construction order as src/index.ts: the realtime layer hands out
    // broadcast/publish first, the dispatcher and app are built from them, and
    // Socket.io attaches only after Express is the server's request handler.
    realtime = createRealtime()
    const dispatch = createDispatcher(realtime.publish)
    httpServer = createServer(createApp({ broadcast: realtime.broadcast, dispatch }))
    realtime.attach(httpServer)

    // Port 0 lets the OS pick a free port, so the suite cannot collide with a dev
    // server already on 4000.
    await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve))
    baseUrl = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`
  })

  beforeEach(async () => {
    clients = []
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "events"')
  })

  afterEach(async () => {
    await closeAll(...clients)
  })

  afterAll(async () => {
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "events"')
    await realtime.close()
    await prisma.$disconnect()
  })

  const connect = async (): Promise<Socket> => {
    const socket = await connectClient(baseUrl)
    clients.push(socket)
    return socket
  }

  it('pushes a created event to a connected client', async () => {
    const socket = await connect()
    const received = waitForEvent<EventDTO>(socket, FEED_EVENT)

    const response = await postEvent({
      type: EventType.USER_SIGNUP,
      label: 'New signup: ada@example.com',
    })
    expect(response.status).toBe(201)

    const event = await received
    expect(event).toEqual(response.data)
    expect(typeof event.createdAt).toBe('string')
  })

  it('sends an in-app event to both the feed and the push channel', async () => {
    const socket = await connect()
    const feed = waitForEvent<EventDTO>(socket, FEED_EVENT)
    const push = waitForEvent<EventDTO>(socket, PUSH_EVENT)

    await postEvent({ type: EventType.PAYMENT_RECEIVED, label: 'Payment received' })

    const [feedEvent, pushEvent] = await Promise.all([feed, push])
    expect(feedEvent.channel).toBe(NotificationChannel.IN_APP)
    expect(pushEvent).toEqual(feedEvent)
  })

  it.each([
    [EventType.PAYMENT_FAILED, NotificationChannel.SMS],
    [EventType.ORDER_SHIPPED, NotificationChannel.WHATSAPP],
  ])('sends a %s event to the feed but not the push channel', async (type, channel) => {
    // The distinction the notification layer exists to make: a stubbed channel
    // still produces a feed row, because it is a logged event either way. If this
    // leaked onto PUSH_EVENT, an SMS would surface as an in-app notification.
    const socket = await connect()
    const feed = waitForEvent<EventDTO>(socket, FEED_EVENT)
    const silence = expectSilence(socket, PUSH_EVENT)

    await postEvent({ type, label: `stubbed ${channel}` })

    const event = await feed
    expect(event.channel).toBe(channel)
    await silence
  })

  it('reaches every connected client, not just the one that triggered it', async () => {
    const [first, second] = await Promise.all([connect(), connect()])
    const received = Promise.all([
      waitForEvent<EventDTO>(first, FEED_EVENT),
      waitForEvent<EventDTO>(second, FEED_EVENT),
    ])

    await postEvent({ type: EventType.USER_SIGNUP, label: 'broadcast to all' })

    const [a, b] = await received
    expect(a).toEqual(b)
  })

  it('reports how many clients the push reached', async () => {
    await Promise.all([connect(), connect()])

    const response = await postEvent({
      type: EventType.USER_SIGNUP,
      label: 'recipient count',
    })

    expect(response.notification.detail).toBe('pushed to 2 connected client(s)')
  })

  it('does not replay history to a client that connects later', async () => {
    // History is the REST endpoint's job. If the socket replayed on connect, the
    // client would have to de-duplicate a whole page rather than the handful of
    // events that can race the initial fetch.
    await postEvent({ type: EventType.USER_SIGNUP, label: 'created before connecting' })

    const socket = await connect()
    await expectSilence(socket, FEED_EVENT)

    const response = await fetch(`${baseUrl}/events`)
    const { data } = (await response.json()) as { data: EventDTO[] }
    expect(data).toHaveLength(1)
  })

  it('keeps serving REST while a socket is attached', async () => {
    // Regression guard for the attach-ordering hazard documented in socket.ts:
    // attaching engine.io before Express is registered makes both answer every
    // request. A plain GET is the cheapest way to catch it.
    await connect()

    const response = await fetch(`${baseUrl}/health`)
    expect(response.status).toBe(200)
    expect(((await response.json()) as { status: string }).status).toBe('ok')
  })
})

describe.skipIf(!hasTestDatabase)('realtime shutdown', () => {
  it('closes the socket server and releases the port', async () => {
    // Its own stack, because closing the transport tears down the http.Server too.
    const realtime = createRealtime()
    const dispatch = createDispatcher(realtime.publish)
    const httpServer = createServer(createApp({ broadcast: realtime.broadcast, dispatch }))
    realtime.attach(httpServer)
    await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve))

    const { port } = httpServer.address() as AddressInfo
    const socket = await connectClient(`http://127.0.0.1:${port}`)
    expect(socket.connected).toBe(true)
    socket.close()

    await realtime.close()

    // Nothing is listening any more, so the handshake cannot complete. A server
    // that leaked its listener would resolve here instead.
    await expect(connectClient(`http://127.0.0.1:${port}`)).rejects.toThrow()
  })

  it('is safe to close a realtime layer that never attached', async () => {
    // shutdown() runs on SIGTERM regardless of how far startup got.
    await expect(createRealtime().close()).resolves.toBeUndefined()
  })
})
