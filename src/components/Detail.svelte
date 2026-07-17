<script>
import { onDestroy, untrack } from "svelte";
import {
  BLOOM_LEVELS,
  isKeywordCountExpected,
  parseKeywords,
  WORD_LIMITS,
  wordCount,
} from "../csv/fieldNormalization.js";

const RESPONSE_LETTERS = ["A", "B", "C", "D"];

/**
 * @typedef {object} Props
 * @property {object} question - The live Question object to review (Section
 *   4's data model), including its permanent `original` snapshot. Detail is
 *   rendered inline within a Queue row (Section 5's Question Review view),
 *   one instance per expanded row; the parent gives each expanded question a
 *   fresh instance (e.g. via `{#if q.id === expandedId}`), so the draft
 *   state below only ever initializes once per question.
 * @property {number | null} pointsPossible - The single points-possible
 *   value shared across every question (Planned rework item 4). Set from
 *   the top-level input in App.svelte; shown here read-only since it's no
 *   longer a per-question field.
 * @property {(id: string, updates: object) => void} onSave - Commits the
 *   draft back into the shared question data.
 * @property {() => void} onClose - Collapses this row back in the parent
 *   Queue table. Doesn't need to commit the draft itself -- collapsing
 *   unmounts this component, and the onDestroy hook below commits on the
 *   way out for every case except Discard (see `discarded` below).
 */

/** @type {Props} */
let { question, pointsPossible, onSave, onClose } = $props();

// Detail is rendered inline within a Queue row, one instance per expanded
// question; the parent replaces it with a fresh instance whenever a
// different row is expanded. It's safe to snapshot `question` exactly once
// here and treat it as fixed for this component's entire lifetime --
// nothing below writes back to `question` itself until commit() runs
// (explicit Save, or automatically on unmount -- see onDestroy below).
// Snapshotting via a function, rather than reading `question` directly in
// the $state(...) calls below, avoids Svelte's state_referenced_locally
// warning, which exists to catch the (different) mistake of assuming a prop
// read stays live without a {#key}/$derived -- not applicable here, since it
// deliberately doesn't.
function snapshotQuestion(q) {
  return {
    stem: q.question.stem,
    responses: { ...q.question.responses },
    feedback: { ...q.question.feedback },
    correctAnswer: q.question.correctAnswer,
    bloomLevel: q.question.bloomLevel,
    keywords: q.question.keywords,
    points: q.review.grade.points,
    status: q.review.status,
  };
}

// Content/grade/status fields as they stood when this Detail instance
// opened -- used only to initialize the draft state below. (For the
// permanent original-submission snapshot shown read-only next to each
// field, and used to compute wasEdited, see `question.original` instead.)
const opened = untrack(() => snapshotQuestion(question));

// Draft state.
let stem = $state(opened.stem);
let responses = $state({ ...opened.responses });
let feedback = $state({ ...opened.feedback });
let correctAnswer = $state(opened.correctAnswer);
let bloomLevel = $state(opened.bloomLevel);
let keywordsText = $state(opened.keywords.join(", "));
let points = $state(opened.points);
let status = $state(opened.status);

let keywords = $derived(parseKeywords(keywordsText));

// Accepting requires a real correct answer -- an accepted question with no
// correct answer would produce a broken QTI export later (Section 6).
let canAccept = $derived(correctAnswer !== null);

// isDirty compares against the *live* question.question (which reflects
// the last save, if any -- e.g. from the onDestroy safety net committing a
// still-dirty draft when the parent expands a different row out from under
// this instance), so it correctly reflects unsaved edits in that case too.
let isDirty = $derived(
  status !== question.review.status ||
    points !== question.review.grade.points ||
    contentDiffersFrom(question.question),
);

function sameKeywords(a, b) {
  return a.length === b.length && a.every((keyword, i) => keyword === b[i]);
}

/**
 * Whether any draft content field (the fields a student actually
 * submitted, as opposed to review metadata like grade/status) differs from
 * a given reference snapshot of those same fields.
 *
 * @param {{ stem: string, responses: object, feedback: object, correctAnswer: string | null, bloomLevel: string | null, keywords: string[] }} reference
 * @returns {boolean}
 */
function contentDiffersFrom(reference) {
  return (
    stem !== reference.stem ||
    RESPONSE_LETTERS.some(
      (letter) => responses[letter] !== reference.responses[letter],
    ) ||
    RESPONSE_LETTERS.some(
      (letter) => feedback[letter] !== reference.feedback[letter],
    ) ||
    correctAnswer !== reference.correctAnswer ||
    bloomLevel !== reference.bloomLevel ||
    !sameKeywords(keywords, reference.keywords)
  );
}

