import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { constantTimeEqual, randomDigits, randomInt, randomToken } from './random'

describe('random helpers', () => {
  test('randomDigits has the right length and only digits', () => {
    for (let i = 0; i < 200; i++) assert.match(randomDigits(6), /^\d{6}$/)
  })

  test('randomInt stays in range and covers it', () => {
    const seen = new Set<number>()
    for (let i = 0; i < 2000; i++) {
      const n = randomInt(10)
      assert.ok(n >= 0 && n < 10)
      seen.add(n)
    }
    assert.equal(seen.size, 10)
  })

  test('randomToken is uppercase hex and does not repeat', () => {
    const tokens = new Set(Array.from({ length: 500 }, () => randomToken(4)))
    assert.equal(tokens.size, 500)
    for (const t of tokens) assert.match(t, /^[0-9A-F]{8}$/)
  })

  test('constantTimeEqual', () => {
    assert.equal(constantTimeEqual('482910', '482910'), true)
    assert.equal(constantTimeEqual('482910', '482911'), false)
    assert.equal(constantTimeEqual('4829', '482910'), false)
    assert.equal(constantTimeEqual('', ''), true)
  })
})
