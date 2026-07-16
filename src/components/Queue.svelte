<script>
import { BLOOM_LEVELS } from "../csv/fieldNormalization.js";

/**
 * @typedef {object} Props
 * @property {object[]} questions - Valid Question objects from parseSurveyCsv
 *   (Section 4's data model), unfiltered.
 * @property {(id: string) => void} onSelect - Called with a question's `id`
 *   when the TA clicks it to open the detail view (Screen 3).
 */

/** @type {Props} */
let { questions, onSelect } = $props();

const STATUSES = ["pending", "accepted", "rejected"];

let statusFilter = $state("all");
let bloomFilter = $state("all");

// `questions` filtered by the current statusFilter/bloomFilter selections;
// "all" for either one means that dimension isn't filtered.
let filtered = $derived(
  questions.filter((q) => {
    if (statusFilter !== "all" && q.review.status !== statusFilter)
      return false;
    if (bloomFilter !== "all" && q.question.bloomLevel !== bloomFilter)
      return false;
    return true;
  }),
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

    <label>
      Bloom level:
      <select bind:value={bloomFilter}>
        <option value="all">All</option>
        {#each BLOOM_LEVELS as level (level)}
          <option value={level}>{level}</option>
        {/each}
      </select>
    </label>
  </div>

  <p>{filtered.length} of {questions.length} question(s) shown.</p>

  {#if filtered.length === 0}
    <p>No questions match the current filters.</p>
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
              <button type="button" class="row-select" onclick={() => onSelect(q.id)}>
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
