/**
 * coverPage.ts
 * Heuristic cover/credential-page detector.
 *
 * A page is suspected to be a cover or credential page if the first ~300 words
 * contain several of the following signals:
 *   - Keywords like "roll no", "enrollment", "university", "college", "subject",
 *     "department", "submitted by", "submitted to", "academic year", "semester"
 *   - Very low word-count with mostly title-cased short phrases
 *
 * Returns a score 0–1. Threshold ≥ 0.5 triggers a warning.
 */

const COVER_KEYWORDS = [
  'roll no', 'roll number', 'enrollment', 'enrolment', 'registration no',
  'university', 'college', 'institute', 'department', 'faculty',
  'subject', 'course', 'submitted by', 'submitted to', 'prepared by',
  'academic year', 'semester', 'session', 'exam', 'examination',
  'certificate', 'acknowledgement', 'declaration', 'index', 'contents',
  'title page', 'cover page',
]

export interface CoverPageResult {
  score: number        // 0–1 confidence
  warning: boolean     // true if score ≥ 0.5
  matchedKeywords: string[]
}

/**
 * Analyse the first ~300 words of extracted text.
 * Works on plain text; call with text from the first page.
 */
export function detectCoverPage(text: string): CoverPageResult {
  const lower = text.toLowerCase()
  const sample = lower.split(/\s+/).slice(0, 300).join(' ')

  const matched: string[] = []
  for (const kw of COVER_KEYWORDS) {
    if (sample.includes(kw)) matched.push(kw)
  }

  // Normalise: each keyword hit adds ~0.1, cap at 1
  const score = Math.min(matched.length * 0.1, 1)
  return { score, warning: score >= 0.5, matchedKeywords: matched }
}
