import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

// Detect a stale cached client (e.g. the schema was updated after the dev
// server started, so the cached instance is missing newer models). If the
// cached client is missing the `generatedApp` model, drop the cache and
// re-instantiate so the new schema is picked up without a dev-server restart.
const cached = globalForPrisma.prisma
const hasGeneratedApp =
  !!cached &&
  typeof (cached as unknown as { generatedApp?: unknown }).generatedApp !==
    'undefined'

export const db =
  (hasGeneratedApp ? cached : null) ??
  new PrismaClient({
    log: ['query'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
