/**
 * sanitize.ts
 * Client-side text sanitisation helpers for uploaded documents.
 * - Strip non-printing characters
 * - Normalise whitespace
 * - Count words (rough: split on whitespace)
 */

/** Remove null bytes, BOM and other control chars; normalise whitespace. */
export function sanitizeText(raw: string): string {
  return raw
    .replace(/\uFEFF/g, '')          // BOM
    .replace(/[\x00-\x08\x0B\x0E-\x1F\x7F]/g, '') // control chars
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, ' ')
    .replace(/ {2,}/g, ' ')
    .trim()
}

/** Rough word count: split on whitespace, filter empty tokens. */
export function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length
}
