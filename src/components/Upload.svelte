<script>
import { parseSurveyCsv } from "../csv/parseSurveyCsv.js";

let { onParsed } = $props();

let fileName = $state(null);
let result = $state(null);
let readError = $state(null);

// Structurally invalid rows mean the file's shape doesn't match what a
// Canvas survey export looks like at all (wrong file, or a corrupted
// export) -- there's no safe way to guess column meaning from a row that
// doesn't have the expected number of columns, so this blocks continuing
// rather than being a soft warning like the others (Section 5).
let canContinue = $derived(
  result !== null &&
    result.summary.structurallyInvalidRows.length === 0 &&
    result.questions.length > 0,
);

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

function handleContinue() {
  onParsed(result.questions);
}

function describeWarning(warning) {
  switch (warning.type) {
    case "unexpectedBloomLevel":
      return `Row ${warning.rowNumber} (${warning.sisLoginId}): unrecognized Bloom level "${warning.value}"`;
    case "unexpectedCorrectAnswer":
      return `Row ${warning.rowNumber} (${warning.sisLoginId}): unrecognized correct answer "${warning.value}"`;
    case "unexpectedKeywordCount":
      return `Row ${warning.rowNumber} (${warning.sisLoginId}): ${warning.keywords.length} keyword(s), expected 2-4`;
    case "wordCountExceeded":
      return `Row ${warning.rowNumber} (${warning.sisLoginId}): ${warning.field} is ${warning.actual} words, limit is ${warning.limit}`;
    case "duplicateAttemptDropped":
      return `${warning.name} (${warning.sisLoginId}): dropped attempt ${warning.droppedAttempt} (row ${warning.droppedRowNumber}), kept attempt ${warning.keptAttempt}`;
    default:
      return JSON.stringify(warning);
  }
}
</script>

<section>
  <h2>Upload</h2>
  <p>Select the Canvas survey CSV export to review.</p>

  <input type="file" accept=".csv" onchange={handleFileChange} />

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
          expected column layout and can't be read at all. This usually means the
          wrong file was selected, or the export is corrupted -- re-export the
          survey from Canvas and try again.
        </p>
        <ul class="error-list">
          {#each result.summary.structurallyInvalidRows as row (row.rowNumber)}
            <li>
              Row {row.rowNumber}: found {row.columnCount} columns, expected {row.expectedColumnCount}
            </li>
          {/each}
        </ul>
      {/if}

      {#if result.summary.incompleteRows.length > 0}
        <p class="warning">
          {result.summary.incompleteRows.length} row(s) are missing required fields
          and were excluded from review:
        </p>
        <ul class="warning-list">
          {#each result.summary.incompleteRows as row (row.rowNumber)}
            <li>
              Row {row.rowNumber} ({row.name || "unknown student"}): missing {row.missingFields.join(", ")}
            </li>
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