/**
 * Commit the current draft back to the shared question via onSave.
 *
 * wasEdited is content-only (Section 4) and is a live diff against
 * `question.original` -- the permanent, never-mutated snapshot of what was
 * first parsed from the CSV (Section 4). Unlike the monotonic
 * flag this replaced, typing the original content back does clear it; the
 * `original` values are always visible read-only next to each field (see
 * markup below), so the TA can already tell a field was edited without
 * needing a flag that survives reverting it.
 *
 * Also enforces the Accept-requires-a-correct-answer invariant: if the
 * draft somehow ended up "accepted" with no correct answer set (e.g. it was
 * accepted, then the correct answer was cleared), this quietly falls back
 * to "pending" rather than saving an invalid combination.
 */
function commit() {
  const finalStatus = status === "accepted" && !canAccept ? "pending" : status;
  status = finalStatus;

  onSave(question.id, {
    stem,
    responses: { ...responses },
    feedback: { ...feedback },
    correctAnswer,
    bloomLevel,
    keywords,
    grade: { points },
    status: finalStatus,
    wasEdited: contentDiffersFrom(question.original),
  });
}

// Set by Discard so the onDestroy safety net below doesn't re-commit the
// draft it just intentionally threw away.
let discarded = false;

// Save (below) commits explicitly before doing anything else. This
// onDestroy is the safety net for the case Save doesn't cover: expanding a
// *different* row while this one is still open, which unmounts this
// instance from the outside (the parent Queue row's own click handler, not
// anything in this component) with no chance to run a click handler first.
// Committing twice in the Save case is harmless -- the second call just
// resends the same already-saved values.
onDestroy(() => {
  if (!discarded) commit();
});

function handleSaveClick() {
  commit();
  onClose();
}

function handleDiscardClick() {
  discarded = true;
  onClose();
}
</script>

