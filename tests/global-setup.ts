import { execSync } from 'child_process'

/**
 * Truncate all public Postgres tables before the test suite runs, so tests
 * start from a clean state regardless of prior runs.
 *
 * Tries common DATABASE_URL values that implementations are likely to use.
 * Silently continues if all attempts fail — tests use unique slugs per upload
 * and are naturally isolated even without a DB reset.
 */
async function globalSetup() {
  const candidates = [
    process.env.DATABASE_URL,
    'postgresql://postgres:postgres@localhost:5432/postgres',
    'postgresql://postgres@localhost:5432/postgres',
    'postgresql://localhost/postgres',
    'postgresql://postgres:password@localhost:5432/filedrop',
    'postgresql://postgres:postgres@localhost:5432/filedrop',
    'postgresql://postgres:postgres@localhost:5432/file_drop',
    'postgresql://postgres:postgres@localhost:5432/fileshare',
  ].filter(Boolean) as string[]

  const sql = `
    DO $$
    DECLARE
      r RECORD;
    BEGIN
      FOR r IN (
        SELECT tablename FROM pg_tables WHERE schemaname = 'public'
      ) LOOP
        EXECUTE 'TRUNCATE TABLE ' || quote_ident(r.tablename) || ' CASCADE';
      END LOOP;
    END
    $$;
  `.trim()

  for (const url of candidates) {
    try {
      execSync(`psql "${url}" -c "${sql.replace(/\n\s*/g, ' ')}"`, {
        stdio: 'pipe',
        timeout: 10_000,
      })
      console.log(`[global-setup] DB reset via ${url.replace(/:([^:@]+)@/, ':***@')}`)
      return
    } catch {
      // try next candidate
    }
  }

  console.warn(
    '[global-setup] WARNING: Could not reset DB. Tests use unique slugs per upload ' +
      'and remain isolated without a DB reset.',
  )
}

export default globalSetup
