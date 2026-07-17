import Papa from "papaparse";

// Canvas's gradebook CSV importer matches rows using Student/ID/SIS User
// ID/SIS Login ID/Section, plus one column per assignment holding the
// score. "SIS User ID" and "Integration ID" aren't present anywhere in the
// Canvas survey export this app parses, so they're always left blank --
// Canvas still matches rows fine using ID + SIS Login ID alone.
const GRADEBOOK_HEADER = [
  "Student",
  "ID",
  "SIS User ID",
  "SIS Login ID",
  "Integration ID",
  "Section",
];

// This grade is for the graded survey assignment that students submitted
// their question ideas to -- that assignment already exists in the Canvas
// course (it's what produced the CSV this app parses in the first place).
// But that submission-export CSV doesn't carry the assignment's name or
// Canvas ID anywhere in it, so there's nothing here to build an exact,
// Canvas-matching column header from. (The QTI package built from accepted
// questions, Section 6, is a separate new quiz entirely -- unrelated to
// this grade or this column.) Left as an obvious placeholder for the TA to
// replace by hand with the real header cell, copy-pasted from an actual
// Canvas gradebook export of that survey assignment, rather than risk a
// silent near-match that makes Canvas create a duplicate assignment instead
// of updating the right one.
const SCORE_COLUMN_PLACEHOLDER =
  "FIXME: copy-paste the cell from a Gradebook export";

// Canvas's own gradebook exports show scores with two decimal places; a
// non-number (missing pointsPossible, or a question with no grade entered
// yet) becomes a blank cell rather than "0.00", so Canvas's import leaves
// that student's score untouched instead of zeroing it out.
function formatPoints(points) {
  return typeof points === "number" ? points.toFixed(2) : "";
}

/**
 * Build the gradebook CSV's rows as plain arrays (header row first, then
 * "Points Possible", then one row per student) -- split out from
 * buildGradebookCsv so a table preview (Section 5, Export screen) can
 * render the exact same data the download would contain without having to
 * re-parse CSV text.
 *
 * @param {object[]} questions - All Question objects (Section 4),
 *   regardless of review status -- students who aren't graded yet just get
 *   a blank score cell, so the TA can re-export later once review is
 *   finished without losing anything already imported into Canvas.
 * @param {number | null} pointsPossible - The shared points-possible value
 *   (Section 4), written into the "Points Possible" row Canvas expects
 *   directly under the header.
 * @returns {string[][]} Rows, each the same length as GRADEBOOK_HEADER plus
 *   one score column. The score column's header is a placeholder
 *   (SCORE_COLUMN_PLACEHOLDER) -- the TA must replace it by hand with the
 *   real header cell from a Canvas gradebook export.
 */
export function buildGradebookRows(questions, pointsPossible) {
  const rows = [
    [...GRADEBOOK_HEADER, SCORE_COLUMN_PLACEHOLDER],
    ["Points Possible", "", "", "", "", "", formatPoints(pointsPossible)],
  ];

  for (const q of questions) {
    rows.push([
      q.submission.student.name,
      q.submission.student.canvasId,
      "",
      q.submission.student.sisLoginId,
      "",
      q.submission.section.name,
      formatPoints(q.review.grade.points),
    ]);
  }

  return rows;
}

/**
 * Build a Canvas gradebook-import-ready CSV from buildGradebookRows.
 *
 * @param {object[]} questions - All Question objects (Section 4). See
 *   buildGradebookRows.
 * @param {number | null} pointsPossible - See buildGradebookRows.
 * @returns {string} CSV text, ready for download.
 */
export function buildGradebookCsv(questions, pointsPossible) {
  return Papa.unparse(buildGradebookRows(questions, pointsPossible));
}
