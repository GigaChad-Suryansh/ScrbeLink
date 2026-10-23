/**
 * shared/upload.ts
 * Checks a file by its real content, not its name or browser-reported type.
 * Used by the upload screens now and meant to be reused by the API when real
 * storage is added. This is a first filter, not antivirus: see DEPLOYMENT.md.
 */

export type UploadKind = 'image' | 'document' | 'video'
export type DetectedType = 'png' | 'jpeg' | 'webp' | 'pdf' | 'mp4' | 'text'

const MB = 1024 * 1024

export const UPLOAD_RULES: Record<UploadKind, { maxBytes: number; types: DetectedType[]; label: string }> = {
  image: { maxBytes: 8 * MB, types: ['png', 'jpeg', 'webp'], label: 'PNG, JPEG or WebP image up to 8 MB' },
  document: { maxBytes: 20 * MB, types: ['pdf', 'png', 'jpeg', 'webp', 'text'], label: 'PDF, image or text file up to 20 MB' },
  video: { maxBytes: 100 * MB, types: ['mp4'], label: 'MP4 or MOV video up to 100 MB' },
}

const EXT_TO_TYPE: Record<string, DetectedType> = {
  png: 'png', jpg: 'jpeg', jpeg: 'jpeg', webp: 'webp', pdf: 'pdf', mp4: 'mp4', mov: 'mp4', txt: 'text', md: 'text',
}

export type UploadResult = { ok: true; type: DetectedType } | { ok: false; error: string }

const startsWith = (b: Uint8Array, at: number, s: string) =>
  b.length >= at + s.length && [...s].every((c, i) => b[at + i] === c.charCodeAt(0))

/** Identify a file from its first bytes. Returns null for anything unrecognised. */
export function sniffType(b: Uint8Array): DetectedType | null {
  if (b.length >= 8 && b[0] === 0x89 && startsWith(b, 1, 'PNG') && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return 'png'
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg'
  if (startsWith(b, 0, 'RIFF') && startsWith(b, 8, 'WEBP')) return 'webp'
  if (startsWith(b, 0, '%PDF-')) return 'pdf'
  if (startsWith(b, 4, 'ftyp')) return 'mp4'
  return null
}

/** Plain text: no NUL bytes and no control characters other than tab, newline and carriage return. */
export function looksLikeText(b: Uint8Array): boolean {
  const n = Math.min(b.length, 4096)
  for (let i = 0; i < n; i++) {
    const c = b[i]
    if (c === 0 || (c < 32 && c !== 9 && c !== 10 && c !== 13)) return false
  }
  return b.length > 0
}

/** PDF features that run code or open other files. A normal assignment PDF has none of them. */
const ACTIVE_PDF = /\/(JavaScript|JS|Launch|EmbeddedFile|OpenAction|RichMedia)(?![A-Za-z])/

export function pdfHasActiveContent(b: Uint8Array): boolean {
  let s = ''
  for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode(...b.subarray(i, i + 8192))
  return ACTIVE_PDF.test(s)
}

export function validateUpload(file: { name: string; size: number }, bytes: Uint8Array, kind: UploadKind): UploadResult {
  const rule = UPLOAD_RULES[kind]
  if (file.size <= 0 || bytes.length === 0) return { ok: false, error: 'The file is empty.' }
  if (file.size > rule.maxBytes) return { ok: false, error: `The file is too large. Allowed: ${rule.label}.` }

  const ext = file.name.toLowerCase().split('.').pop() ?? ''
  const claimed = EXT_TO_TYPE[ext]
  if (!claimed || !rule.types.includes(claimed)) return { ok: false, error: `Not an allowed file type. Allowed: ${rule.label}.` }

  const detected = claimed === 'text' ? (looksLikeText(bytes) ? 'text' : null) : sniffType(bytes)
  if (detected !== claimed) return { ok: false, error: 'The file contents do not match its extension.' }

  if (detected === 'pdf' && pdfHasActiveContent(bytes)) {
    return { ok: false, error: 'This PDF contains scripts or embedded files. Export a plain PDF and try again.' }
  }
  return { ok: true, type: detected }
}
