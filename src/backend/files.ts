/**
 * backend/files.ts
 * Where uploaded files live and when they are deleted.
 *
 * Bytes go to a FileStore (a folder on disk now; an S3-compatible bucket in production, see
 * STORAGE.md). The database keeps one row per file: who owns it, which order it belongs to and
 * when it must be deleted. A scheduled sweep removes expired files, so storage stays small
 * however many orders have been placed.
 */

import fs from 'node:fs'
import path from 'node:path'
import type { Queryable } from './db'

export type FileKind = 'notes' | 'evidence' | 'sample'

/** Days a file is kept after its order is Closed or Cancelled. Samples are kept until replaced. */
export const RETENTION_DAYS: Record<FileKind, number | null> = { notes: 7, evidence: 30, sample: null }

/** A file that never gets attached to an order is deleted after this many hours. */
export const ORPHAN_HOURS = 24

export interface FileStore {
  put(id: string, type: string, bytes: Buffer): Promise<void>
  /** Absolute path for local disk; other stores return a stream instead. */
  find(id: string, types: readonly string[]): { file: string; type: string } | undefined
  remove(id: string, type: string): Promise<void>
}

export function diskStore(dir: string): FileStore {
  return {
    async put(id, type, bytes) {
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(path.join(dir, `${id}.${type}`), bytes, { mode: 0o600 })
    },
    find(id, types) {
      for (const type of types) {
        const file = path.join(dir, `${id}.${type}`)
        if (fs.existsSync(file)) return { file, type }
      }
      return undefined
    },
    async remove(id, type) {
      fs.rmSync(path.join(dir, `${id}.${type}`), { force: true })
    },
  }
}

export async function registerFile(
  q: Queryable,
  f: { id: string; kind: FileKind; type: string; size: number; ownerPhone: string },
  now = new Date(),
): Promise<void> {
  const keepUntil = RETENTION_DAYS[f.kind] === null ? null : new Date(now.getTime() + ORPHAN_HOURS * 3_600_000)
  await q.query(
    'INSERT INTO files (id, kind, type, size, owner_phone, delete_after) VALUES ($1,$2,$3,$4,$5,$6)',
    [f.id, f.kind, f.type, f.size, f.ownerPhone, keepUntil],
  )
}

/** Ties an upload to an order so the orphan timer stops. Fails if it is not the owner's file. */
export async function attachFile(q: Queryable, fileId: string, orderId: string, ownerPhone: string | null): Promise<boolean> {
  const rows = await q.query(
    'UPDATE files SET order_id = $2, delete_after = NULL WHERE id = $1 AND ($3::text IS NULL OR owner_phone = $3) AND (order_id IS NULL OR order_id = $2) RETURNING id',
    [fileId, orderId, ownerPhone],
  )
  return rows.length > 0
}

/** Starts the retention clock for an order's files once the order is over. */
export async function startRetention(q: Queryable, orderId: string, now = new Date()): Promise<void> {
  for (const kind of ['notes', 'evidence'] as const) {
    const days = RETENTION_DAYS[kind]!
    await q.query('UPDATE files SET delete_after = $3 WHERE order_id = $1 AND kind = $2', [
      orderId,
      kind,
      new Date(now.getTime() + days * 86_400_000),
    ])
  }
}

export async function fileInfo(q: Queryable, id: string) {
  const rows = await q.query<{ id: string; kind: FileKind; type: string; size: number; owner_phone: string; order_id: string | null }>(
    'SELECT id, kind, type, size, owner_phone, order_id FROM files WHERE id = $1',
    [id],
  )
  return rows[0]
}

/** Deletes every expired file, bytes first and then the row. Returns how many were removed. */
export async function sweepFiles(q: Queryable, store: FileStore, now = new Date()): Promise<number> {
  const due = await q.query<{ id: string; type: string }>('SELECT id, type FROM files WHERE delete_after IS NOT NULL AND delete_after <= $1', [now])
  for (const f of due) {
    await store.remove(f.id, f.type)
    await q.query('DELETE FROM files WHERE id = $1', [f.id])
  }
  return due.length
}
