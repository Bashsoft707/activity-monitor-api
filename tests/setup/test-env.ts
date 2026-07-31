import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Points the process at the test database before any application module reads
 * `DATABASE_URL`.
 *
 * `src/env.ts` resolves its config at module load, so this has to win the race.
 * It does, for two reasons: Vitest runs `setupFiles` before the test file's own
 * imports, and `dotenv` does not overwrite variables that are already set — so
 * the real `.env` cannot clobber what is assigned here.
 *
 * The test database is deliberately a separate connection string rather than the
 * development one. The integration suites truncate the events table, so pointing
 * them at the demo database would wipe it.
 */

const TEST_ENV_FILE = resolve(process.cwd(), '.env.test')

/** Minimal .env parser — enough for KEY="value" and KEY=value, ignoring comments. */
const parseEnvFile = (contents: string): Map<string, string> => {
  const values = new Map<string, string>()

  for (const rawLine of contents.split('\n')) {
    const line = rawLine.trim()
    if (line.length === 0 || line.startsWith('#')) continue

    const separator = line.indexOf('=')
    if (separator === -1) continue

    const key = line.slice(0, separator).trim()
    let value = line.slice(separator + 1).trim()

    const quoted =
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    if (quoted && value.length >= 2) value = value.slice(1, -1)

    if (key.length > 0) values.set(key, value)
  }

  return values
}

const loadTestDatabaseUrl = (): string | null => {
  if (!existsSync(TEST_ENV_FILE)) return null

  const url = parseEnvFile(readFileSync(TEST_ENV_FILE, 'utf8')).get('DATABASE_URL')
  return url !== undefined && url.trim().length > 0 ? url : null
}

const testDatabaseUrl = loadTestDatabaseUrl()

if (testDatabaseUrl !== null) {
  process.env['DATABASE_URL'] = testDatabaseUrl
} else {
  // No test database configured. The integration suites skip themselves, but the
  // import graph still reaches src/env.ts, which throws on a missing
  // DATABASE_URL — so give it something syntactically valid that is never dialled.
  process.env['DATABASE_URL'] ??= 'postgresql://unconfigured@127.0.0.1:5432/unconfigured'
}

/**
 * Whether integration tests can run. Unit tests never touch the database and
 * ignore this.
 */
export const hasTestDatabase = testDatabaseUrl !== null

if (!hasTestDatabase) {
  console.warn(
    '\n  No .env.test found — integration tests will be skipped.\n' +
      '  Copy .env.test.example to .env.test and run `npm run migrate:test` to enable them.\n',
  )
}
