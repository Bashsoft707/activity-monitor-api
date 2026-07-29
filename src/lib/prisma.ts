import { PrismaPg } from '@prisma/adapter-pg'
import { env } from '../env.js'
import { PrismaClient } from '../generated/prisma/client.js'

// Prisma 7 no longer bundles a query engine with the client, so a driver adapter
// is required rather than optional.
const adapter = new PrismaPg({ connectionString: env.databaseUrl })

// A single long-lived client for the process. The globalThis singleton trick you
// see in Next.js projects exists to survive hot-reload; this server restarts
// wholesale, so it would add nothing here.
export const prisma = new PrismaClient({ adapter })
