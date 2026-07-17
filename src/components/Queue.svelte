<script>
import {
  defaultAttemptNumber,
  groupByStudent,
  selectedQuestionFor,
} from "../attempts.js";
import Detail from "./Detail.svelte";

/**
 * @typedef {object} Props
 * @property {object[]} questions - Valid Question objects from parseSurveyCsv
 *   (Section 4's data model), unfiltered, one entry per attempt -- a student
 *   with more than one attempt has more than one entry here (Planned rework
 *   item 6).
 * @property {string} [statusFilter] - Bindable; lets the caller restore the
 *   filter selection when returning from the detail view. Applied against
 *   each student's *currently selected* attempt.
 * @property {Record<string, number>} [attemptSelection] - Bindable;
 *   TA-chosen attempt numbers per student, keyed by sisLoginId (Planned
 *   rework item 6, src/attempts.js). A student not yet in here uses
 *   `defaultAttempt` instead. Mutated in place as the TA picks attempts from
 *   the dropdown below.
 * @property {"first" | "latest"} [defaultAttempt] - Which attempt counts as
 *   "the" attempt for a student with more than one and no entry yet in
 *   `attemptSelection`, chosen on the Upload screen.
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
  attemptSelection = $bindable({}),
  defaultAttempt = "first",
  pointsPossible = null,
  onSave,
} = $props();

const STATUSES = ["pending", "accepted", "rejected"];

// One row per student (Planned rework item 6), each carrying every attempt
// plus whichever one is currently selected -- the TA's explicit choice from
// the dropdown below if there is one, else defaultAttempt. Every displayed
// column (edited/status/grade) and the expanded Detail view reflect only
// this selected attempt, never the others.
// otherAcceptedAttempts: accepted attempts other than the selected one --
// only the selected attempt's grade reaches the gradebook CSV (Section 7),
// so an accepted-but-not-selected attempt is a real trap: its grade is
// silently left out. Surfaced as an inline warning below rather than
// relying on the TA to remember the distinction between "accepted" and
// "selected".
let rows = $derived(
  groupByStudent(questions).map((group) => {
    const selected = selectedQuestionFor(
      group.attempts,
      attemptSelection[group.sisLoginId],
      defaultAttempt,
    );
    return {
      ...group,
      selected,
      otherAcceptedAttempts: group.attempts.filter(
        (a) =>
          a.submission.attempt !== selected.submission.attempt &&
          a.review.status === "accepted",
      ),
    };
  }),
);

// `rows` filtered by the current statusFilter selection; "all" means
// unfiltered. Filters on each student's *selected* attempt -- switching the
// attempt dropdown can move a row in or out of the current filter, same as
// editing status directly would. (A Bloom-level filter used to live here
// too -- dropped per PROJECT_SPEC.md's "Planned rework" item 5, not useful
// in practice.)
let filtered = $derived(
  rows.filter(
    (row) =>
      statusFilter === "all" || row.selected.review.status === statusFilter,
  ),
);

// The Question Review view (Planned rework item 1): at most one row is
// expanded in place at a time, showing the same Detail component that used
// to live on a separate page. Toggling to a different student (or back to
// null) unmounts whichever Detail was expanded -- its onDestroy hook
// commits that row's draft on the way out, so switching or closing never
// loses work, mirroring the old auto-save-on-navigate behavior without a
// separate page. Keyed by student (sisLoginId), not by question id, since
// which attempt is expanded for that student can change without collapsing
// the row (see the {#key} around Detail below).
let expandedId = $state(null);

function handleToggle(sisLoginId) {
  expandedId = expandedId === sisLoginId ? null : sisLoginId;
}

function handleAttemptChange(sisLoginId, attemptNumber) {
  attemptSelection[sisLoginId] = attemptNumber;
}

/**
 * Label an attempt option in the dropdown: "N (first)", "N (latest)", or
 * plain "N" for anything in between.
 *
 * @param {number} attemptNumber
 * @param {number} index - Position within the (ascending-sorted) attempts array.
 * @param {number} count - Total attempts for this student.
 * @returns {string}
 */
function attemptLabel(attemptNumber, index, count) {
  if (index === 0) return `${attemptNumber} (first)`;
  if (index === count - 1) return `${attemptNumber} (latest)`;
  return `${attemptNumber}`;
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
  const pointsText = points === null ? "-" : `${points}`;
  return pointsPossible !== null
    ? `${pointsText} / ${pointsPossible}`
    : pointsText;
}
</script>

