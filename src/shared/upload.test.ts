import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { sniffType, validateUpload } from './upload'

const bytes = (...n: number[]) => new Uint8Array(n)
const ascii = (s: string) => new TextEncoder().encode(s)
const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0)
const JPEG = bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0x10)
const PDF = ascii('%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n%%EOF')
const file = (name: string, b: Uint8Array) => ({ name, size: b.length })

describe('file sniffing', () => {
  test('recognises real signatures', () => {
    assert.equal(sniffType(PNG), 'png')
    assert.equal(sniffType(JPEG), 'jpeg')
    assert.equal(sniffType(PDF), 'pdf')
    assert.equal(sniffType(ascii('....ftypisom')), 'mp4')
    assert.equal(sniffType(ascii('RIFF....WEBPVP8 ')), 'webp')
    assert.equal(sniffType(ascii('hello')), null)
  })
})

describe('validateUpload', () => {
  test('accepts genuine files', () => {
    assert.deepEqual(validateUpload(file('a.png', PNG), PNG, 'image'), { ok: true, type: 'png' })
    assert.deepEqual(validateUpload(file('notes.pdf', PDF), PDF, 'document'), { ok: true, type: 'pdf' })
    const t = ascii('Plain notes.\nSecond line.')
    assert.deepEqual(validateUpload(file('notes.txt', t), t, 'document'), { ok: true, type: 'text' })
  })

  test('rejects a file whose contents do not match its extension', () => {
    const r = validateUpload(file('photo.png', PDF), PDF, 'image')
    assert.equal(r.ok, false)
  })

  test('rejects an executable renamed to .png', () => {
    const exe = ascii('MZ\x90\x00\x03\x00\x00\x00')
    assert.equal(validateUpload(file('sample.png', exe), exe, 'image').ok, false)
  })

  test('rejects extensions outside the allowed list', () => {
    assert.equal(validateUpload(file('run.exe', PNG), PNG, 'image').ok, false)
    assert.equal(validateUpload(file('page.html', ascii('<html>')), ascii('<html>'), 'document').ok, false)
    assert.equal(validateUpload(file('doc.pdf', PDF), PDF, 'image').ok, false) // wrong kind
  })

  test('rejects empty and oversized files', () => {
    assert.equal(validateUpload({ name: 'a.png', size: 0 }, new Uint8Array(), 'image').ok, false)
    assert.equal(validateUpload({ name: 'a.png', size: 9 * 1024 * 1024 }, PNG, 'image').ok, false)
  })

  test('rejects PDFs that carry scripts or embedded files', () => {
    for (const bad of ['/JavaScript (app.alert(1))', '/JS (x)', '/Launch /Win', '/OpenAction 5 0 R', '/EmbeddedFile']) {
      const pdf = ascii(`%PDF-1.4\n1 0 obj << ${bad} >> endobj`)
      assert.equal(validateUpload(file('x.pdf', pdf), pdf, 'document').ok, false, bad)
    }
  })

  test('does not flag ordinary PDF names that merely start with the same letters', () => {
    const pdf = ascii('%PDF-1.4\n1 0 obj << /JSONData /Jsfoo >> endobj')
    assert.equal(validateUpload(file('x.pdf', pdf), pdf, 'document').ok, true)
  })

  test('text files must really be text', () => {
    const bin = bytes(0x41, 0x00, 0x42, 0x01)
    assert.equal(validateUpload(file('n.txt', bin), bin, 'document').ok, false)
  })
})
