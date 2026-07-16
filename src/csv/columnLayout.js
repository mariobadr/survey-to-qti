// Canvas's survey CSV export headers are not reliable to match against:
// question IDs embedded in the header text have gaps, and quoting/whitespace
// around them is inconsistent (some wrap onto a second line inside the
// quotes, some don't). So columns are identified by position, not by
// matching header strings. See fixtures/fabricated-survey-export.csv for a
// worked example of the exact layout this assumes.

// First 8 columns, always in this order.
export const METADATA_FIELDS = [
  "name",
  "canvasId",
  "sisLoginId",
  "section",
  "sectionId",
  "sectionSisId",
  "submittedAt",
  "attempt",
];

// After the metadata columns, Canvas emits one block per survey question:
// [answerText, boilerplateScoreColumn]. The boilerplate column (always "1.0"
// in every row we've seen, including the header) is Canvas's per-question
// points-possible echo and carries no information we need — skipped.
export const QUESTION_ANSWER_FIELDS = [
  "bloomLevelRaw",
  "keywordsRaw",
  "stem",
  "responseA",
  "feedbackA",
  "responseB",
  "feedbackB",
  "responseC",
  "feedbackC",
  "responseD",
  "feedbackD",
  "correctAnswerRaw",
];

const QUESTION_BLOCK_WIDTH = 2; // [answerText, boilerplate]

// 3 trailing columns after the question blocks: n correct, n incorrect, score.
export const TRAILING_FIELD_COUNT = 3;

export const EXPECTED_COLUMN_COUNT =
  METADATA_FIELDS.length +
  QUESTION_ANSWER_FIELDS.length * QUESTION_BLOCK_WIDTH +
  TRAILING_FIELD_COUNT;

/**
 * Convert a zero-based index into QUESTION_ANSWER_FIELDS to the
 * corresponding column index in a raw CSV data row, skipping over the
 * metadata columns and each preceding question block's boilerplate column.
 *
 * @param {number} fieldIndex - Index into QUESTION_ANSWER_FIELDS.
 * @returns {number} The matching column index in a raw CSV row.
 */
export function questionAnswerColumnIndex(fieldIndex) {
  return METADATA_FIELDS.length + fieldIndex * QUESTION_BLOCK_WIDTH;
}
