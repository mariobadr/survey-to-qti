<script>
import { buildGradebookCsv } from "../gradebook/buildGradebookCsv.js";
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
    const quizText = buildQuizText(questions, title);
    const zipBytes = await generateQtiZip(quizText);
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
    <button type="button" onclick={handleDownloadGradebookCsv}>
      Download gradebook CSV
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

  {#if gradebookDownloaded}
    <p>Downloaded -- check your browser's downloads for the gradebook CSV.</p>
  {/if}
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
</style>
