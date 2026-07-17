<script>
import { parseSurveyCsv } from "../csv/parseSurveyCsv.js";

/**
 * @typedef {object} Props
 * @property {(questions: object[], defaultAttempt: "first" | "latest") => void} onParsed -
 *   Called with the valid Question objects (one per attempt -- not deduped,
 *   Planned rework item 6) and the TA's chosen default-attempt setting,
 *   once the TA clicks "Continue to review queue" (Section 5, Screen 1 ->
 *   Screen 2).
 * @property {boolean} [hasExistingQuestions] - True if questions from an
 *   earlier upload are already loaded (the TA navigated back to Upload via
 *   the nav bar rather than arriving here fresh). Continuing then discards
 *   that review progress, so it's confirmed first.
 */

/** @type {Props} */
let { onParsed, hasExistingQuestions = false } = $props();

let fileName = $state(null);
let result = $state(null);
let readError = $state(null);

// Which attempt counts as "the" attempt for a student with more than one,
// until the TA explicitly picks a different one for that student in the
// Queue view (src/attempts.js). "first" matches the old (removed) dedup
// behavior, which always kept the earliest attempt.
let defaultAttempt = $state("first");

// The preview table (below) is capped rather than rendering every row --
// a large CSV could mean hundreds of student submissions, and the table
// isn't virtualized.
const PREVIEW_ROW_LIMIT = 50;
let previewRows = $derived(
  result ? result.questions.slice(0, PREVIEW_ROW_LIMIT) : [],
);

// Structurally invalid rows mean the file's shape doesn't match what a
// Canvas survey export looks like at all (wrong file, or a corrupted
// export) -- there's no safe way to guess column meaning from a row that
// doesn't have the expected number of columns, so parseSurveyCsv imports
// nothing at all in that case (blocking here is redundant with that, but
// kept explicit for clarity) rather than being a soft warning like the
// others (Section 5).
let canContinue = $derived(
  result !== null &&
    result.summary.structurallyInvalidRows.length === 0 &&
    result.questions.length > 0,
);

/**
 * Read the chosen file and parse it as a Canvas survey CSV export,
 * updating `result` (or `readError` if the file can't even be read as text).
 *
 * @param {Event & { currentTarget: HTMLInputElement }} event - The file
 *   input's change event.
 */
async function handleFileChange(event) {
  const file = event.currentTarget.files?.[0];
  if (!file) return;

  fileName = file.name;
  result = null;
  readError = null;

  try {
    const csvText = await file.text();
    result = parseSurveyCsv(csvText);
  } catch (err) {
    readError = err instanceof Error ? err.message : String(err);
  }
}

/**
 * Hand the parsed, valid questions and the chosen default-attempt setting
 * off to the parent (App.svelte) so it can move on to the review queue.
 * Only reachable when `canContinue` is true. If questions from an earlier
 * upload are already loaded, this would discard that review progress, so
 * it's confirmed first.
 */
function handleContinue() {
  if (
    hasExistingQuestions &&
    !window.confirm(
      "Uploading this file will replace the questions already loaded and discard any review progress. Continue?",
    )
  ) {
    return;
  }
  onParsed(result.questions, defaultAttempt);
}
</script>

<section>
  <h2>Upload</h2>
  <p>Select the Canvas survey CSV export to review.</p>

  {#if hasExistingQuestions}
    <p class="warning">
      Questions from an earlier upload are already loaded. Uploading a new
      file will replace them and discard any review progress.
    </p>
  {/if}

  <input
    type="file"
    accept=".csv"
    aria-label="Canvas survey CSV export"
    onchange={handleFileChange}
  />

  <label>
    Default attempt:
    <select bind:value={defaultAttempt}>
      <option value="first">First attempt</option>
      <option value="latest">Latest attempt</option>
    </select>
  </label>

  {#if readError}
    <p class="error">Couldn't read "{fileName}": {readError}</p>
  {/if}

  {#if result}
    <div class="result">
      <!-- Non-blocking parse warnings (missing fields, unrecognized Bloom
        level/correct answer, word-count violations, ...) aren't repeated
        here -- they resurface naturally while reviewing each question
        (Section 5), so listing them again at upload time would just be
        noise. Only what actually blocks continuing is shown. -->
      {#if result.summary.structurallyInvalidRows.length > 0}
        <p class="error">
          {result.summary.structurallyInvalidRows.length} row(s) don't match the
          expected column layout, so nothing in this file was imported. This
          usually means the wrong file was selected, or the export is
          corrupted -- re-export the survey from Canvas and try again.
        </p>
        <ul class="error-list">
          {#each result.summary.structurallyInvalidRows as row (row.rowNumber)}
            <li>
              Row {row.rowNumber}: found {row.columnCount} columns, expected {row.expectedColumnCount}
            </li>
          {/each}
        </ul>
      {/if}

      <button type="button" disabled={!canContinue} onclick={handleContinue}>
        Continue to review queue
      </button>
      {#if result !== null && !canContinue}
        <p class="error">
          Fix the file and re-upload before continuing
          {result.questions.length === 0 ? " -- no valid questions were found." : "."}
        </p>
      {/if}

      {#if result.questions.length > 0}
        <div class="preview-wrapper">
          <table class="preview-table">
            <thead>
              <tr>
                <th>Student</th>
                <th>Attempt</th>
                <th>Bloom level</th>
                <th>Stem</th>
              </tr>
            </thead>
            <tbody>
              {#each previewRows as q (q.id)}
                <tr>
                  <td>{q.submission.student.name}</td>
                  <td>{q.submission.attempt}</td>
                  <td>{q.question.bloomLevel ?? "Unrecognized"}</td>
                  <td>{q.question.stem}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
        {#if result.questions.length > PREVIEW_ROW_LIMIT}
          <p class="preview-truncated">
            Showing the first {PREVIEW_ROW_LIMIT} of {result.questions.length} rows.
          </p>
        {/if}
      {/if}
    </div>
  {/if}
</section>

<style>
  input[type="file"] {
    display: block;
    margin-block-end: 0.75em;
  }
  label {
    display: block;
  }
  .error {
    color: #b00020;
  }
  .warning {
    color: #8a6100;
  }
  .error-list {
    font-size: 0.9em;
  }
  .preview-wrapper {
    max-height: 20em;
    overflow: auto;
    border: 1px solid #ccc;
    margin-block-start: 1em;
  }
  .preview-truncated {
    font-size: 0.9em;
    color: #666;
    margin-block-start: 0.3em;
  }
  .preview-table {
    border-collapse: collapse;
    width: 100%;
  }
  .preview-table th,
  .preview-table td {
    border: 1px solid #ccc;
    padding: 0.25em 0.5em;
    text-align: left;
  }
  .preview-table th:not(:last-child),
  .preview-table td:not(:last-child) {
    white-space: nowrap;
  }
  .preview-table thead th {
    position: sticky;
    top: 0;
    background: #f5f5f5;
  }
</style>
