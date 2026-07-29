import { createServer } from 'node:http'
import { createApp } from './app.js'
import { env } from './env.js'
import { prisma } from './lib/prisma.js'

// Socket.io (added next) attaches to this http.Server, so the server — not the
// Express app — is what gets listened on.
const httpServer = createServer(createApp())

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