<section>
  {#if isDirty}
    <p class="detail-header">
      <span class="badge badge-warning">Unsaved changes</span>
    </p>
  {/if}

  <fieldset class="card">
    <legend>Question</legend>
    <div class="card-header" aria-hidden="true">Question</div>
    <div class="card-body">

    <div class="field-row">
      <div class="field-col">
        <label for="detail-bloom-level">Bloom level:</label>
        <p class="original">Student submitted: {question.original.bloomLevel ?? "— not set —"}</p>
        <p class="final-version">Final version:</p>
        <select id="detail-bloom-level" bind:value={bloomLevel}>
          <option value={null}>— not set —</option>
          {#each BLOOM_LEVELS as level (level)}
            <option value={level}>{level}</option>
          {/each}
        </select>
      </div>
      <div class="field-col">
        <label for="detail-keywords">Keywords (comma-separated):</label>
        <p class="original">Student submitted: {question.original.keywords.join(", ")}</p>
        {#if !isKeywordCountExpected(keywords)}
          <p class="warning">{keywords.length} keyword(s), expected 2-4</p>
        {/if}
        <p class="final-version">Final version:</p>
        <input id="detail-keywords" type="text" bind:value={keywordsText} />
      </div>
    </div>

    <label for="detail-stem">Stem:</label>
    <p class="original">
      Student submitted ({wordCount(question.original.stem)} words):<br />
      {question.original.stem}
    </p>
    {#if wordCount(stem) > WORD_LIMITS.stem}
      <p class="warning">{wordCount(stem)} words, limit {WORD_LIMITS.stem}</p>
    {/if}
    <p class="final-version">Final version ({wordCount(stem)} words):</p>
    <textarea id="detail-stem" bind:value={stem}></textarea>

    {#if question.original.correctAnswer === null}
      <p class="original">Student submitted correct answer: — none —</p>
    {/if}
    <table class="responses-table">
      <thead>
        <tr>
          <th scope="col">Correct answer</th>
          <th scope="col">Response</th>
          <th scope="col">Feedback</th>
        </tr>
      </thead>
      <tbody>
        {#each RESPONSE_LETTERS as letter (letter)}
          <tr>
            <td>
              <label>
                <input
                  type="radio"
                  name="correctAnswer"
                  value={letter}
                  bind:group={correctAnswer}
                />
                {letter} is correct
              </label>
              {#if question.original.correctAnswer === letter}
                <p class="original">Student submitted this as the correct answer</p>
              {/if}
            </td>
            <td>
              <p class="original">
                Student submitted ({wordCount(question.original.responses[letter])} words):
                <br />
                {question.original.responses[letter]}
              </p>
              {#if wordCount(responses[letter]) > WORD_LIMITS.response}
                <p class="warning">
                  {wordCount(responses[letter])} words, limit {WORD_LIMITS.response}
                </p>
              {/if}
              <label>
                Final version ({wordCount(responses[letter])} words):
                <textarea bind:value={responses[letter]}></textarea>
              </label>
            </td>
            <td>
              <p class="original">
                Student submitted ({wordCount(question.original.feedback[letter])} words):
                <br />
                {question.original.feedback[letter]}
              </p>
              {#if wordCount(feedback[letter]) > WORD_LIMITS.feedback}
                <p class="warning">
                  {wordCount(feedback[letter])} words, limit {WORD_LIMITS.feedback}
                </p>
              {/if}
              <label>
                Final version ({wordCount(feedback[letter])} words):
                <textarea bind:value={feedback[letter]}></textarea>
              </label>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
    </div>
  </fieldset>

  <fieldset class="card">
    <legend>Review</legend>
    <div class="card-header" aria-hidden="true">Review</div>
    <div class="card-body">

    <div class="field-row">
      <div class="field-col">
        <h4>Grade</h4>
        <div class="grade-row">
          <label>
            Points:
            <input type="number" bind:value={points} />
          </label>
          <span>Out of: {pointsPossible ?? "not set"}</span>
        </div>
      </div>
      <div class="field-col">
        <h4>Status</h4>
        <label>
          <input type="radio" name="status" value="pending" bind:group={status} />
          Pending
        </label>
        <label>
          <input
            type="radio"
            name="status"
            value="accepted"
            bind:group={status}
            disabled={!canAccept}
          />
          Accept
        </label>
        <label>
          <input type="radio" name="status" value="rejected" bind:group={status} />
          Reject
        </label>
        {#if !canAccept}
          <p class="warning">Set a correct answer before this question can be accepted.</p>
        {/if}
      </div>
    </div>
    </div>
  </fieldset>

  <div class="nav">
    <button type="button" class="primary" onclick={handleSaveClick}>Save and Close</button>
    <button type="button" onclick={handleDiscardClick}>Discard and Close</button>
  </div>
</section>

<style>
  .detail-header {
    margin: 0 0 var(--space-4);
  }
  fieldset.card + fieldset.card {
    margin-block-start: var(--space-5);
  }
  fieldset h4 {
    margin-block: 0 var(--space-2);
    font-size: var(--font-size-sm);
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: var(--color-text-muted);
  }
  label {
    display: block;
    margin-block-end: var(--space-1);
  }
  .field-row {
    display: flex;
    gap: var(--space-5);
    margin-block-end: var(--space-4);
  }
  .field-col {
    flex: 1;
    min-width: 0;
  }
  .field-col select,
  .field-col input:not([type="radio"]) {
    width: 100%;
  }
  .grade-row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }
  .grade-row label {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin: 0;
  }
  .grade-row input[type="number"] {
    width: 5em;
  }
  label:has(input[type="radio"]) {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin-block-end: var(--space-2);
  }
  .responses-table {
    border-collapse: collapse;
    width: 100%;
    table-layout: fixed;
  }
  .responses-table th,
  .responses-table td {
    text-align: left;
    vertical-align: top;
    padding: var(--space-3);
    border-bottom: 1px solid var(--color-border);
  }
  .responses-table tbody tr:nth-child(even) {
    background: var(--color-surface-muted);
  }
  .responses-table th:first-child,
  .responses-table td:first-child {
    width: 20%;
  }
  .responses-table th:not(:first-child),
  .responses-table td:not(:first-child) {
    width: 40%;
  }
  .responses-table label {
    font-weight: 500;
    margin-block-end: var(--space-1);
  }
  textarea {
    display: block;
    width: 100%;
    max-width: 40em;
    min-height: 2.5em;
  }
  .responses-table textarea {
    max-width: none;
  }
  .warning {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin-block: var(--space-1) var(--space-2);
    padding: var(--space-2) var(--space-3);
    background: var(--color-warning-bg);
    border: 1px solid var(--color-warning-border);
    border-radius: var(--radius-sm);
    color: var(--color-warning);
    font-weight: 600;
  }
  .warning::before {
    content: "⚠";
  }
  .original {
    color: var(--color-text-muted);
    font-size: var(--font-size-sm);
    margin-block: 0 var(--space-2);
  }
  .final-version {
    font-weight: 500;
    margin-block-end: var(--space-1);
  }
  .nav {
    display: flex;
    gap: var(--space-2);
    margin-block-start: var(--space-5);
  }
</style>
