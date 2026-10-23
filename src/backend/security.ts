/**
 * backend/security.ts
 * Session tokens, role guards, brute-force lockouts and OTP generation.
 * Uses only node:crypto, so there is no extra dependency to audit.
 */

import crypto from 'node:crypto'
import type { NextFunction, Request, Response } from 'express'

export type Role = 'customer' | 'scribe' | 'admin'
export const ROLES: readonly Role[] = ['customer', 'scribe', 'admin']

export interface Session {
  phone: string
  role: Role
  /** Expiry, seconds since epoch */
  exp: number
}

export const isProduction = () => process.env.NODE_ENV === 'production'

// ── Secrets ──────────────────────────────────────────────────────────────────

let devSecret: string | undefined

function sessionSecret(): string {
  const fromEnv = process.env.SESSION_SECRET
  if (fromEnv && fromEnv.length >= 32) return fromEnv
  if (isProduction()) {
    throw new Error('SESSION_SECRET must be set to at least 32 characters in production')
  }
  // Development and tests: a random per-process secret. Tokens do not survive a restart.
  devSecret ??= crypto.randomBytes(32).toString('hex')
  return devSecret
}

/** Call once at startup so a misconfigured production deploy fails immediately. */
export function assertProductionConfig(): void {
  sessionSecret()
}

/** Constant-time string comparison (hashes first so lengths never leak). */
export function safeEqual(a: string, b: string): boolean {
  const ha = crypto.createHash('sha256').update(a).digest()
  const hb = crypto.createHash('sha256').update(b).digest()
  return crypto.timingSafeEqual(ha, hb)
}

// ── Session tokens (HMAC-SHA256, "payload.signature") ────────────────────────

const sign = (body: string) => crypto.createHmac('sha256', sessionSecret()).update(body).digest('base64url')

export function signSession(
  user: { phone: string; role: Role },
  ttlSeconds = 8 * 3600,
  nowMs = Date.now(),
): string {
  const payload: Session = { phone: user.phone, role: user.role, exp: Math.floor(nowMs / 1000) + ttlSeconds }
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${body}.${sign(body)}`
}

export function verifySession(token: unknown, nowMs = Date.now()): Session | null {
  if (typeof token !== 'string') return null
  const parts = token.split('.')
  if (parts.length !== 2) return null
  const [body, signature] = parts
  if (!safeEqual(signature, sign(body))) return null
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Partial<Session>
    if (typeof p.phone !== 'string' || typeof p.exp !== 'number') return null
    if (!p.role || !ROLES.includes(p.role)) return null
    if (p.exp * 1000 <= nowMs) return null
    return { phone: p.phone, role: p.role, exp: p.exp }
  } catch {
    return null
  }
}

// ── Express guards ───────────────────────────────────────────────────────────

/** Requires a valid Bearer token. With roles given, the user must hold one of them. */
export function requireAuth(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const header = req.headers.authorization ?? ''
    const session = verifySession(header.startsWith('Bearer ') ? header.slice(7) : '')
    if (!session) return res.status(401).json({ error: 'Authentication required' })
    if (roles.length > 0 && !roles.includes(session.role)) {
      return res.status(403).json({ error: 'Your role is not allowed to do this' })
    }
    res.locals.session = session
    return next()
  }
}

export const sessionOf = (res: Response): Session => res.locals.session as Session

/** For the scheduler endpoint: an admin token, or the CRON_SECRET header from the platform's cron. */
export function requireAdminOrCron(req: Request, res: Response, next: NextFunction) {
  const secret = process.env.CRON_SECRET
  const given = req.headers['x-cron-secret']
  if (secret && secret.length >= 16 && typeof given === 'string' && safeEqual(given, secret)) {
    return next()
  }
  return requireAuth('admin')(req, res, next)
}

// ── Identity helpers ─────────────────────────────────────────────────────────

/** Admin phones are an allowlist from the environment. Nobody can self-assign admin. */
export function adminPhones(): Set<string> {
  return new Set((process.env.ADMIN_PHONES ?? '').split(',').map((s) => s.trim()).filter(Boolean))
}

/** Stable pseudonymous public ID for a scribe, so customers never see a phone number. */
export function scribeIdFor(phone: string): string {
  return 'S-' + crypto.createHash('sha256').update(phone).digest('hex').slice(0, 6).toUpperCase()
}

// ── Random values ────────────────────────────────────────────────────────────

export { randomDigits, randomToken } from '../shared/random'

// ── Brute-force lockout ──────────────────────────────────────────────────────

/** After `max` failures for a key, the key is locked for `lockMs`. In-memory, per process. */
export class AttemptLimiter {
  private entries = new Map<string, { count: number; lockedUntil: number }>()
  private readonly max: number
  private readonly lockMs: number
  private readonly now: () => number

  constructor(max: number, lockMs: number, now: () => number = Date.now) {
    this.max = max
    this.lockMs = lockMs
    this.now = now
  }

  /** Milliseconds left on the lock, or 0 if the key is free. */
  lockedForMs(key: string): number {
    const e = this.entries.get(key)
    if (!e) return 0
    const left = e.lockedUntil - this.now()
    if (left > 0) return left
    if (e.lockedUntil !== 0) this.entries.delete(key) // lock expired: start fresh
    return 0
  }

  fail(key: string): void {
    this.prune()
    const e = this.entries.get(key) ?? { count: 0, lockedUntil: 0 }
    e.count += 1
    if (e.count >= this.max) e.lockedUntil = this.now() + this.lockMs
    this.entries.set(key, e)
  }

  clear(key: string): void {
    this.entries.delete(key)
  }

  private prune(): void {
    if (this.entries.size < 10_000) return
    for (const [k, e] of this.entries) if (e.lockedUntil !== 0 && e.lockedUntil <= this.now()) this.entries.delete(k)
  }
}
