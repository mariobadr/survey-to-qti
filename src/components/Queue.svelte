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
// column (Bloom level/status/grade) and the expanded Detail view reflect
// only this selected attempt, never the others.
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
          <th>Bloom level</th>
          <th>Status</th>
          <th>Grade</th>
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
                <span class="toggle-icon" aria-hidden="true">
                  {row.sisLoginId === expandedId ? "-" : "+"}
                </span>
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
                    ⚠ attempt{row.otherAcceptedAttempts.length > 1 ? "s" : ""}
                    {row.otherAcceptedAttempts
                      .map((a) => a.submission.attempt)
                      .join(", ")} accepted but not graded
                  </p>
                {/if}
              {/if}
            </td>
            <td>{row.selected.question.bloomLevel ?? "Unrecognized"}</td>
            <td>{row.selected.review.status}</td>
            <td>{formatGrade(row.selected.review.grade.points)}</td>
          </tr>
          {#if row.sisLoginId === expandedId}
            <tr>
              <td colspan="5">
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
  .attempt-warning {
    margin: 0.3em 0 0;
    color: #8a6100;
    font-size: 0.85em;
  }
</style>
