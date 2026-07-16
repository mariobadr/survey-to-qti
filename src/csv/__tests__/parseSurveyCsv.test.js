import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { EXPECTED_COLUMN_COUNT, METADATA_FIELDS } from "../columnLayout.js";
import { parseSurveyCsv } from "../parseSurveyCsv.js";

// Fabricated fixture (see tools/generate_fixture_csv.py) -- not real Canvas
// data. Regenerate with: python3 tools/generate_fixture_csv.py > fixtures/fabricated-survey-export.csv
const FIXTURE_PATH = fileURLToPath(
  new URL("../../../fixtures/fabricated-survey-export.csv", import.meta.url),
);
const fixtureCsv = readFileSync(FIXTURE_PATH, "utf-8");

function findQuestion(questions, sisLoginId) {
  const question = questions.find(
    (q) => q.submission.student.sisLoginId === sisLoginId,
  );
  if (!question)
    throw new Error(`no question found for sisLoginId ${sisLoginId}`);
  return question;
}

describe("parseSurveyCsv against the fabricated fixture", () => {
  const result = parseSurveyCsv(fixtureCsv);

  it("parses all 7 fabricated data rows", () => {
    expect(result.summary.totalRowsParsed).toBe(7);
  });

  it("finds no structurally invalid rows", () => {
    expect(result.summary.structurallyInvalidRows).toEqual([]);
  });

  it("flags the incomplete row (Erin Evans, blank feedback D) and excludes it from questions", () => {
    expect(result.summary.incompleteRows).toHaveLength(1);
    expect(result.summary.incompleteRows[0]).toMatchObject({
      sisLoginId: "fab00005",
      name: "Erin Evans",
      missingFields: ["feedbackD"],
    });
    expect(
      result.questions.some(
        (q) => q.submission.student.sisLoginId === "fab00005",
      ),
    ).toBe(false);
  });

  it("collapses David Davis's duplicate attempts to the minimum attempt and logs the drop", () => {
    const davidRows = result.questions.filter(
      (q) => q.submission.student.sisLoginId === "fab00004",
    );
    expect(davidRows).toHaveLength(1);
    expect(davidRows[0].submission.attempt).toBe(1);
    expect(davidRows[0].question.stem).toBe(
      "What is the average-case time complexity of quicksort?",
    );

    const dropped = result.summary.warnings.find(
      (w) => w.type === "duplicateAttemptDropped",
    );
    expect(dropped).toMatchObject({
      sisLoginId: "fab00004",
      keptAttempt: 1,
      droppedAttempt: 2,
    });
  });

  it("flags Carol Chen's malformed (single) keyword as a warning, not a rejection", () => {
    const carol = findQuestion(result.questions, "fab00003");
    expect(carol.question.keywords).toEqual(["onlyonekeyword"]);

    const warning = result.summary.warnings.find(
      (w) => w.type === "unexpectedKeywordCount" && w.sisLoginId === "fab00003",
    );
    expect(warning).toBeDefined();
  });

  it("flags Frank Foster's over-limit stem as a word-count warning, not a rejection", () => {
    const frank = findQuestion(result.questions, "fab00006");
    expect(frank).toBeDefined();

    const warning = result.summary.warnings.find(
      (w) =>
        w.type === "wordCountExceeded" &&
        w.sisLoginId === "fab00006" &&
        w.field === "stem",
    );
    expect(warning).toBeDefined();
    expect(warning.actual).toBeGreaterThan(warning.limit);
  });

  it("produces exactly 5 valid questions after dropping the incomplete row and deduping attempts", () => {
    expect(result.questions).toHaveLength(5);
    expect(result.summary.validQuestionCount).toBe(5);
  });

  it("builds a well-formed Question object for a clean row", () => {
    const alice = findQuestion(result.questions, "fab00001");
    expect(alice).toMatchObject({
      id: "fab00001",
      submission: {
        student: {
          name: "Alice Anderson",
          sisLoginId: "fab00001",
          canvasId: "100001",
        },
        section: {
          name: "LEC0101",
          sectionId: "200001",
          sectionSisId: "CSC101-F-LEC0101-20269",
        },
        attempt: 1,
      },
      question: {
        bloomLevel: "Remember",
        keywords: ["recursion", "base case"],
        correctAnswer: "B",
      },
      original: {
        bloomLevel: "Remember",
        keywords: ["recursion", "base case"],
        correctAnswer: "B",
      },
      review: {
        status: "pending",
        wasEdited: false,
        grade: { points: null },
      },
    });
    expect(alice.question.responses.B).toBe("A case that stops the recursion");
    expect(alice.question.feedback.B).toBe("Correct.");
    expect(alice.original.responses.B).toBe("A case that stops the recursion");
    expect(alice.original.feedback.B).toBe("Correct.");
    expect(alice.original.stem).toBe(alice.question.stem);
    // `original` must be a deep copy, not the same object references as
    // `question` -- mutating one must never be able to reach the other.
    expect(alice.original.responses).not.toBe(alice.question.responses);
    expect(alice.original.feedback).not.toBe(alice.question.feedback);
    expect(alice.original.keywords).not.toBe(alice.question.keywords);
  });
});

describe("parseSurveyCsv structural validation", () => {
  it("flags a row with the wrong column count as structurally invalid, and excludes it entirely", () => {
    const header = Array.from(
      { length: EXPECTED_COLUMN_COUNT },
      (_, i) => `col${i}`,
    ).join(",");
    const truncatedRow = METADATA_FIELDS.map((f) => `bad-${f}`).join(","); // way too few columns
    const csv = `${header}\n${truncatedRow}\n`;

    const result = parseSurveyCsv(csv);

    expect(result.summary.structurallyInvalidRows).toHaveLength(1);
    expect(result.summary.structurallyInvalidRows[0]).toMatchObject({
      rowNumber: 1,
      columnCount: METADATA_FIELDS.length,
      expectedColumnCount: EXPECTED_COLUMN_COUNT,
    });
    expect(result.questions).toEqual([]);
    expect(result.summary.incompleteRows).toEqual([]);
  });
});
