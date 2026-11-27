/**
 * backend/s3Store.ts
 * Phase 19: S3 / Cloudflare R2 object storage adapter with AWS SigV4
 * signed upload/download URLs (zero external SDK dependencies).
 */

import crypto from 'node:crypto'
import type { FileStore } from './files'

export interface S3Config {
  endpoint: string        // e.g. https://<account>.r2.cloudflarestorage.com or https://s3.ap-south-1.amazonaws.com
  bucket: string
  region: string          // 'auto' for R2, 'ap-south-1' for Mumbai S3
  accessKeyId: string
  secretAccessKey: string
}

export function s3ConfigFromEnv(env = process.env): S3Config | undefined {
  const { S3_ENDPOINT: endpoint, S3_BUCKET: bucket, S3_REGION: region, S3_ACCESS_KEY_ID: accessKeyId, S3_SECRET_ACCESS_KEY: secretAccessKey } = env
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) return undefined
  return { endpoint: endpoint.replace(/\/$/, ''), bucket, region: region || 'auto', accessKeyId, secretAccessKey }
}

const sha256Hex = (data: string | Buffer) => crypto.createHash('sha256').update(data).digest('hex')
const hmac = (key: string | Buffer, data: string) => crypto.createHmac('sha256', key).update(data).digest()

function signingKey(secret: string, dateStamp: string, region: string, service = 's3'): Buffer {
  const kDate = hmac(`AWS4${secret}`, dateStamp)
  const kRegion = hmac(kDate, region)
  const kService = hmac(kRegion, service)
  return hmac(kService, 'aws4_request')
}

function amzDates(now = new Date()) {
  const iso = now.toISOString().replace(/[:-]|\.\d{3}/g, '')
  return { amzDate: iso, dateStamp: iso.slice(0, 8) }
}

/** Generates a pre-signed GET URL for private object download (expires in `expiresSeconds`). */
export function presignS3GetUrl(cfg: S3Config, objectKey: string, expiresSeconds = 300, now = new Date()): string {
  const { amzDate, dateStamp } = amzDates(now)
  const base = new URL(`${cfg.endpoint}/${cfg.bucket}/${objectKey}`)
  const credentialScope = `${dateStamp}/${cfg.region}/s3/aws4_request`

  const params = new URLSearchParams({
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${cfg.accessKeyId}/${credentialScope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(expiresSeconds),
    'X-Amz-SignedHeaders': 'host',
  })
  params.sort()

  const canonicalRequest = [
    'GET',
    base.pathname,
    params.toString(),
    `host:${base.host}\n`,
    'host',
    'UNSIGNED-PAYLOAD',
  ].join('\n')

  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n')

  const sig = hmac(signingKey(cfg.secretAccessKey, dateStamp, cfg.region), stringToSign).toString('hex')
  params.set('X-Amz-Signature', sig)
  return `${base.origin}${base.pathname}?${params.toString()}`
}

export type S3Fetcher = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: Uint8Array },
) => Promise<{ ok: boolean; status: number }>

let s3Fetcher: S3Fetcher = (url, init) => fetch(url, init as RequestInit)
export const setS3Fetcher = (f: S3Fetcher) => { s3Fetcher = f }

async function signedRequest(cfg: S3Config, method: 'PUT' | 'DELETE', objectKey: string, body?: Buffer): Promise<void> {
  const { amzDate, dateStamp } = amzDates()
  const url = new URL(`${cfg.endpoint}/${cfg.bucket}/${objectKey}`)
  const payloadHash = sha256Hex(body ?? '')
  const credentialScope = `${dateStamp}/${cfg.region}/s3/aws4_request`

  const canonicalHeaders = `host:${url.host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date'
  const canonicalRequest = [method, url.pathname, '', canonicalHeaders, signedHeaders, payloadHash].join('\n')
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credentialScope, sha256Hex(canonicalRequest)].join('\n')
  const sig = hmac(signingKey(cfg.secretAccessKey, dateStamp, cfg.region), stringToSign).toString('hex')

  const res = await s3Fetcher(url.toString(), {
    method,
    headers: {
      'x-amz-date': amzDate,
      'x-amz-content-sha256': payloadHash,
      Authorization: `AWS4-HMAC-SHA256 Credential=${cfg.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${sig}`,
    },
    ...(body ? { body: new Uint8Array(body) } : {}),
  })
  if (!res.ok) throw new Error(`S3 ${method} ${objectKey} failed (${res.status})`)
}

export function s3FileStore(cfg: S3Config): FileStore & { signedUrl(id: string, type: string, ttlSeconds?: number): string } {
  return {
    async put(id, type, bytes) {
      await signedRequest(cfg, 'PUT', `${id}.${type}`, bytes)
    },
    find() {
      // S3 objects are served via presignS3GetUrl rather than local disk paths.
      return undefined
    },
    async remove(id, type) {
      await signedRequest(cfg, 'DELETE', `${id}.${type}`)
    },
    signedUrl(id, type, ttlSeconds = 300) {
      return presignS3GetUrl(cfg, `${id}.${type}`, ttlSeconds)
    },
  }
}
