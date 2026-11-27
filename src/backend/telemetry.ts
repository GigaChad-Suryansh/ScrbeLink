/**
 * backend/telemetry.ts
 * Phase 19: Structured JSON logging and optional Sentry error reporting.
 * Zero external dependencies — posts directly to Sentry's ingest API when SENTRY_DSN is set.
 */

import crypto from 'node:crypto'

export function logEvent(level: 'info' | 'warn' | 'error', event: string, fields: Record<string, unknown> = {}): void {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    event,
    ...fields,
  })
  if (level === 'error') console.error(line)
  else console.log(line)
}

export interface ParsedDsn {
  endpoint: string
  publicKey: string
}

export function parseSentryDsn(dsn: string): ParsedDsn | undefined {
  try {
    const u = new URL(dsn)
    const projectId = u.pathname.replace(/^\/+/, '')
    if (!u.username || !projectId) return undefined
    return {
      endpoint: `${u.protocol}//${u.host}/api/${projectId}/store/`,
      publicKey: u.username,
    }
  } catch {
    return undefined
  }
}

export type TelemetryFetcher = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; status: number }>

let telemetryFetcher: TelemetryFetcher = (url, init) => fetch(url, init)
export const setTelemetryFetcher = (f: TelemetryFetcher) => { telemetryFetcher = f }

export async function reportError(err: unknown, context: Record<string, unknown> = {}, dsn = process.env.SENTRY_DSN): Promise<boolean> {
  const message = err instanceof Error ? err.message : String(err)
  const stack = err instanceof Error ? err.stack : undefined
  logEvent('error', 'unhandled_error', { message, ...context })

  if (!dsn) return false
  const parsed = parseSentryDsn(dsn)
  if (!parsed) return false

  try {
    const res = await telemetryFetcher(parsed.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Sentry-Auth': `Sentry sentry_version=7, sentry_key=${parsed.publicKey}, sentry_client=scribelink/1.0`,
      },
      body: JSON.stringify({
        event_id: crypto.randomBytes(16).toString('hex'),
        timestamp: new Date().toISOString(),
        platform: 'node',
        level: 'error',
        message,
        extra: { stack, ...context },
      }),
    })
    return res.ok
  } catch {
    return false
  }
}
