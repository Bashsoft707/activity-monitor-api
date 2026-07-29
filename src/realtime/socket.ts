import type { Server as HttpServer } from 'node:http'
import { Server } from 'socket.io'
import { env } from '../env.js'
import type { EventDTO } from '../lib/serialize.js'
import type { RealtimePublisher } from '../notifications/dispatch.js'

/** Every logged event, so the monitor's feed stays live. Clients listen on this. */
export const FEED_EVENT = 'event:created'

/**
 * Only events the router sent to IN_APP. This is a notification rather than a
 * feed row, which is why it is a separate message from FEED_EVENT.
 */
export const PUSH_EVENT = 'notification:push'

export type Realtime = {
  /** Must be called after the Express app is already the server's request handler. */
  attach: (httpServer: HttpServer) => void
  broadcast: (event: EventDTO) => void
  publish: RealtimePublisher
  close: () => Promise<void>
}

/**
 * Builds the realtime layer.
 *
 * The Socket.io server is created in `attach()` rather than here, because of a
 * strict ordering requirement: engine.io's attach() snapshots whatever
 * 'request' listeners the http.Server already has, removes them, and installs its
 * own dispatcher that routes /socket.io/* to itself and forwards everything else
 * to that snapshot. Attaching before the Express app is registered leaves the
 * snapshot empty, so both engine.io and Express end up answering every handshake
 * and the process dies with ERR_HTTP_HEADERS_SENT.
 *
 * Deferring lets the caller build `broadcast`/`publish` — which the notification
 * dispatcher needs — before the http.Server exists, then attach once the app is
 * wired. That is what unties the dependency cycle between app, dispatcher and io.
 */
export const createRealtime = (): Realtime => {
  let io: Server | null = null

  return {
    attach: (httpServer) => {
      // Socket.io runs its own CORS check on the handshake — the Express cors()
      // middleware does not cover it, so the allowlist has to be applied twice.
      io = new Server(httpServer, { cors: { origin: env.corsOrigins } })

      io.on('connection', (socket) => {
        console.log(`[socket] + ${socket.id} (${io?.engine.clientsCount ?? 0} connected)`)

        // No count logged here on purpose: clientsCount has not necessarily
        // decremented by the time this fires, so it reports the departing client
        // as still connected on a namespace disconnect but not on a transport close.
        socket.on('disconnect', (reason) => {
          console.log(`[socket] - ${socket.id} ${reason}`)
        })
      })
    },

    /**
     * Feed rows reach every client regardless of delivery channel. If this were
     * gated on the channel, an event routed to SMS would never show up in the
     * live monitor.
     */
    broadcast: (event) => {
      io?.emit(FEED_EVENT, event)
    },

    /**
     * The one real notification channel. The return value is how many clients
     * were connected at emit time — a recipient count, not a delivery receipt.
     */
    publish: (event) => {
      io?.emit(PUSH_EVENT, event)
      return io?.engine.clientsCount ?? 0
    },

    // Note: this also closes the underlying http.Server.
    close: () =>
      io === null
        ? Promise.resolve()
        : new Promise((resolve) => {
            io?.close(() => resolve())
          }),
  }
}
