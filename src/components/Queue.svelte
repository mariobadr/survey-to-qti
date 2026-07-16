<script>
import Detail from "./Detail.svelte";

/**
 * @typedef {object} Props
 * @property {object[]} questions - Valid Question objects from parseSurveyCsv
 *   (Section 4's data model), unfiltered.
 * @property {string} [statusFilter] - Bindable; lets the caller restore the
 *   filter selection when returning from the detail view.
 * @property {number | null} [pointsPossible] - The single points-possible
 *   value shared across every question (Planned rework item 4), used to
 *   format the Grade column and passed through to the expanded Detail view.
 * @property {(id: string, updates: object) => void} onSave - Passed straight
 *   through to whichever row is currently expanded (Detail); commits that
 *   row's draft back into the shared question data.
 */

/** @type {Props} */
let {
  questions,
  statusFilter = $bindable("all"),
  pointsPossible = null,
  onSave,
} = $props();

const STATUSES = ["pending", "accepted", "rejected"];

// `questions` filtered by the current statusFilter selection; "all" means
// unfiltered. (A Bloom-level filter used to live here too -- dropped per
// PROJECT_SPEC.md's "Planned rework" item 5, not useful in practice.)
let filtered = $derived(
  questions.filter(
    (q) => statusFilter === "all" || q.review.status === statusFilter,
  ),
);

// The Question Review view (Planned rework item 1): at most one row is
// expanded in place at a time, showing the same Detail component that used
// to live on a separate page. Toggling to a different id (or back to null)
// unmounts whichever Detail was expanded -- its onDestroy hook commits that
// row's draft on the way out, so switching or closing never loses work,
// mirroring the old auto-save-on-navigate behavior without a separate page.
let expandedId = $state(null);

function handleToggle(id) {
  expandedId = expandedId === id ? null : id;
}

/**
 * Format a question's points for display in the queue table, against the
 * shared pointsPossible value (Planned rework item 4 -- pointsPossible is no
 * longer per-question).
 *
 * @param {number | null} points - `review.grade.points` from a Question object.
 * @returns {string}
 */
function formatGrade(points) {
  if (points === null) return "Not graded";
  return pointsPossible !== null
    ? `${points} / ${pointsPossible}`
    : `${points}`;
}
</script>

<section>
  <h2>Review queue</h2>

  <div class="filters">
    <label>
      Status:
      <select bind:value={statusFilter}>
        <option value="all">All</option>
        {#each STATUSES as status (status)}
          <option value={status}>{status}</option>
        {/each}
      </select>
    </label>
  </div>

  <p>{filtered.length} of {questions.length} question(s) shown.</p>

  {#if filtered.length === 0}
    <p>No questions match the current filter.</p>
  {:else}
    <table>
      <thead>
        <tr>
          <th>Student</th>
          <th>Bloom level</th>
          <th>Status</th>
          <th>Grade</th>
        </tr>
      </thead>
      <tbody>
        {#each filtered as q (q.id)}
          <tr>
            <td>
              <button
                type="button"
                class="row-select"
                onclick={() => handleToggle(q.id)}
                aria-expanded={q.id === expandedId}
              >
                <span class="toggle-icon" aria-hidden="true">
                  {q.id === expandedId ? "-" : "+"}
                </span>
                {q.submission.student.name}
              </button>
            </td>
            <td>{q.question.bloomLevel ?? "Unrecognized"}</td>
            <td>{q.review.status}</td>
            <td>{formatGrade(q.review.grade.points)}</td>
          </tr>
          {#if q.id === expandedId}
            <tr>
              <td colspan="4">
                <Detail
                  question={q}
                  {pointsPossible}
                  {onSave}
                  onClose={() => (expandedId = null)}
                />
              </td>
            </tr>
          {/if}
        {/each}
      </tbody>
    </table>
  {/if}
</section>

<style>
  table {
    border-collapse: collapse;
    width: 100%;
  }
  th,
  td {
    text-align: left;
    padding: 0.4em 0.8em;
    border-bottom: 1px solid #ddd;
  }
  .row-select {
    display: inline-flex;
    align-items: baseline;
    background: none;
    border: none;
    padding: 0;
    color: #1a5fb4;
    text-decoration: underline;
    cursor: pointer;
    font: inherit;
  }
  .toggle-icon {
    display: inline-block;
    width: 1em;
    margin-right: 0.4em;
    font-weight: bold;
    text-decoration: none;
    text-align: center;
  }
  .filters {
    display: flex;
    gap: 1.5em;
    margin-bottom: 1em;
  }
</style>
