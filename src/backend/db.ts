/**
 * backend/db.ts
 * One small interface over two Postgres drivers:
 * - DATABASE_URL set: a real server through `pg` (production).
 * - otherwise: PGlite, Postgres compiled to WebAssembly, running inside this process.
 *   It keeps data in PGLITE_DIR (a folder) when set, and in memory when not (tests).
 * Both speak the same SQL, so the code above this file does not care which one it got.
 */

import pg from 'pg'
import { PGlite } from '@electric-sql/pglite'
import { MIGRATIONS } from './migrations'

export interface Queryable {
  query<T = Record<string, any>>(sql: string, params?: unknown[]): Promise<T[]>
}

export interface Db extends Queryable {
  /** Runs fn inside a transaction. Any thrown error rolls everything back. */
  tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T>
  close(): Promise<void>
  readonly kind: 'postgres' | 'pglite'
}

const NUMERIC = 1700

export async function createDb(opts: { url?: string; dataDir?: string } = {}): Promise<Db> {
  const db = opts.url ? connectPg(opts.url) : await openPglite(opts.dataDir)
  await migrate(db)
  return db
}

function connectPg(url: string): Db {
  pg.types.setTypeParser(NUMERIC, (v) => Number(v)) // rupee amounts come back as numbers
  const pool = new pg.Pool({ connectionString: url, max: 10 })
  return {
    kind: 'postgres',
    query: async (sql, params) => (await pool.query(sql, params as unknown[])).rows,
    tx: async (fn) => {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const out = await fn({ query: async (sql, params) => (await client.query(sql, params as unknown[])).rows })
        await client.query('COMMIT')
        return out
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {})
        throw e
      } finally {
        client.release()
      }
    },
    close: () => pool.end(),
  }
}

async function openPglite(dataDir?: string): Promise<Db> {
  const lite = new PGlite({ ...(dataDir ? { dataDir } : {}), parsers: { [NUMERIC]: (v: string) => Number(v) } })
  await lite.waitReady
  return {
    kind: 'pglite',
    query: async (sql, params) => (await lite.query(sql, params as unknown[])).rows as any[],
    tx: (fn) => lite.transaction((t) => fn({ query: async (sql, params) => (await t.query(sql, params as unknown[])).rows as any[] })),
    close: () => lite.close(),
  }
}

/** Applies any migration that has not run yet, in order. Safe to run on every start. */
async function migrate(db: Db): Promise<void> {
  await db.query('CREATE TABLE IF NOT EXISTS schema_migrations (version int PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())')
  const done = new Set((await db.query<{ version: number }>('SELECT version FROM schema_migrations')).map((r) => r.version))
  for (const m of MIGRATIONS) {
    if (done.has(m.version)) continue
    await db.tx(async (q) => {
      for (const stmt of m.sql) await q.query(stmt)
      await q.query('INSERT INTO schema_migrations (version) VALUES ($1)', [m.version])
    })
  }
}

/** Empties every data table. Used by tests so they can share one slow-to-start database. */
export async function resetAll(db: Db): Promise<void> {
  await db.query(
    'TRUNCATE orders, payments, scribes, scribe_strikes, escrow, rush_watches, courier_tasks, disputes, notifications, withdrawals, audit_log RESTART IDENTITY',
  )
}
