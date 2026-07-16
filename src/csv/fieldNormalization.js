export const BLOOM_LEVELS = [
  "Remember",
  "Understand",
  "Apply",
  "Analyze",
  "Evaluate",
  "Create",
];

/**
 * Normalize a raw Bloom-level survey answer to one of BLOOM_LEVELS.
 *
 * Confirmed: this survey's question 1 is multiple-choice with exact option
 * text matching BLOOM_LEVELS.
 *
 * @param {string | null | undefined} raw - Raw cell value from the CSV.
 * @returns {string | null} The matched Bloom level, or null if the
 *   (trimmed) text doesn't exactly match one of BLOOM_LEVELS.
 */
export function normalizeBloomLevel(raw) {
  const trimmed = (raw ?? "").trim();
  return BLOOM_LEVELS.includes(trimmed) ? trimmed : null;
}

const CORRECT_ANSWER_LETTERS = ["A", "B", "C", "D"];

/**
 * Normalize a raw correct-answer survey answer to one of "A"/"B"/"C"/"D".
 *
 * TODO(real-data): re-verify against the first real survey export and
 * adjust this mapping if the option text differs.
 *
 * @param {string | null | undefined} raw - Raw cell value from the CSV.
 * @returns {"A" | "B" | "C" | "D" | null} The matched letter, or null if
 *   the (trimmed) text isn't exactly one of "A"/"B"/"C"/"D".
 */
export function normalizeCorrectAnswer(raw) {
  const trimmed = (raw ?? "").trim();
  return CORRECT_ANSWER_LETTERS.includes(trimmed) ? trimmed : null;
}

const MIN_KEYWORDS = 2;
const MAX_KEYWORDS = 4;

/**
 * Split a raw comma-separated keywords cell into individual keywords.
 *
 * Keyword field is free text ("Separate the keywords using a comma"), so
 * it's not trusted to be well-formed. Split/trim/drop-empty always; whether
 * the resulting count is in the expected 2-4 range is reported separately
 * by the caller as a warning, not enforced here.
 *
 * @param {string | null | undefined} raw - Raw cell value from the CSV.
 * @returns {string[]} Trimmed, non-empty keywords, in their original order.
 */
export function parseKeywords(raw) {
  return (raw ?? "")
    .split(",")
    .map((keyword) => keyword.trim())
    .filter((keyword) => keyword.length > 0);
}

/**
 * Check whether a keyword list falls within the survey's stated 2-4 count.
 *
 * @param {string[]} keywords - Keywords, as returned by parseKeywords.
 * @returns {boolean} True if keywords.length is between MIN_KEYWORDS and
 *   MAX_KEYWORDS inclusive.
 */
export function isKeywordCountExpected(keywords) {
  return keywords.length >= MIN_KEYWORDS && keywords.length <= MAX_KEYWORDS;
}

/**
 * Count whitespace-separated words in a text field.
 *
 * @param {string | null | undefined} text - Text to count words in.
 * @returns {number} The word count, or 0 for blank/whitespace-only text.
 */
export function wordCount(text) {
  const trimmed = (text ?? "").trim();
  return trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length;
}

export const WORD_LIMITS = {
  stem: 50,
  response: 10,
  feedback: 50,
};
