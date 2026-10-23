/**
 * shared/random.ts
 * Secure random values and a constant-time compare that work in Node and in the browser.
 * Some UI pages still run backend modules in the browser (mock mode), so anything those
 * modules import must not depend on Node-only APIs such as node:crypto.
 */

/** Uniform integer in [0, maxExclusive), without modulo bias. */
export function randomInt(maxExclusive: number): number {
  const limit = Math.floor(0x1_0000_0000 / maxExclusive) * maxExclusive
  const buf = new Uint32Array(1)
  do globalThis.crypto.getRandomValues(buf)
  while (buf[0] >= limit)
  return buf[0] % maxExclusive
}

export const randomDigits = (n: number): string => Array.from({ length: n }, () => randomInt(10)).join('')

/** Uppercase hex string of `bytes` random bytes. */
export function randomToken(bytes = 4): string {
  const buf = new Uint8Array(bytes)
  globalThis.crypto.getRandomValues(buf)
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('').toUpperCase()
}

/** Compares two strings without stopping at the first difference. */
export function constantTimeEqual(a: string, b: string): boolean {
  let diff = a.length ^ b.length
  const n = Math.max(a.length, b.length)
  for (let i = 0; i < n; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0)
  return diff === 0
}
