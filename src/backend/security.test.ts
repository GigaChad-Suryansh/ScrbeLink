import './testSetup'
import { describe, test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { AttemptLimiter, safeEqual, scribeIdFor, signSession, verifySession } from './security'
import { ValidationError, int, mediaUrl, phone, rupees, upiId, idLike, oneOf } from './validate'

describe('session tokens', () => {
  test('round-trip', () => {
    const s = verifySession(signSession({ phone: '+919876543210', role: 'scribe' }))
    assert.equal(s?.phone, '+919876543210')
    assert.equal(s?.role, 'scribe')
  })

  test('a tampered payload is rejected', () => {
    const [, sig] = signSession({ phone: '+919876543210', role: 'customer' }).split('.')
    const forged = Buffer.from(JSON.stringify({ phone: '+919876543210', role: 'admin', exp: 9_999_999_999 })).toString('base64url')
    assert.equal(verifySession(`${forged}.${sig}`), null)
  })

  test('a token signed with another secret is rejected', () => {
    const t = signSession({ phone: '+919876543210', role: 'admin' })
    const saved = process.env.SESSION_SECRET
    process.env.SESSION_SECRET = 'a-completely-different-secret-value-0000'
    try {
      assert.equal(verifySession(t), null)
    } finally {
      process.env.SESSION_SECRET = saved
    }
  })

  test('expired tokens are rejected', () => {
    const t = signSession({ phone: '+919876543210', role: 'customer' }, 60, Date.now() - 120_000)
    assert.equal(verifySession(t), null)
  })

  test('junk is rejected without throwing', () => {
    for (const junk of [undefined, null, 42, '', 'abc', 'a.b.c', 'a.b', '.']) assert.equal(verifySession(junk), null)
  })
})

describe('production config', () => {
  const saved = { env: process.env.NODE_ENV, secret: process.env.SESSION_SECRET }
  afterEach(() => {
    process.env.NODE_ENV = saved.env
    process.env.SESSION_SECRET = saved.secret
  })

  test('production refuses to run without a strong SESSION_SECRET', () => {
    process.env.NODE_ENV = 'production'
    delete process.env.SESSION_SECRET
    assert.throws(() => signSession({ phone: '+919876543210', role: 'customer' }), /SESSION_SECRET/)
    process.env.SESSION_SECRET = 'short'
    assert.throws(() => signSession({ phone: '+919876543210', role: 'customer' }), /SESSION_SECRET/)
  })
})

describe('AttemptLimiter', () => {
  test('locks after the limit, expires, and clears on success', () => {
    let now = 1_000
    const l = new AttemptLimiter(3, 60_000, () => now)
    l.fail('a'); l.fail('a')
    assert.equal(l.lockedForMs('a'), 0)
    l.fail('a')
    assert.equal(l.lockedForMs('a'), 60_000)
    assert.equal(l.lockedForMs('b'), 0, 'other keys are unaffected')
    now += 61_000
    assert.equal(l.lockedForMs('a'), 0, 'lock expires')
    l.fail('a'); l.fail('a')
    assert.equal(l.lockedForMs('a'), 0, 'counter restarted after expiry')
    l.clear('a')
    l.fail('a')
    assert.equal(l.lockedForMs('a'), 0)
  })
})

describe('helpers', () => {
  test('safeEqual', () => {
    assert.equal(safeEqual('abc', 'abc'), true)
    assert.equal(safeEqual('abc', 'abd'), false)
    assert.equal(safeEqual('abc', 'abcd'), false)
  })

  test('scribe IDs are stable and do not contain the phone number', () => {
    const id = scribeIdFor('+919876543210')
    assert.equal(id, scribeIdFor('+919876543210'))
    assert.match(id, /^S-[0-9A-F]{6}$/)
    assert.notEqual(id, scribeIdFor('+919876543211'))
  })
})

describe('validators', () => {
  const bad = (fn: () => unknown) => assert.throws(fn, ValidationError)

  test('phone accepts Indian mobiles only', () => {
    assert.equal(phone('+919876543210'), '+919876543210')
    bad(() => phone('9876543210'))
    bad(() => phone('+911234567890'))
    bad(() => phone(9876543210))
  })

  test('int rejects strings, decimals and out-of-range values', () => {
    assert.equal(int(5, 'n', 0, 10), 5)
    bad(() => int('5', 'n', 0, 10))
    bad(() => int(1.5, 'n', 0, 10))
    bad(() => int(11, 'n', 0, 10))
    bad(() => int(NaN, 'n', 0, 10))
  })

  test('rupees rejects zero, negatives, huge values and extra decimals', () => {
    assert.equal(rupees(248), 248)
    assert.equal(rupees(99.5), 99.5)
    for (const v of [0, -1, 1e9, 10.123, NaN, '100', null]) bad(() => rupees(v))
  })

  test('ids and UPI ids keep markup and link characters out', () => {
    assert.equal(idLike('SL-1234', 'id'), 'SL-1234')
    bad(() => idLike('SL-1<script>', 'id'))
    bad(() => idLike('a/b', 'id'))
    assert.equal(upiId('name@okbank'), 'name@okbank')
    bad(() => upiId('name@@bank'))
    bad(() => upiId('no-at-sign'))
  })

  test('oneOf', () => {
    assert.equal(oneOf('a', 'x', ['a', 'b'] as const), 'a')
    bad(() => oneOf('c', 'x', ['a', 'b'] as const))
    bad(() => oneOf(undefined, 'x', ['a', 'b'] as const))
  })

  test('mediaUrl accepts public https links only', () => {
    assert.equal(mediaUrl('https://storage.scribelink.in/v/1.mp4', 'u'), 'https://storage.scribelink.in/v/1.mp4')
    for (const url of [
      'http://storage.scribelink.in/v.mp4',
      'https://localhost/v.mp4',
      'https://127.0.0.1/v.mp4',
      'https://[::1]/v.mp4',
      'https://169.254.169.254/latest',
      'https://user:pw@storage.scribelink.in/v.mp4',
      'https://printer.local/x',
      'https://intranet/x',
      'javascript:alert(1)',
      'data:text/html,<script>1</script>',
      'not a url',
    ]) bad(() => mediaUrl(url, 'u'))
  })

  test('MEDIA_HOSTS limits links to approved storage', () => {
    process.env.MEDIA_HOSTS = 'storage.scribelink.in'
    try {
      mediaUrl('https://storage.scribelink.in/a.mp4', 'u')
      mediaUrl('https://eu.storage.scribelink.in/a.mp4', 'u')
      bad(() => mediaUrl('https://evil.example.com/a.mp4', 'u'))
      bad(() => mediaUrl('https://notstorage.scribelink.in.evil.com/a.mp4', 'u'))
    } finally {
      delete process.env.MEDIA_HOSTS
    }
  })
})
