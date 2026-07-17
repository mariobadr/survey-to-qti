<script>
import { selectCanonicalQuestions } from "../attempts.js";
import {
  buildGradebookCsv,
  buildGradebookRows,
} from "../gradebook/buildGradebookCsv.js";
import { buildQuizText } from "../qti/buildQuizText.js";
import { generateQtiZip } from "../qti/generateQtiZip.js";

/**
 * @typedef {object} Props
 * @property {object[]} questions - All Question objects (Section 4's data
 *   model), unfiltered, one entry per attempt (Planned rework item 6) --
 *   only `review.status === "accepted"` ones make it into the QTI package
 *   (Section 6), regardless of which attempt they are.
 * @property {number | null} pointsPossible - The shared points-possible
 *   value (Section 4), written into the gradebook CSV's "Points Possible"
 *   row.
 * @property {Record<string, number>} attemptSelection - TA-chosen attempt
 *   numbers per student (Planned rework item 6, src/attempts.js). The
 *   gradebook CSV (Section 7) can only carry one score per student, so it's
 *   built from exactly one attempt per student -- whichever one this
 *   selects (or `defaultAttempt`, for a student with no explicit choice).
 * @property {"first" | "latest"} defaultAttempt - See attemptSelection.
 * @property {() => void} onBack - Returns to the Question Review view.
 */

/** @type {Props} */
let { questions, pointsPossible, attemptSelection, defaultAttempt, onBack } =
  $props();

// The gradebook CSV (Section 7) is per-student, not per-attempt -- Canvas
// has no way to carry more than one score for the same student in the same
// column. Reduced to one Question per student using the same selection the
// TA made in the Queue view (or its default), so the score that reaches the
// gradebook always matches whichever attempt the TA was actually looking at.
let canonicalQuestions = $derived(
  selectCanonicalQuestions(questions, attemptSelection, defaultAttempt),
);

let title = $state(
  `Reviewed Questions (${new Date().toISOString().slice(0, 10)})`,
);
let status = $state("idle"); // "idle" | "loading" | "error" | "done"
let errorMessage = $state(null);
let gradebookDownloaded = $state(false);

let accepted = $derived(
  questions.filter((q) => q.review.status === "accepted"),
);
let rejected = $derived(
  questions.filter((q) => q.review.status === "rejected"),
);
let pending = $derived(questions.filter((q) => q.review.status === "pending"));

// Both previews are pure, synchronous re-derivations of the same functions
// the actual downloads use, so they always exactly match what a download
// would contain -- no separate preview-only logic to drift out of sync.
let quizTextPreview = $derived(buildQuizText(questions, title));
let gradebookRowsPreview = $derived(
  buildGradebookRows(canonicalQuestions, pointsPossible),
);

