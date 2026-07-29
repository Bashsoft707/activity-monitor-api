import { createServer } from 'node:http'
import { createApp } from './app.js'
import { env } from './env.js'
import { prisma } from './lib/prisma.js'
import { createDispatcher } from './notifications/dispatch.js'
import { createRealtime } from './realtime/socket.js'

// Order matters here. The realtime layer hands out stable broadcast/publish
// functions up front, so the dispatcher and the app can be built before any
// server exists. Socket.io then attaches last — engine.io takes over the
// server's 'request' handling when it attaches, so the Express app has to
// already be registered or handshakes get answered twice.
const realtime = createRealtime()
const dispatch = createDispatcher(realtime.publish)

const httpServer = createServer(createApp({ broadcast: realtime.broadcast, dispatch }))
realtime.attach(httpServer)

httpServer.listen(env.port, () => {
  console.log(`API listening on port ${env.port}`)
})

const shutdown = async (signal: string): Promise<void> => {
  console.log(`${signal} received, closing server`)
  // Closing Socket.io also closes the http.Server it is attached to.
  await realtime.close()
  await prisma.$disconnect()
  process.exit(0)
}

// Railway sends SIGTERM on redeploy; closing the pool avoids leaking connections.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void shutdown(signal)
  })
}
