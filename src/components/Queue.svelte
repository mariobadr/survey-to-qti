<script>
/**
 * @typedef {object} Props
 * @property {object[]} questions - Valid Question objects from parseSurveyCsv
 *   (Section 4's data model), unfiltered.
 * @property {string} [statusFilter] - Bindable; lets the caller restore the
 *   filter selection when returning from the detail view.
 * @property {(id: string, workingSetIds: string[]) => void} onSelect -
 *   Called when the TA clicks a question to open the detail view (Screen 3),
 *   with that question's `id` and the ids of every question currently
 *   passing the filter (the detail view's Next/Previous navigate this
 *   frozen set, per Section 5).
 */

/** @type {Props} */
let { questions, statusFilter = $bindable("all"), onSelect } = $props();

const STATUSES = ["pending", "accepted", "rejected"];

// `questions` filtered by the current statusFilter selection; "all" means
// unfiltered. (A Bloom-level filter used to live here too -- dropped per
// PROJECT_SPEC.md's "Planned rework" item 5, not useful in practice.)
let filtered = $derived(
  questions.filter(
    (q) => statusFilter === "all" || q.review.status === statusFilter,
  ),
);

/**
 * Format a question's grade for display in the queue table.
 *
 * @param {{ points: number | null, pointsPossible: number | null }} grade -
 *   `review.grade` from a Question object.
 * @returns {string}
 */
function formatGrade(grade) {
  if (grade.points === null) return "Not graded";
  return grade.pointsPossible !== null
    ? `${grade.points} / ${grade.pointsPossible}`
    : `${grade.points}`;
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
                onclick={() => onSelect(q.id, filtered.map((f) => f.id))}
              >
                {q.submission.student.name}
              </button>
            </td>
            <td>{q.question.bloomLevel ?? "Unrecognized"}</td>
            <td>{q.review.status}</td>
            <td>{formatGrade(q.review.grade)}</td>
          </tr>
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
    background: none;
    border: none;
    padding: 0;
    color: #1a5fb4;
    text-decoration: underline;
    cursor: pointer;
    font: inherit;
  }
  .filters {
    display: flex;
    gap: 1.5em;
    margin-bottom: 1em;
  }
</style>
