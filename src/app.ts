import cors from 'cors'
import express from 'express'
import type { NextFunction, Request, Response } from 'express'
import { env } from './env.js'
import type { Dispatcher } from './notifications/dispatch.js'
import { createEventsRouter } from './routes/events.js'

export type AppDeps = {
  dispatch: Dispatcher
}

/**
 * Builds the Express app. Kept separate from the server so `index.ts` can wrap it
 * in a Node http.Server — Socket.io has to attach to that server, not to the app.
 *
 * The dispatcher is injected rather than imported so the routes stay independent
 * of which realtime transport is attached.
 */
export const createApp = ({ dispatch }: AppDeps) => {
  const app = express()

  app.use(cors({ origin: env.corsOrigins }))
  app.use(express.json())

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', uptime: process.uptime() })
  })

  app.use('/events', createEventsRouter({ dispatch }))

  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: 'Not found' })
  })

  // Express 5 forwards a rejected promise from an async handler here on its own,
  // so route handlers do not need their own try/catch.
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error(error)
    res.status(500).json({ error: 'Internal server error' })
  })

  return app
}
