import Papa from "papaparse";
import {
  EXPECTED_COLUMN_COUNT,
  METADATA_FIELDS,
  QUESTION_ANSWER_FIELDS,
  questionAnswerColumnIndex,
} from "./columnLayout.js";
import {
  isKeywordCountExpected,
  normalizeBloomLevel,
  normalizeCorrectAnswer,
  parseKeywords,
  WORD_LIMITS,
  wordCount,
} from "./fieldNormalization.js";

const RESPONSE_LETTERS = ["A", "B", "C", "D"];

/**
 * Split a raw CSV data row into its metadata fields and question-answer
 * fields, using the positional layout from columnLayout.js.
 *
 * @param {string[]} row - One data row from PapaParse's parsed output.
 * @returns {{ metadata: Record<string, string>, answers: Record<string, string> }}
 *   Trimmed metadata (keyed by METADATA_FIELDS) and answers (keyed by
 *   QUESTION_ANSWER_FIELDS).
 */
function extractRow(row) {
  const metadata = {};
  METADATA_FIELDS.forEach((field, i) => {
    metadata[field] = (row[i] ?? "").trim();
  });

  const answers = {};
  QUESTION_ANSWER_FIELDS.forEach((field, i) => {
    answers[field] = (row[questionAnswerColumnIndex(i)] ?? "").trim();
  });

  return { metadata, answers };
}

/**
 * Find which of the 12 required question-answer fields are empty.
 *
 * @param {Record<string, string>} answers - Answers, as returned by extractRow.
 * @returns {string[]} Names (from QUESTION_ANSWER_FIELDS) of empty fields;
 *   an empty array means the row is complete.
 */
function missingAnswerFields(answers) {
  return QUESTION_ANSWER_FIELDS.filter((field) => answers[field].length === 0);
}

/**
 * Build a review-ready Question object (PROJECT_SPEC.md Section 4's data
 * model) from one structurally-valid, non-empty CSV row (one attempt).
 *
 * @param {Record<string, string>} metadata - Metadata, as returned by extractRow.
 * @param {Record<string, string>} answers - Answers, as returned by extractRow.
 * @returns {object} A Question object: `{ id, submission, question, original, review }`.
 */
function buildQuestion(metadata, answers) {
  const keywords = parseKeywords(answers.keywordsRaw);
  const responses = {
    A: answers.responseA,
    B: answers.responseB,
    C: answers.responseC,
    D: answers.responseD,
  };
  const feedback = {
    A: answers.feedbackA,
    B: answers.feedbackB,
    C: answers.feedbackC,
    D: answers.feedbackD,
  };
  const bloomLevel = normalizeBloomLevel(answers.bloomLevelRaw);
  const correctAnswer = normalizeCorrectAnswer(answers.correctAnswerRaw);

  return {
    // A student can have more than one attempt (Planned rework item 6), so
    // sisLoginId alone isn't unique -- composite with the attempt number.
    // Still stable and debuggable, and every consumer that needs "all
    // attempts for this student" groups by submission.student.sisLoginId
    // directly (see src/attempts.js) rather than parsing this id back apart.
    id: `${metadata.sisLoginId}:${metadata.attempt}`,
    submission: {
      student: {
        name: metadata.name,
        sisLoginId: metadata.sisLoginId,
        canvasId: metadata.canvasId,
      },
      section: {
        name: metadata.section,
        sectionId: metadata.sectionId,
        sectionSisId: metadata.sectionSisId,
      },
      submittedAt: metadata.submittedAt,
      attempt: Number.parseInt(metadata.attempt, 10),
    },
    question: {
      bloomLevel,
      keywords,
      stem: answers.stem,
      responses,
      feedback,
      correctAnswer,
    },
    // Permanent, never-mutated snapshot of the content fields as first
    // parsed -- lets the review UI show the TA what was actually submitted
    // alongside whatever they've since edited (Section 5), and lets
    // wasEdited be a live diff against it rather than tracked separately.
    // Deep-copied (not just re-referenced) so later edits to `question`
    // can never reach this object.
    original: {
      bloomLevel,
      keywords: [...keywords],
      stem: answers.stem,
      responses: { ...responses },
      feedback: { ...feedback },
      correctAnswer,
    },
    review: {
      // grade is not present in the Canvas survey export; populated later
      // by the review UI. pointsPossible is not part of a Question's grade
      // at all -- it's a single value shared across every question (Section
      // 4, Planned rework item 4), held in App.svelte instead.
      grade: { points: null },
      status: "pending",
      wasEdited: false,
    },
  };
}

/**
 * Collect non-blocking warnings for one row: unrecognized Bloom level or
 * correct-answer text, an unexpected keyword count, and any over-word-limit
 * stem/response/feedback fields. Fields that are simply missing (empty)
 * are skipped here -- those are already reported once via a "missingFields"
 * warning (see parseSurveyCsv below), so an empty bloomLevelRaw doesn't
 * also produce a confusing "unrecognized Bloom taxonomy ''" warning.
 *
 * @param {number} rowNumber - 1-based data-row number, for reporting.
 * @param {Record<string, string>} metadata - Metadata, as returned by extractRow.
 * @param {Record<string, string>} answers - Answers, as returned by extractRow.
 * @param {string[]} keywords - Parsed keywords, as returned by parseKeywords.
 * @returns {object[]} Warning objects, each with at least a `type` field.
 */
