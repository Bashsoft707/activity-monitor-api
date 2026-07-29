import { createServer } from 'node:http'
import { createApp } from './app.js'
import { env } from './env.js'
import { prisma } from './lib/prisma.js'
import { createDispatcher, type RealtimePublisher } from './notifications/dispatch.js'

// Placeholder transport: reports zero recipients because nothing is attached yet.
// The Socket.io implementation replaces this in the next commit.
const publish: RealtimePublisher = () => 0

const dispatch = createDispatcher(publish)

// Socket.io (added next) attaches to this http.Server, so the server — not the
// Express app — is what gets listened on.
const httpServer = createServer(createApp({ dispatch }))

httpServer.listen(env.port, () => {
  console.log(`API listening on port ${env.port}`)
})

const shutdown = async (signal: string): Promise<void> => {
  console.log(`${signal} received, closing server`)
  httpServer.close()
  await prisma.$disconnect()
  process.exit(0)
}

// Railway sends SIGTERM on redeploy; closing the pool avoids leaking connections.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void shutdown(signal)
  })
}
