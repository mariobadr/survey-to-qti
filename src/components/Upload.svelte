<script>
import { parseSurveyCsv } from "../csv/parseSurveyCsv.js";

/**
 * @typedef {object} Props
 * @property {(questions: object[], defaultAttempt: "first" | "latest") => void} onParsed -
 *   Called with the valid Question objects (one per attempt -- not deduped,
 *   Planned rework item 6) and the TA's chosen default-attempt setting,
 *   once the TA clicks "Continue to review queue" (Section 5, Screen 1 ->
 *   Screen 2).
 */

/** @type {Props} */
let { onParsed } = $props();

let fileName = $state(null);
let result = $state(null);
let readError = $state(null);

// Which attempt counts as "the" attempt for a student with more than one,
// until the TA explicitly picks a different one for that student in the
// Queue view (src/attempts.js). "first" matches the old (removed) dedup
// behavior, which always kept the earliest attempt.
let defaultAttempt = $state("first");

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
 * Only reachable when `canContinue` is true.
 */
function handleContinue() {
  onParsed(result.questions, defaultAttempt);
}

/**
 * Format one parseSurveyCsv warning (see parseSurveyCsv.js's collectWarnings)
 * into TA-readable text.
 *
 * @param {object} warning - One entry from `result.summary.warnings`.
 * @returns {string}
 */
function describeWarning(warning) {
  switch (warning.type) {
    case "missingFields":
      return `Row ${warning.rowNumber} (${warning.name || "unknown student"}): missing ${warning.missingFields.join(", ")} -- included, but grade/edit accordingly`;
    case "unexpectedBloomLevel":
      return `Row ${warning.rowNumber} (${warning.sisLoginId}): unrecognized Bloom level "${warning.value}"`;
    case "unexpectedCorrectAnswer":
      return `Row ${warning.rowNumber} (${warning.sisLoginId}): unrecognized correct answer "${warning.value}"`;
    case "unexpectedKeywordCount":
      return `Row ${warning.rowNumber} (${warning.sisLoginId}): ${warning.keywords.length} keyword(s), expected 2-4`;
    case "wordCountExceeded":
      return `Row ${warning.rowNumber} (${warning.sisLoginId}): ${warning.field} is ${warning.actual} words, limit is ${warning.limit}`;
    default:
      return JSON.stringify(warning);
  }
}
</script>

<section>
  <h2>Upload</h2>
  <p>Select the Canvas survey CSV export to review.</p>

  <input
    type="file"
    accept=".csv"
    aria-label="Canvas survey CSV export"
    onchange={handleFileChange}
  />

  {#if readError}
    <p class="error">Couldn't read "{fileName}": {readError}</p>
  {/if}

  {#if result}
    <div class="summary">
      <h3>Parse summary for "{fileName}"</h3>
      <ul>
        <li>{result.summary.totalRowsParsed} total rows parsed</li>
        <li>{result.summary.validQuestionCount} valid questions ready for review</li>
      </ul>

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

      {#if result.summary.emptyRows.length > 0}
        <p class="warning">
          {result.summary.emptyRows.length} row(s) had no answers at all and
          were excluded from review:
        </p>
        <ul class="warning-list">
          {#each result.summary.emptyRows as row (row.rowNumber)}
            <li>Row {row.rowNumber} ({row.name || "unknown student"})</li>
          {/each}
        </ul>
      {/if}

      {#if result.summary.warnings.length > 0}
        <p class="warning">{result.summary.warnings.length} other warning(s):</p>
        <ul class="warning-list">
          {#each result.summary.warnings as warning, i (i)}
            <li>{describeWarning(warning)}</li>
          {/each}
        </ul>
      {/if}

      <label>
        Default attempt (for students with more than one -- can be changed
        per student in the review queue):
        <select bind:value={defaultAttempt}>
          <option value="first">First attempt</option>
          <option value="latest">Latest attempt</option>
        </select>
      </label>

      <button type="button" disabled={!canContinue} onclick={handleContinue}>
        Continue to review queue
      </button>
      {#if result !== null && !canContinue}
        <p class="error">
          Fix the file and re-upload before continuing
          {result.questions.length === 0 ? " -- no valid questions were found." : "."}
        </p>
      {/if}
    </div>
  {/if}
</section>

<style>
  .error {
    color: #b00020;
  }
  .warning {
    color: #8a6100;
  }
  .error-list,
  .warning-list {
    font-size: 0.9em;
  }
</style>
