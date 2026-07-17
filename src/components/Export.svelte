<script>
import {
  buildGradebookCsv,
  buildGradebookRows,
} from "../gradebook/buildGradebookCsv.js";
import { buildQuizText } from "../qti/buildQuizText.js";
import { generateQtiZip } from "../qti/generateQtiZip.js";

/**
 * @typedef {object} Props
 * @property {object[]} questions - All Question objects (Section 4's data
 *   model), unfiltered -- only `review.status === "accepted"` ones make it
 *   into the QTI package (Section 6); the gradebook CSV (Section 7) instead
 *   includes every student, regardless of status.
 * @property {number | null} pointsPossible - The shared points-possible
 *   value (Section 4), written into the gradebook CSV's "Points Possible"
 *   row.
 * @property {() => void} onBack - Returns to the Question Review view.
 */

/** @type {Props} */
let { questions, pointsPossible, onBack } = $props();

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
  buildGradebookRows(questions, pointsPossible),
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
  const csv = buildGradebookCsv(questions, pointsPossible);
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
  <h2>Export</h2>
  <button type="button" onclick={onBack}>Back to review</button>

  <ul>
    <li>{accepted.length} accepted</li>
    <li>{rejected.length} rejected</li>
    <li>{pending.length} pending</li>
  </ul>

  <section class="export-block">
    <h3>QTI package</h3>

    <label>
      Quiz title:
      <input type="text" bind:value={title} />
    </label>

    <div class="nav">
      <button
        type="button"
        disabled={accepted.length === 0 || status === "loading"}
        onclick={handleDownload}
      >
        Download QTI package
      </button>
    </div>

    {#if accepted.length === 0}
      <p class="warning">No accepted questions yet -- nothing to export.</p>
    {/if}

    {#if status === "loading"}
      <p>
        Generating the QTI package -- this can take a while the first time
        (loading a Python runtime in your browser).
      </p>
    {/if}

    {#if status === "error"}
      <p class="error">Couldn't generate the QTI package: {errorMessage}</p>
    {/if}

    {#if status === "done"}
      <p>Downloaded -- check your browser's downloads for the QTI zip file.</p>
    {/if}

    <details>
      <summary>Preview text2qti input</summary>
      <pre class="qti-preview">{quizTextPreview}</pre>
    </details>
  </section>

  <section class="export-block">
    <h3>Gradebook CSV</h3>

    <div class="nav">
      <button type="button" onclick={handleDownloadGradebookCsv}>
        Download gradebook CSV
      </button>
    </div>

    {#if gradebookDownloaded}
      <p>Downloaded -- check your browser's downloads for the gradebook CSV.</p>
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
  .warning {
    color: #8a6100;
  }
  .error {
    color: #b00020;
  }
  .nav {
    margin-block: 1em;
  }
  .export-block {
    margin-block: 1.5em;
    padding-block-start: 1em;
    border-top: 1px solid #ccc;
  }
  .qti-preview {
    max-height: 20em;
    overflow: auto;
    padding: 0.75em;
    background: #f5f5f5;
    border: 1px solid #ccc;
    white-space: pre-wrap;
    word-break: break-word;
  }
  .csv-preview-wrapper {
    max-height: 20em;
    overflow: auto;
    border: 1px solid #ccc;
  }
  .csv-preview-table {
    border-collapse: collapse;
    width: 100%;
  }
  .csv-preview-table th,
  .csv-preview-table td {
    border: 1px solid #ccc;
    padding: 0.25em 0.5em;
    text-align: left;
    white-space: nowrap;
  }
  .csv-preview-table thead th {
    position: sticky;
    top: 0;
    background: #f5f5f5;
  }
</style>
