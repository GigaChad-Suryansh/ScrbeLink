/**
 * scripts/backup-verify.mjs
 * Phase 19: Daily PostgreSQL backup and restore verification using pg_dump / psql.
 * Usage: DATABASE_URL=postgres://... BACKUP_DIR=.backups node scripts/backup-verify.mjs
 */

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const dbUrl = process.env.DATABASE_URL
if (!dbUrl) {
  console.error('DATABASE_URL is required to run backup-verify')
  process.exit(1)
}

const backupDir = process.env.BACKUP_DIR || path.resolve('.backups')
fs.mkdirSync(backupDir, { recursive: true })
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const outFile = path.join(backupDir, `scribelink-${stamp}.sql`)

console.log(`[backup] Dumping database to ${outFile}`)
execFileSync('pg_dump', ['--no-owner', '--no-privileges', dbUrl, '-f', outFile], { stdio: 'inherit' })

const size = fs.statSync(outFile).size
if (size === 0) {
  console.error('[backup] Dump file is empty')
  process.exit(1)
}
console.log(`[backup] Dump succeeded (${size} bytes)`)

if (process.env.VERIFY_RESTORE_URL) {
  console.log('[backup] Verifying restore into VERIFY_RESTORE_URL')
  execFileSync('psql', [process.env.VERIFY_RESTORE_URL, '-v', 'ON_ERROR_STOP=1', '-f', outFile], { stdio: 'inherit' })
  console.log('[backup] Restore verification succeeded')
}
