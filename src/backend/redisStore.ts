/**
 * backend/redisStore.ts
 * Phase 19: Shared OTP store so multiple API instances can verify codes.
 * Uses Redis over RESP (redis:// or rediss://) when REDIS_URL is set,
 * falling back to an in-memory Map for single-instance dev/test.
 */

import net from 'node:net'
import tls from 'node:tls'

export interface OtpRecord {
  otp: string
  expiresAt: number
}

export interface OtpStore {
  readonly kind: 'memory' | 'redis'
  set(phone: string, rec: OtpRecord, ttlSeconds: number): Promise<void>
  get(phone: string): Promise<OtpRecord | undefined>
  del(phone: string): Promise<void>
}

export function memoryOtpStore(): OtpStore {
  const map = new Map<string, OtpRecord>()
  return {
    kind: 'memory',
    async set(phone, rec) {
      map.set(phone, rec)
    },
    async get(phone) {
      const rec = map.get(phone)
      if (!rec) return undefined
      if (Date.now() > rec.expiresAt) {
        map.delete(phone)
        return undefined
      }
      return rec
    },
    async del(phone) {
      map.delete(phone)
    },
  }
}

/** Encodes a Redis command array in RESP2 format. */
export function encodeResp(args: string[]): string {
  const parts = [`*${args.length}\r\n`]
  for (const a of args) {
    const buf = Buffer.byteLength(a, 'utf8')
    parts.push(`$${buf}\r\n${a}\r\n`)
  }
  return parts.join('')
}

function sendRedisCommand(redisUrl: string, args: string[]): Promise<string | null> {
  const u = new URL(redisUrl)
  const useTls = u.protocol === 'rediss:'
  const port = u.port ? Number(u.port) : 6379
  const host = u.hostname
  const password = u.password ? decodeURIComponent(u.password) : undefined

  return new Promise((resolve, reject) => {
    const socket = useTls
      ? tls.connect({ host, port, servername: host })
      : net.connect({ host, port })

    socket.setTimeout(3000)
    let buffer = ''

    const sendMain = () => {
      socket.write(encodeResp(args))
    }

    let authed = !password
    socket.on('connect', () => {
      if (password) {
        socket.write(encodeResp(['AUTH', password]))
      } else {
        sendMain()
      }
    })

    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8')
      if (!authed) {
        const idx = buffer.indexOf('\r\n')
        if (idx === -1) return
        const line = buffer.slice(0, idx)
        buffer = buffer.slice(idx + 2)
        if (line.startsWith('-')) {
          socket.destroy()
          return reject(new Error(`Redis AUTH failed: ${line.slice(1)}`))
        }
        authed = true
        sendMain()
        return
      }

      if (buffer.startsWith('+') || buffer.startsWith(':')) {
        const idx = buffer.indexOf('\r\n')
        if (idx !== -1) {
          socket.destroy()
          resolve(buffer.slice(1, idx))
        }
      } else if (buffer.startsWith('-')) {
        const idx = buffer.indexOf('\r\n')
        if (idx !== -1) {
          socket.destroy()
          reject(new Error(`Redis error: ${buffer.slice(1, idx)}`))
        }
      } else if (buffer.startsWith('$')) {
        const idx = buffer.indexOf('\r\n')
        if (idx === -1) return
        const len = Number(buffer.slice(1, idx))
        if (len === -1) {
          socket.destroy()
          return resolve(null)
        }
        const start = idx + 2
        if (buffer.length >= start + len + 2) {
          const val = buffer.slice(start, start + len)
          socket.destroy()
          resolve(val)
        }
      }
    })

    socket.on('timeout', () => {
      socket.destroy()
      reject(new Error('Redis command timed out'))
    })
    socket.on('error', (err) => {
      socket.destroy()
      reject(err)
    })
  })
}

export function redisOtpStore(redisUrl: string): OtpStore {
  const key = (phone: string) => `scribelink:otp:${phone}`
  return {
    kind: 'redis',
    async set(phone, rec, ttlSeconds) {
      await sendRedisCommand(redisUrl, ['SET', key(phone), JSON.stringify(rec), 'EX', String(Math.max(1, ttlSeconds))])
    },
    async get(phone) {
      const raw = await sendRedisCommand(redisUrl, ['GET', key(phone)])
      if (!raw) return undefined
      try {
        return JSON.parse(raw) as OtpRecord
      } catch {
        return undefined
      }
    },
    async del(phone) {
      await sendRedisCommand(redisUrl, ['DEL', key(phone)])
    },
  }
}

export function createOtpStore(env = process.env): OtpStore {
  return env.REDIS_URL ? redisOtpStore(env.REDIS_URL) : memoryOtpStore()
}
