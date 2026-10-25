/**
 * lib/api.ts
 * Thin client for the ScribeLink API plus the signed-in sessions.
 *
 * One browser can hold a customer, a scribe and an admin session at once (handy for demos),
 * so tokens are kept per role and every call says which role it acts as.
 */

import { useSyncExternalStore } from 'react'

export type Role = 'customer' | 'scribe' | 'admin'

const KEY = 'scribelink.v1.sessions'
const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? ''

type Sessions = Partial<Record<Role, { token: string; phone: string }>>

let sessions: Sessions = load()
const listeners = new Set<() => void>()

function load(): Sessions {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Sessions
  } catch {
    return {}
  }
}

function save(next: Sessions): void {
  sessions = next
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    /* storage blocked: the session lasts until reload */
  }
  listeners.forEach((l) => l())
}

export const getSession = (role: Role) => sessions[role]
export const signOut = (role: Role) => {
  const { [role]: _gone, ...rest } = sessions
  save(rest)
}
export const signOutAll = () => save({})

/** Re-renders when anyone signs in or out. */
export function useSessions(): Sessions {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => sessions,
  )
}

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

interface CallOptions {
  /** Which signed-in role makes the call. Leave out for public endpoints. */
  as?: Role
  body?: unknown
  /** Raw bytes (uploads). */
  raw?: Blob
  headers?: Record<string, string>
}

export async function api<T = Record<string, unknown>>(method: string, path: string, opts: CallOptions = {}): Promise<T> {
  const session = opts.as ? sessions[opts.as] : undefined
  if (opts.as && !session) throw new ApiError(401, 'Please sign in first.')

  const headers: Record<string, string> = { ...opts.headers }
  if (session) headers.Authorization = `Bearer ${session.token}`
  let body: BodyInit | undefined
  if (opts.raw) {
    headers['Content-Type'] = 'application/octet-stream'
    body = opts.raw
  } else if (opts.body !== undefined && method !== 'GET') {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(opts.body)
  }

  let res: Response
  try {
    res = await fetch(BASE + path, { method, headers, body })
  } catch {
    throw new ApiError(0, 'Cannot reach the server. Is it running?')
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string }
  if (res.status === 401 && opts.as) {
    signOut(opts.as) // the token expired or was rejected
    throw new ApiError(401, 'Your session expired. Please sign in again.')
  }
  if (!res.ok) throw new ApiError(res.status, data.error ?? `Request failed (${res.status})`)
  return data as T
}

/** Fetches a protected file (such as an evidence video) as a blob URL the browser can play. */
export async function fetchBlobUrl(path: string, as: Role): Promise<string> {
  const session = sessions[as]
  if (!session) throw new ApiError(401, 'Please sign in first.')
  const res = await fetch(BASE + path, { headers: { Authorization: `Bearer ${session.token}` } })
  if (!res.ok) throw new ApiError(res.status, 'Could not load the file.')
  return URL.createObjectURL(await res.blob())
}

// ── Sign-in ──────────────────────────────────────────────────────────────────

export async function sendOtp(phone: string): Promise<{ devOtp?: string }> {
  return api<{ devOtp?: string }>('POST', '/api/auth/otp/send', { body: { phone } })
}

export async function verifyOtp(role: Role, phone: string, otp: string): Promise<void> {
  const r = await api<{ token: string }>('POST', '/api/auth/otp/verify', { body: { phone, otp, requestedRole: role } })
  save({ ...sessions, [role]: { token: r.token, phone } })
}
