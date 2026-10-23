/**
 * backend/validate.ts
 * Small request validators. Each one returns a clean value or throws ValidationError,
 * which the API turns into a 400. Nothing here trusts the client's types.
 */

export class ValidationError extends Error {}

const fail = (msg: string): never => {
  throw new ValidationError(msg)
}

export function str(v: unknown, name: string, opts: { min?: number; max: number }): string {
  if (typeof v !== 'string') return fail(`${name} must be text`)
  const s = v.trim()
  if (s.length < (opts.min ?? 1)) return fail(`${name} is required`)
  if (s.length > opts.max) return fail(`${name} must be at most ${opts.max} characters`)
  return s
}

export function optStr(v: unknown, name: string, max: number): string | undefined {
  if (v === undefined || v === null || v === '') return undefined
  return str(v, name, { max })
}

export function int(v: unknown, name: string, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isInteger(v)) return fail(`${name} must be a whole number`)
  if (v < min || v > max) return fail(`${name} must be between ${min} and ${max}`)
  return v
}

export function optInt(v: unknown, name: string, min: number, max: number): number {
  return v === undefined || v === null ? 0 : int(v, name, min, max)
}

export function bool(v: unknown, name: string): boolean {
  if (typeof v !== 'boolean') return fail(`${name} must be true or false`)
  return v
}

export function oneOf<T extends string>(v: unknown, name: string, allowed: readonly T[]): T {
  if (typeof v !== 'string' || !(allowed as readonly string[]).includes(v)) {
    return fail(`${name} must be one of: ${allowed.join(', ')}`)
  }
  return v as T
}

/** Indian mobile number in E.164 form, e.g. +919876543210. */
export function phone(v: unknown, name = 'phone'): string {
  const s = str(v, name, { max: 15 })
  if (!/^\+91[6-9]\d{9}$/.test(s)) return fail(`${name} must look like +919876543210`)
  return s
}

/** Identifiers such as SL-1234, DISP-AB12, S-9F3A21. Keeps odd characters out of logs and links. */
export function idLike(v: unknown, name: string): string {
  const s = str(v, name, { max: 40 })
  if (!/^[A-Za-z0-9_-]+$/.test(s)) return fail(`${name} has invalid characters`)
  return s
}

export function upiId(v: unknown, name = 'payerVpa'): string {
  const s = str(v, name, { max: 60 })
  if (!/^[\w.-]{2,}@[a-zA-Z]{2,}$/.test(s)) return fail(`${name} must look like name@bank`)
  return s
}

/** Amount in rupees: positive, at most two decimals, capped. */
export function rupees(v: unknown, name = 'amount'): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fail(`${name} must be a number`)
  if (v <= 0 || v > 100_000) return fail(`${name} must be between 0 and 100000`)
  if (Math.round(v * 100) / 100 !== v) return fail(`${name} can have at most 2 decimals`)
  return v
}

/**
 * Evidence links (unboxing video, gate-drop photo). HTTPS only, no credentials,
 * no IP addresses or internal names. If MEDIA_HOSTS is set, only those hosts
 * (and their subdomains) are accepted, so links must point at our own storage.
 */
export function mediaUrl(v: unknown, name: string): string {
  const raw = str(v, name, { max: 500 })
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return fail(`${name} must be a valid link`)
  }
  if (u.protocol !== 'https:') return fail(`${name} must use https`)
  if (u.username || u.password) return fail(`${name} must not contain credentials`)

  const host = u.hostname.toLowerCase()
  const isIp = /^[\d.]+$/.test(host) || host.startsWith('[')
  const isInternal = host === 'localhost' || /\.(local|localhost|internal|lan)$/.test(host) || !host.includes('.')
  if (isIp || isInternal) return fail(`${name} must use a public domain name`)

  const allowed = (process.env.MEDIA_HOSTS ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
  if (allowed.length > 0 && !allowed.some((h) => host === h || host.endsWith('.' + h))) {
    return fail(`${name} must point to approved storage`)
  }
  return u.toString()
}
