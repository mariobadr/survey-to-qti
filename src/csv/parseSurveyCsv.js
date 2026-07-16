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
 * model) from one complete, structurally-valid, already-deduped CSV row.
 *
 * @param {Record<string, string>} metadata - Metadata, as returned by extractRow.
 * @param {Record<string, string>} answers - Answers, as returned by extractRow.
 * @returns {object} A Question object: `{ id, submission, question, review }`.
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

  return {
    // One graded survey submission per student is expected, so the SIS
    // login ID (stable, present on every row) makes a fine, debuggable ID
    // once duplicate attempts have been collapsed to one row per student.
    id: metadata.sisLoginId,
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
      bloomLevel: normalizeBloomLevel(answers.bloomLevelRaw),
      keywords,
      stem: answers.stem,
      responses,
      feedback,
      correctAnswer: normalizeCorrectAnswer(answers.correctAnswerRaw),
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
 * Collect non-blocking warnings for one complete row: unrecognized Bloom
 * level or correct-answer text, an unexpected keyword count, and any
 * over-word-limit stem/response/feedback fields.
 *
 * @param {number} rowNumber - 1-based data-row number, for reporting.
 * @param {Record<string, string>} metadata - Metadata, as returned by extractRow.
 * @param {Record<string, string>} answers - Answers, as returned by extractRow.
 * @param {string[]} keywords - Parsed keywords, as returned by parseKeywords.
 * @returns {object[]} Warning objects, each with at least a `type` field.
 */
function collectWarnings(rowNumber, metadata, answers, keywords) {
  const warnings = [];

  if (normalizeBloomLevel(answers.bloomLevelRaw) === null) {
    warnings.push({
      type: "unexpectedBloomLevel",
      rowNumber,
      sisLoginId: metadata.sisLoginId,
      value: answers.bloomLevelRaw,
    });
  }

  if (normalizeCorrectAnswer(answers.correctAnswerRaw) === null) {
    warnings.push({
      type: "unexpectedCorrectAnswer",
      rowNumber,
      sisLoginId: metadata.sisLoginId,
      value: answers.correctAnswerRaw,
    });
  }

  if (!isKeywordCountExpected(keywords)) {
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
 * @param {string} csvText - Raw CSV file contents, header row included.
 * @returns {{ questions: object[], summary: object }} `questions` are the
 *   valid, deduped Question objects; `summary` reports total rows parsed,
 *   the valid question count, structurally invalid rows, incomplete rows,
 *   and non-blocking warnings (see PROJECT_SPEC.md Section 4/5).
 */
export function parseSurveyCsv(csvText) {
  const parsed = Papa.parse(csvText, { skipEmptyLines: true });
  const [, ...dataRows] = parsed.data; // first row is the header, discard it

  const structurallyInvalidRows = [];
  const incompleteRows = [];
  const warnings = [];
  const candidates = []; // complete rows, keyed for dedup below

  dataRows.forEach((row, i) => {
    const rowNumber = i + 1;

    if (row.length !== EXPECTED_COLUMN_COUNT) {
      structurallyInvalidRows.push({
        rowNumber,
        columnCount: row.length,
        expectedColumnCount: EXPECTED_COLUMN_COUNT,
      });
      return;
    }

    const { metadata, answers } = extractRow(row);
    const missingFields = missingAnswerFields(answers);
    if (missingFields.length > 0) {
      incompleteRows.push({
        rowNumber,
        sisLoginId: metadata.sisLoginId,
        name: metadata.name,
        missingFields,
      });
      return;
    }

    const keywords = parseKeywords(answers.keywordsRaw);
    warnings.push(...collectWarnings(rowNumber, metadata, answers, keywords));
    candidates.push({ rowNumber, metadata, answers });
  });

  const byStudent = new Map();
  for (const candidate of candidates) {
    const key = candidate.metadata.sisLoginId;
    const existing = byStudent.get(key);
    if (!existing) {
      byStudent.set(key, candidate);
      continue;
    }
    const existingAttempt = Number.parseInt(existing.metadata.attempt, 10);
    const candidateAttempt = Number.parseInt(candidate.metadata.attempt, 10);
    const [kept, dropped] =
      candidateAttempt < existingAttempt
        ? [candidate, existing]
        : [existing, candidate];
    byStudent.set(key, kept);
    warnings.push({
      type: "duplicateAttemptDropped",
      sisLoginId: key,
      name: dropped.metadata.name,
      keptAttempt: Number.parseInt(kept.metadata.attempt, 10),
      droppedAttempt: Number.parseInt(dropped.metadata.attempt, 10),
      droppedRowNumber: dropped.rowNumber,
    });
  }

  const questions = [...byStudent.values()].map(({ metadata, answers }) =>
    buildQuestion(metadata, answers),
  );

  return {
    questions,
    summary: {
      totalRowsParsed: dataRows.length,
      validQuestionCount: questions.length,
      structurallyInvalidRows,
      incompleteRows,
      warnings,
    },
  };
}
