/**
 * phase19Reliability.test.ts
 * Phase 19: Tests for Redis/memory OTP store, S3/R2 SigV4 object storage,
 * and Sentry/structured logging telemetry.
 */

import './testSetup'
import { beforeEach, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { encodeResp, memoryOtpStore } from './redisStore'
import { presignS3GetUrl, s3FileStore, setS3Fetcher, type S3Config } from './s3Store'
import { parseSentryDsn, reportError, setTelemetryFetcher } from './telemetry'

describe('redisStore', () => {
  test('memoryOtpStore stores, reads, expires, and deletes OTPs', async () => {
    const store = memoryOtpStore()
    assert.equal(store.kind, 'memory')

    await store.set('+919800000001', { otp: '123456', expiresAt: Date.now() + 60_000 }, 60)
    const got = await store.get('+919800000001')
    assert.equal(got?.otp, '123456')

    await store.del('+919800000001')
    assert.equal(await store.get('+919800000001'), undefined)

    // Expired OTP returns undefined
    await store.set('+919800000002', { otp: '999999', expiresAt: Date.now() - 10 }, 1)
    assert.equal(await store.get('+919800000002'), undefined)
  })

  test('encodeResp formats RESP2 arrays', () => {
    assert.equal(encodeResp(['GET', 'abc']), '*2\r\n$3\r\nGET\r\n$3\r\nabc\r\n')
  })
})

describe('s3Store', () => {
  const cfg: S3Config = {
    endpoint: 'https://r2.example.com',
    bucket: 'scribelink-private',
    region: 'auto',
    accessKeyId: 'AKIAEXAMPLE',
    secretAccessKey: 'secret-example-key',
  }

  beforeEach(() => {
    setS3Fetcher(async () => ({ ok: true, status: 200 }))
  })

  test('presignS3GetUrl generates valid SigV4 query parameters', () => {
    const url = presignS3GetUrl(cfg, 'file123.pdf', 300, new Date('2026-11-27T00:00:00Z'))
    const u = new URL(url)
    assert.equal(u.pathname, '/scribelink-private/file123.pdf')
    assert.equal(u.searchParams.get('X-Amz-Algorithm'), 'AWS4-HMAC-SHA256')
    assert.equal(u.searchParams.get('X-Amz-Expires'), '300')
    assert.match(u.searchParams.get('X-Amz-Signature') ?? '', /^[a-f0-9]{64}$/)
  })

  test('s3FileStore put, remove, and signedUrl work against mocked S3 endpoint', async () => {
    const store = s3FileStore(cfg)
    await store.put('doc1', 'pdf', Buffer.from('%PDF-1.4'))
    await store.remove('doc1', 'pdf')
    assert.ok(store.signedUrl('doc1', 'pdf', 120).includes('X-Amz-Expires=120'))
  })
})

describe('telemetry', () => {
  test('parseSentryDsn extracts ingest endpoint and key', () => {
    const p = parseSentryDsn('https://abc123@o1.ingest.sentry.io/456789')
    assert.deepEqual(p, {
      endpoint: 'https://o1.ingest.sentry.io/api/456789/store/',
      publicKey: 'abc123',
    })
    assert.equal(parseSentryDsn('not-a-url'), undefined)
  })

  test('reportError posts to Sentry when DSN is configured', async () => {
    let postedUrl = ''
    setTelemetryFetcher(async (url) => {
      postedUrl = url
      return { ok: true, status: 200 }
    })
    const ok = await reportError(new Error('boom'), { route: '/test' }, 'https://pub@sentry.example.com/42')
    assert.equal(ok, true)
    assert.equal(postedUrl, 'https://sentry.example.com/api/42/store/')
  })
})