function sanitizeFilename(name) {
  return name.replace(/[\\/:*?"<>|]/g, "-") || "quiz";
}

function downloadBlob(content, type, filename) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function handleDownloadGradebookCsv() {
  const csv = buildGradebookCsv(canonicalQuestions, pointsPossible);
  downloadBlob(csv, "text/csv", `${sanitizeFilename(title)}-grades.csv`);
  gradebookDownloaded = true;
}

/**
 * Build the quiz text from the accepted questions, run it through Pyodide
 * + text2qti (Section 6), and trigger a download of the resulting QTI 1.2
 * zip. The first call on a page load is slow (booting Pyodide, installing
 * text2qti via micropip); every call after that reuses the cached runtime.
 */
async function handleDownload() {
  status = "loading";
  errorMessage = null;
  try {
    const zipBytes = await generateQtiZip(quizTextPreview);
    downloadBlob(zipBytes, "application/zip", `${sanitizeFilename(title)}.zip`);
    status = "done";
  } catch (err) {
    status = "error";
    errorMessage = err instanceof Error ? err.message : String(err);
  }
}
</script>

<section>
  <div class="export-header">
    <h2>Export</h2>
    <button type="button" onclick={onBack}>Back to review</button>
  </div>

  <ul class="summary">
    <li><span class="badge badge-accepted">{accepted.length} accepted</span></li>
    <li><span class="badge badge-rejected">{rejected.length} rejected</span></li>
    <li><span class="badge badge-pending">{pending.length} pending</span></li>
  </ul>

  <section class="export-block card">
    <h3>QTI package</h3>

    <label>
      Quiz title:
      <input type="text" bind:value={title} />
    </label>

    <div class="nav">
      <button
        type="button"
        class="primary"
        disabled={accepted.length === 0 || status === "loading"}
        onclick={handleDownload}
      >
        Download QTI package
      </button>
    </div>

    {#if accepted.length === 0}
      <p class="alert alert-warning">No accepted questions yet -- nothing to export.</p>
    {/if}

    {#if status === "loading"}
      <p class="alert alert-warning">
        Generating the QTI package -- this can take a while the first time
        (loading a Python runtime in your browser).
      </p>
    {/if}

    {#if status === "error"}
      <p class="alert alert-danger">Couldn't generate the QTI package: {errorMessage}</p>
    {/if}

    {#if status === "done"}
      <p class="alert alert-success">Downloaded -- check your browser's downloads for the QTI zip file.</p>
    {/if}

    <details>
      <summary>Preview text2qti input</summary>
      <pre class="qti-preview">{quizTextPreview}</pre>
    </details>
  </section>

  <section class="export-block card">
    <h3>Gradebook CSV</h3>

    <div class="nav">
      <button type="button" class="primary" onclick={handleDownloadGradebookCsv}>
        Download gradebook CSV
      </button>
    </div>

    {#if gradebookDownloaded}
      <p class="alert alert-success">Downloaded -- check your browser's downloads for the gradebook CSV.</p>
    {/if}

    <details>
      <summary>Preview gradebook CSV</summary>
      <div class="csv-preview-wrapper">
        <table class="csv-preview-table">
          <thead>
            <tr>
              {#each gradebookRowsPreview[0] as cell}
                <th>{cell}</th>
              {/each}
            </tr>
          </thead>
          <tbody>
            {#each gradebookRowsPreview.slice(1) as row}
              <tr>
                {#each row as cell}
                  <td>{cell}</td>
                {/each}
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </details>
  </section>
</section>

<style>
  section {
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-card);
    padding: var(--space-5);
  }
  .export-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-block-end: var(--space-4);
  }
  .export-header h2 {
    margin: 0;
  }
  .summary {
    display: flex;
    gap: var(--space-3);
    list-style: none;
    margin: 0 0 var(--space-5);
    padding: 0;
  }
  label {
    display: block;
    margin-block-end: var(--space-3);
  }
  label input[type="text"] {
    display: block;
    width: 100%;
    max-width: 28rem;
    margin-block-start: var(--space-1);
  }
  .nav {
    margin-block: var(--space-4);
  }
  .export-block {
    margin-block: var(--space-5);
    box-shadow: none;
  }
  .export-block h3 {
    margin-block-end: var(--space-4);
  }
  details summary {
    cursor: pointer;
    color: var(--color-primary);
    font-weight: 500;
    margin-block-start: var(--space-3);
  }
  .qti-preview {
    max-height: 20em;
    overflow: auto;
    margin-block-start: var(--space-3);
    padding: var(--space-3);
    background: var(--color-surface-muted);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    font-family: var(--font-mono);
    font-size: var(--font-size-sm);
    white-space: pre-wrap;
    word-break: break-word;
  }
  .csv-preview-wrapper {
    max-height: 20em;
    overflow: auto;
    margin-block-start: var(--space-3);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
  }
  .csv-preview-table {
    border-collapse: collapse;
    width: 100%;
    font-size: var(--font-size-sm);
  }
  .csv-preview-table th,
  .csv-preview-table td {
    border-bottom: 1px solid var(--color-border);
    padding: var(--space-2) var(--space-3);
    text-align: left;
    white-space: nowrap;
  }
  .csv-preview-table thead th {
    position: sticky;
    top: 0;
    background: var(--color-surface-muted);
    color: var(--color-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }
</style>
