import 'dotenv/config'

const required = (name: string): string => {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return value
}

const port = Number(process.env.PORT ?? 4000)
if (!Number.isInteger(port) || port <= 0) {
  throw new Error(`PORT must be a positive integer, received: ${process.env.PORT}`)
}

export const env = {
  databaseUrl: required('DATABASE_URL'),
  port,
  // Explicit allowlist rather than a wildcard: the browser sends credentials-less
  // requests here, but a reflected origin would let any site call the API.
  corsOrigins: (process.env.CORS_ORIGIN ?? 'http://localhost:3000')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
} as const