<section>
  <h2 class="sr-only">Review queue</h2>

  <div class="filters">
    <label>
      QTI Status:
      <select bind:value={statusFilter}>
        <option value="all">All</option>
        {#each STATUSES as status (status)}
          <option value={status}>{status}</option>
        {/each}
      </select>
    </label>
  </div>

  <p>{filtered.length} of {rows.length} student(s) shown.</p>

  {#if filtered.length === 0}
    <p>No questions match the current filter.</p>
  {:else}
    <table>
      <thead>
        <tr>
          <th>Student</th>
          <th title="Whichever attempt is selected here is the one whose grade reaches the gradebook CSV.">
            Graded attempt
          </th>
          <th title="Whether the final version is different from the student's originally submitted version.">
            Edited
          </th>
          <th title="Only accepted questions are exported into the final quiz.">
            QTI Status
          </th>
          <th title="The grade that will be exported to the gradebook CSV.">
            Grade
          </th>
        </tr>
      </thead>
      <tbody>
        {#each filtered as row (row.sisLoginId)}
          <tr>
            <td>
              <button
                type="button"
                class="row-select"
                onclick={() => handleToggle(row.sisLoginId)}
                aria-expanded={row.sisLoginId === expandedId}
              >
                <span class="toggle-icon" aria-hidden="true"></span>
                {row.name}
              </button>
            </td>
            <td>
              {#if row.attempts.length === 1}
                {row.attempts[0].submission.attempt}
              {:else}
                <select
                  aria-label={`Attempt for ${row.name}`}
                  value={row.selected.submission.attempt}
                  onchange={(e) =>
                    handleAttemptChange(
                      row.sisLoginId,
                      Number(e.currentTarget.value),
                    )}
                >
                  {#each row.attempts as attempt, i (attempt.submission.attempt)}
                    <option value={attempt.submission.attempt}>
                      {attemptLabel(attempt.submission.attempt, i, row.attempts.length)}
                    </option>
                  {/each}
                </select>
                {#if row.otherAcceptedAttempts.length > 0}
                  <p class="attempt-warning">
                    Attempt{row.otherAcceptedAttempts.length > 1 ? "s" : ""}
                    {row.otherAcceptedAttempts
                      .map((a) => a.submission.attempt)
                      .join(", ")} accepted but not graded
                  </p>
                {/if}
              {/if}
            </td>
            <td>
              <span
                class="badge {row.selected.review.wasEdited
                  ? 'badge-info'
                  : 'badge-pending'}"
              >
                {row.selected.review.wasEdited ? "Edited" : "Unedited"}
              </span>
            </td>
            <td>
              <span class="badge badge-{row.selected.review.status}">
                {row.selected.review.status}
              </span>
            </td>
            <td>{formatGrade(row.selected.review.grade.points)}</td>
          </tr>
          {#if row.sisLoginId === expandedId}
            <tr>
              <td colspan="5" class="detail-cell">
                {#key row.selected.id}
                  <Detail
                    question={row.selected}
                    {pointsPossible}
                    {onSave}
                    onClose={() => (expandedId = null)}
                  />
                {/key}
              </td>
            </tr>
          {/if}
        {/each}
      </tbody>
    </table>
  {/if}
</section>

<style>
  section {
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-card);
    padding: var(--space-5);
  }
  table {
    border-collapse: collapse;
    width: 100%;
  }
  th,
  td {
    text-align: left;
    padding: var(--space-2) var(--space-3);
    border-bottom: 1px solid var(--color-border);
    vertical-align: middle;
  }
  thead th {
    color: var(--color-text-muted);
    font-size: var(--font-size-sm);
    text-transform: uppercase;
    letter-spacing: 0.03em;
    font-weight: 600;
    border-bottom: 2px solid var(--color-border);
  }
  tbody tr:hover {
    background: var(--color-surface-muted);
  }
  tr:has(+ tr .detail-cell) {
    background: var(--color-primary-bg);
  }
  .detail-cell {
    padding: var(--space-5);
    background: var(--color-bg);
    border-bottom: 1px solid var(--color-border);
  }
  .row-select {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    background: none;
    border: none;
    padding: 0;
    color: var(--color-primary);
    text-decoration: none;
    cursor: pointer;
    font: inherit;
    font-weight: 500;
  }
  .row-select:hover,
  .row-select:focus-visible {
    background: none;
    text-decoration: underline;
  }
  .toggle-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1em;
    height: 1em;
    flex-shrink: 0;
    color: var(--color-text-muted);
  }
  .toggle-icon::before {
    content: "";
    width: 0.5em;
    height: 0.5em;
    border-right: 2px solid currentColor;
    border-bottom: 2px solid currentColor;
    transform: rotate(-45deg);
    transition: transform 0.15s ease;
  }
  .row-select[aria-expanded="true"] .toggle-icon::before {
    transform: rotate(45deg);
    margin-block-start: -0.15em;
  }
  .filters {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin-bottom: var(--space-4);
  }
  .attempt-warning {
    margin: var(--space-2) 0 0;
    color: var(--color-warning);
    font-size: var(--font-size-sm);
  }
</style>
