import Papa from "papaparse";
import { describe, expect, it } from "vitest";
import { buildGradebookCsv, buildGradebookRows } from "../buildGradebookCsv.js";

function makeQuestion({
  status = "accepted",
  points = 1,
  name = "Test Student",
  canvasId = "854974",
  sisLoginId = "abc123",
  sectionName = "badrmari-sandbox",
} = {}) {
  return {
    submission: {
      student: { name, canvasId, sisLoginId },
      section: { name: sectionName },
    },
    review: { status, grade: { points } },
  };
}

function parseRows(csv) {
  return Papa.parse(csv).data;
}

describe("buildGradebookCsv", () => {
  it("produces the exact expected format for a single graded student", () => {
    const csv = buildGradebookCsv([makeQuestion()], 1);

    expect(parseRows(csv)).toEqual([
      [
        "Student",
        "ID",
        "SIS User ID",
        "SIS Login ID",
        "Integration ID",
        "Section",
        "FIXME: copy-paste the cell from a Gradebook export",
      ],
      ["Points Possible", "", "", "", "", "", "1.00"],
      ["Test Student", "854974", "", "abc123", "", "badrmari-sandbox", "1.00"],
    ]);
  });

  it("quotes a student name containing a comma", () => {
    const csv = buildGradebookCsv([makeQuestion({ name: "Student, Test" })], 1);

    expect(csv).toContain('"Student, Test"');
    expect(parseRows(csv)[2][0]).toBe("Student, Test");
  });

  it("includes a row for every student regardless of review status", () => {
    const csv = buildGradebookCsv(
      [
        makeQuestion({ status: "accepted", sisLoginId: "s1" }),
        makeQuestion({ status: "rejected", sisLoginId: "s2" }),
        makeQuestion({ status: "pending", sisLoginId: "s3", points: null }),
      ],
      1,
    );

    const rows = parseRows(csv);
    expect(rows).toHaveLength(5); // header + possible + 3 students
    expect(rows.map((r) => r[3])).toEqual([
      "SIS Login ID",
      "",
      "s1",
      "s2",
      "s3",
    ]);
  });

  it("leaves the score cell blank for a student with no grade entered yet", () => {
    const csv = buildGradebookCsv(
      [makeQuestion({ status: "pending", points: null })],
      1,
    );

    expect(parseRows(csv)[2]).toEqual([
      "Test Student",
      "854974",
      "",
      "abc123",
      "",
      "badrmari-sandbox",
      "",
    ]);
  });

  it("leaves the Points Possible cell blank when pointsPossible is null", () => {
    const csv = buildGradebookCsv([], null);

    expect(parseRows(csv)[1]).toEqual([
      "Points Possible",
      "",
      "",
      "",
      "",
      "",
      "",
    ]);
  });

  it("uses a FIXME placeholder as the score column header, not the quiz title", () => {
    const csv = buildGradebookCsv([], 1);

    expect(parseRows(csv)[0][6]).toBe(
      "FIXME: copy-paste the cell from a Gradebook export",
    );
  });

  it("leaves SIS User ID and Integration ID blank (not present in the source CSV)", () => {
    const csv = buildGradebookCsv([makeQuestion()], 1);
    const row = parseRows(csv)[2];

    expect(row[2]).toBe(""); // SIS User ID
    expect(row[4]).toBe(""); // Integration ID
  });
});

describe("buildGradebookRows", () => {
  it("returns the same rows buildGradebookCsv serializes, as plain arrays", () => {
    const questions = [makeQuestion()];

    expect(buildGradebookRows(questions, 1)).toEqual(
      parseRows(buildGradebookCsv(questions, 1)),
    );
  });
});
