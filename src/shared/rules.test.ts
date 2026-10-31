import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { billablePages, calculateQuote, checkCoverPage, meetsMinimum, countWords, sanitizeText, turnaroundHours } from './rules'

const base = { simpleDrawings: 0, complexDrawings: 0, graphs: 0, customTemplate: false }

describe('pricing', () => {
  test('pages round up to the next 200 words', () => {
    assert.equal(billablePages(0), 0)
    assert.equal(billablePages(1), 1)
    assert.equal(billablePages(200), 1)
    assert.equal(billablePages(201), 2)
  })

  test('bad word counts bill zero pages', () => {
    assert.equal(billablePages(-5), 0)
    assert.equal(billablePages(NaN), 0)
    assert.equal(billablePages(Infinity), 0)
  })

  test('15 pages take 18 hours', () => {
    assert.equal(turnaroundHours(15), 18)
    assert.equal(turnaroundHours(30), 36)
  })

  test('₹30 per page, scribe gets ₹20, platform keeps ₹10', () => {
    const q = calculateQuote({ ...base, words: 1000 })
    assert.equal(q.customerTotal, 150)
    assert.equal(q.scribeTotal, 100)
    assert.equal(q.platformTotal, 50)
  })

  test('20+ pages add the rigid packaging fee, 19 pages do not', () => {
    assert.equal(calculateQuote({ ...base, words: 3800 }).customerTotal, 19 * 30)
    assert.equal(calculateQuote({ ...base, words: 4000 }).customerTotal, 20 * 30 + 10)
  })

  test('add-ons are billed and paid out at their own rates', () => {
    const q = calculateQuote({ words: 4000, simpleDrawings: 1, complexDrawings: 1, graphs: 1, customTemplate: false })
    assert.equal(q.customerTotal, 600 + 4 + 8 + 10 + 10)
    assert.equal(q.scribeTotal, 400 + 2.5 + 5.5 + 7 + 7)
  })

  test('the platform margin never goes negative', () => {
    for (const words of [1, 199, 200, 201, 1000, 4000, 12345]) {
      const q = calculateQuote({ words, simpleDrawings: 2, complexDrawings: 2, graphs: 2, customTemplate: true })
      assert.ok(q.platformTotal >= 0, `negative margin at ${words} words`)
      assert.equal(Math.round((q.customerTotal - q.scribeTotal) * 100) / 100, q.platformTotal)
    }
  })

  test('nothing is billed for an empty order', () => {
    const q = calculateQuote({ ...base, words: 0, graphs: 3 })
    assert.equal(q.customerTotal, 0)
    assert.equal(q.items.length, 0)
  })
})

describe('text checks', () => {
  test('sanitizeText strips control characters and tidies whitespace', () => {
    assert.equal(sanitizeText('﻿Hello\u0000   world\r\nline'), 'Hello world\nline')
  })

  test('countWords', () => {
    assert.equal(countWords('  one two\nthree  '), 3)
    assert.equal(countWords(''), 0)
  })

  test('cover-page details trigger a warning', () => {
    const r = checkCoverPage('Roll No: 19/EC/201 Department of Electrical Engineering University Exam')
    assert.equal(r.warning, true)
    assert.ok(r.matches.includes('roll no'))
  })

  test('ordinary study text does not', () => {
    assert.equal(checkCoverPage('Newton described how a net force changes the motion of a body.').warning, false)
  })
})

describe('minimum order', () => {
  test('is 10 pages', () => {
  assert.equal(meetsMinimum(1800), false)
  assert.equal(meetsMinimum(1801), true)
  assert.equal(meetsMinimum(0), false)
  })
})