function collectWarnings(rowNumber, metadata, answers, keywords) {
  const warnings = [];

  if (
    answers.bloomLevelRaw.length > 0 &&
    normalizeBloomLevel(answers.bloomLevelRaw) === null
  ) {
    warnings.push({
      type: "unexpectedBloomLevel",
      rowNumber,
      sisLoginId: metadata.sisLoginId,
      value: answers.bloomLevelRaw,
    });
  }

  if (
    answers.correctAnswerRaw.length > 0 &&
    normalizeCorrectAnswer(answers.correctAnswerRaw) === null
  ) {
    warnings.push({
      type: "unexpectedCorrectAnswer",
      rowNumber,
      sisLoginId: metadata.sisLoginId,
      value: answers.correctAnswerRaw,
    });
  }

  if (answers.keywordsRaw.length > 0 && !isKeywordCountExpected(keywords)) {
    warnings.push({
      type: "unexpectedKeywordCount",
      rowNumber,
      sisLoginId: metadata.sisLoginId,
      keywords,
    });
  }

  if (wordCount(answers.stem) > WORD_LIMITS.stem) {
    warnings.push({
      type: "wordCountExceeded",
      rowNumber,
      sisLoginId: metadata.sisLoginId,
      field: "stem",
      limit: WORD_LIMITS.stem,
      actual: wordCount(answers.stem),
    });
  }

  for (const letter of RESPONSE_LETTERS) {
    const responseText = answers[`response${letter}`];
    if (wordCount(responseText) > WORD_LIMITS.response) {
      warnings.push({
        type: "wordCountExceeded",
        rowNumber,
        sisLoginId: metadata.sisLoginId,
        field: `response${letter}`,
        limit: WORD_LIMITS.response,
        actual: wordCount(responseText),
      });
    }
    const feedbackText = answers[`feedback${letter}`];
    if (wordCount(feedbackText) > WORD_LIMITS.feedback) {
      warnings.push({
        type: "wordCountExceeded",
        rowNumber,
        sisLoginId: metadata.sisLoginId,
        field: `feedback${letter}`,
        limit: WORD_LIMITS.feedback,
        actual: wordCount(feedbackText),
      });
    }
  }

  return warnings;
}

/**
 * Parse a Canvas survey CSV export into review-ready Question objects.
 *
 * Columns are mapped positionally (see columnLayout.js) rather than by
 * header text, since Canvas's header text is inconsistent between exports.
 *
 * Only two things ever keep a row's content out of the TA's hands entirely:
 * a malformed column layout (there's no safe way to guess column meaning,
 * so nothing in the file is imported -- see below) and a row with literally
 * no answers at all (nothing to review). Anything short of that -- missing
 * one or more of the 12 answer fields, an unrecognized Bloom
 * level/correct-answer value, a bad keyword count, an over-word-limit field
 * -- is a warning the TA can act on during review (edit the field in, or
 * just grade accordingly), never a silent or forced exclusion.
 *
 * @param {string} csvText - Raw CSV file contents, header row included.
 * @returns {{ questions: object[], summary: object }} `questions` are the
 *   valid Question objects, one per attempt -- a student with multiple
 *   attempts gets multiple entries, not deduped (Planned rework item 6; see
 *   src/attempts.js for how the review UI groups them back by student).
 *   `summary` reports total rows parsed, the valid question count,
 *   structurally invalid rows, empty rows, and non-blocking warnings (see
 *   PROJECT_SPEC.md Section 4/5).
 */
export function parseSurveyCsv(csvText) {
  const parsed = Papa.parse(csvText, { skipEmptyLines: true });
  const [, ...dataRows] = parsed.data; // first row is the header, discard it

  const structurallyInvalidRows = dataRows.reduce((acc, row, i) => {
    if (row.length !== EXPECTED_COLUMN_COUNT) {
      acc.push({
        rowNumber: i + 1,
        columnCount: row.length,
        expectedColumnCount: EXPECTED_COLUMN_COUNT,
      });
    }
    return acc;
  }, []);

  // A malformed column layout means the file's shape doesn't match a
  // Canvas survey export at all (wrong file selected, or a corrupted
  // export) -- there's no safe way to guess column meaning anywhere in a
  // file like that, so nothing is imported, rather than trying to salvage
  // whichever rows happen to still have the right column count.
  if (structurallyInvalidRows.length > 0) {
    return {
      questions: [],
      summary: {
        totalRowsParsed: dataRows.length,
        validQuestionCount: 0,
        structurallyInvalidRows,
        emptyRows: [],
        warnings: [],
      },
    };
  }

  const emptyRows = [];
  const warnings = [];
  const questions = [];

  dataRows.forEach((row, i) => {
    const rowNumber = i + 1;
    const { metadata, answers } = extractRow(row);
    const missingFields = missingAnswerFields(answers);

    // Every one of the 12 answer fields is blank -- nothing was submitted
    // for this question at all, so there's nothing here to review, edit,
    // or grade. Excluded, but doesn't block continuing (unlike a
    // structurally invalid row above).
    if (missingFields.length === QUESTION_ANSWER_FIELDS.length) {
      emptyRows.push({
        rowNumber,
        sisLoginId: metadata.sisLoginId,
        name: metadata.name,
      });
      return;
    }

    if (missingFields.length > 0) {
      warnings.push({
        type: "missingFields",
        rowNumber,
        sisLoginId: metadata.sisLoginId,
        name: metadata.name,
        missingFields,
      });
    }

    const keywords = parseKeywords(answers.keywordsRaw);
    warnings.push(...collectWarnings(rowNumber, metadata, answers, keywords));
    // Every attempt becomes its own question -- no dedup (Planned rework
    // item 6). The Question Review view (Section 5) groups these back by
    // student and lets the TA pick which attempt is "the" one for that
    // student (src/attempts.js), rather than deciding that here at parse
    // time.
    questions.push(buildQuestion(metadata, answers));
  });

  return {
    questions,
    summary: {
      totalRowsParsed: dataRows.length,
      validQuestionCount: questions.length,
      structurallyInvalidRows,
      emptyRows,
      warnings,
    },
  };
}
