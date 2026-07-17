<script>
import Export from "./components/Export.svelte";
import Queue from "./components/Queue.svelte";
import Upload from "./components/Upload.svelte";
import {
  clearSession,
  loadSession,
  saveSession,
} from "./persistence/session.js";
import { scaleGrades } from "./scaleGrades.js";

let questions = $state(null);
let statusFilter = $state("all");

// Attempt handling (Planned rework item 6, src/attempts.js): a student can
// have more than one attempt, and exactly one at a time counts as "the"
// attempt for them -- the TA's explicit per-student choice if there is one
// (attemptSelection, keyed by sisLoginId), else defaultAttempt (chosen once
// on the Upload screen). Both are threaded down read/write to Queue, and
// read-only to Export for the gradebook CSV (Section 7), which can only
// carry one score per student.
let attemptSelection = $state({});
let defaultAttempt = $state("first");

// Which of the three screens is showing: "upload" (Screen 1), "review"
// (Screen 2), or "export" (Screen 3). A persistent nav bar (below) lets the
// TA switch freely once questions are loaded -- this isn't just a linear
// wizard step. Review/export are disabled in that nav until `questions` is
// non-null, since there's nothing to review or export yet.
let view = $state("upload");

// pointsPossible is a single value shared across every question (Planned
// rework item 4), not a per-question field -- it's set here, via its own
// draft/commit input, and threaded down read-only to Queue and Detail.
// Defaults to 1 (the most common case -- one point per question) rather
// than unset, so a TA who never touches this still gets sane grades.
let pointsPossibleDraft = $state(1);
let pointsPossible = $state(1);

// Set after a pointsPossible change rescales existing grades (see
// handleCommitPointsPossible) -- an unobtrusive, non-blocking confirmation
// that grades were adjusted, in the same spirit as the autosave-failure
// banner below. Left visible until the next commit rather than
// auto-dismissed on a timer, since there's no harm in a TA seeing it a
// little longer and no good moment to guess it's safe to hide.
let gradeScaleNotice = $state(null);

// Negative points possible makes no sense (a question can't be worth less
// than nothing); 0 is allowed -- Canvas itself supports a 0-point
// assignment. Gates the "Set" button rather than clamping the typed value,
// so the TA sees why it's disabled instead of having their input silently
// rewritten.
let pointsPossibleDraftInvalid = $derived(
  typeof pointsPossibleDraft === "number" && pointsPossibleDraft < 0,
);

// Read once at startup (not reactive) -- this is the only point a saved
// session can appear, since nothing in this session writes to storage
// except this app's own autosave effect below.
const savedSession = loadSession();

// "pending" gates the whole app behind a Resume/Start-over choice when a
// saved session exists (Section 8); "decided" means either there was
// nothing to resume, or the TA already chose. Kept separate from
// `questions` so the autosave effect below can tell "haven't decided yet"
// apart from "decided, but nothing loaded yet" and never overwrite a saved
// session before the TA has seen it.
let sessionChoice = $state(savedSession ? "pending" : "decided");

function handleParsed(parsedQuestions, chosenDefaultAttempt) {
  questions = parsedQuestions;
  defaultAttempt = chosenDefaultAttempt;
  attemptSelection = {};
  view = "review";
}

/**
 * Restore the session autosaved at startup, once the TA chooses "Resume" on
 * the resume prompt.
 */
function handleResume() {
  questions = savedSession.questions;
  pointsPossible = savedSession.pointsPossible;
  pointsPossibleDraft = savedSession.pointsPossible;
  statusFilter = savedSession.statusFilter;
  attemptSelection = savedSession.attemptSelection;
  defaultAttempt = savedSession.defaultAttempt;
  gradeScaleNotice = null;
  sessionChoice = "decided";
  view = "review";
}

function handleStartOver() {
  clearSession();
  sessionChoice = "decided";
}

/**
 * Commit a new pointsPossible value, rescaling any already-entered grades
 * to match (e.g. 0.5/1 becomes 1/2 if pointsPossible changes from 1 to 2) --
 * otherwise those grades would silently become inconsistent with the new
 * denominator. Only scales when there's a coherent old/new pair to scale
 * between (old positive, new non-negative -- 0 is a valid target, Canvas
 * itself supports a 0-point assignment -- and actually different); a TA
 * clearing the field or setting it to the same value just commits as-is.
 * A negative draft never reaches here -- the "Set" button is disabled for
 * one (see pointsPossibleDraftInvalid) -- but bails out defensively anyway
 * in case this is ever called some other way.
 */
function handleCommitPointsPossible() {
  const oldPossible = pointsPossible;
  const newPossible = pointsPossibleDraft;

  if (typeof newPossible === "number" && newPossible < 0) return;

  if (
    typeof oldPossible === "number" &&
    oldPossible > 0 &&
    typeof newPossible === "number" &&
    newPossible >= 0 &&
    newPossible !== oldPossible
  ) {
    const scaledCount = scaleGrades(questions, oldPossible, newPossible);
    gradeScaleNotice =
      scaledCount > 0
        ? `Scaled ${scaledCount} existing grade${scaledCount === 1 ? "" : "s"} from out of ${oldPossible} to out of ${newPossible}.`
        : null;
  } else {
    gradeScaleNotice = null;
  }

  pointsPossible = newPossible;
}

/**
 * Commit a Detail draft back into the shared `questions` state. Mutates the
 * matching question in place -- `questions` is deeply reactive ($state), so
 * the queue table picks up the change without needing to reassign the array.
 */
function handleSave(id, updates) {
  const q = questions.find((item) => item.id === id);
  if (!q) return;
  q.question.stem = updates.stem;
  q.question.responses = updates.responses;
  q.question.feedback = updates.feedback;
  q.question.correctAnswer = updates.correctAnswer;
  q.question.bloomLevel = updates.bloomLevel;
  q.question.keywords = updates.keywords;
  q.review.grade = updates.grade;
  q.review.status = updates.status;
  q.review.wasEdited = updates.wasEdited;
}

// True if the most recent autosave attempt failed (e.g. localStorage full
// or unavailable) -- surfaced as an unobtrusive banner below, since a TA
// mid-review shouldn't be interrupted by a modal/alert over something that
// isn't blocking their work, just quietly putting it at risk.
let autosaveFailed = $state(false);

// Autosave (Section 8). Only runs once there's something to save -- guards
// against the "pending" resume choice ever being clobbered before the TA
// has seen it. Nested reads of `questions` during serialization (inside
// saveSession) register as dependencies too, same as any other $state, so
// this reruns on every commit (Save/Close/auto-commit-on-unmount all flow
// through handleSave) and on every pointsPossible/statusFilter/
// attemptSelection change -- never on Detail's uncommitted
// keystroke-level draft state, which never touches `questions` until commit.
$effect(() => {
  if (questions === null) return;
  autosaveFailed = !saveSession({
    questions,
    pointsPossible,
    statusFilter,
    attemptSelection,
    defaultAttempt,
  });
});
</script>

<main>
  <h1>Survey to QTI</h1>

  {#if autosaveFailed}
    <p class="alert alert-warning autosave-warning" role="status">
      Autosave isn't working right now -- recent changes may not be saved.
      This can happen in private/incognito browsing, or if your browser's
      storage is full.
    </p>
  {/if}

  {#if sessionChoice === "pending"}
    <section class="card resume-card">
      <h2>Resume previous session?</h2>
      <p>Unsaved review progress was found from a previous session.</p>
      <div class="nav">
        <button type="button" class="primary" onclick={handleResume}>Resume</button>
        <button type="button" onclick={handleStartOver}>Start over</button>
      </div>
    </section>
  {:else}
    <nav class="tabs">
      <button
        type="button"
        class:active={view === "upload"}
        onclick={() => (view = "upload")}
      >
        Upload
      </button>
      <button
        type="button"
        class:active={view === "review"}
        disabled={questions === null}
        title={questions === null ? "Upload a file first" : undefined}
        onclick={() => (view = "review")}
      >
        Review
      </button>
      <button
        type="button"
        class:active={view === "export"}
        disabled={questions === null}
        title={questions === null ? "Upload a file first" : undefined}
        onclick={() => (view = "export")}
      >
        Export
      </button>
    </nav>

    {#if view === "upload"}
      <Upload onParsed={handleParsed} hasExistingQuestions={questions !== null} />
    {:else if view === "export" && questions !== null}
      <Export
        {questions}
        {pointsPossible}
        {attemptSelection}
        {defaultAttempt}
        onBack={() => (view = "review")}
      />
    {:else if questions !== null}
      <div class="points-possible">
        <label>
          Points possible (all questions):
          <input type="number" min="0" bind:value={pointsPossibleDraft} />
        </label>
        <button
          type="button"
          disabled={pointsPossibleDraftInvalid}
          onclick={handleCommitPointsPossible}
        >
          Set
        </button>
        <span>Current: {pointsPossible ?? "not set"}</span>
      </div>

      {#if pointsPossibleDraftInvalid}
        <p class="alert alert-danger">Points possible can't be negative.</p>
      {/if}

      {#if gradeScaleNotice}
        <p class="alert alert-success" role="status">{gradeScaleNotice}</p>
      {/if}

      <Queue
        {questions}
        bind:statusFilter
        bind:attemptSelection
        {defaultAttempt}
        {pointsPossible}
        onSave={handleSave}
      />
    {/if}
  {/if}
</main>

<style>
  main {
    max-width: 74rem;
    margin-inline: auto;
    padding: var(--space-6) var(--space-5);
  }
  .tabs {
    display: flex;
    gap: var(--space-2);
    margin-block-end: var(--space-5);
    border-bottom: 1px solid var(--color-border);
  }
  .tabs button {
    border: none;
    border-bottom: 3px solid transparent;
    border-radius: 0;
    background: none;
    padding: var(--space-2) var(--space-1) var(--space-3);
    margin-block-end: -1px;
    color: var(--color-text-muted);
    font-weight: 500;
  }
  .tabs button:hover:not(:disabled) {
    background: none;
    color: var(--color-text);
  }
  .tabs button.active {
    color: var(--color-primary);
    border-bottom-color: var(--color-primary);
    font-weight: 600;
  }
  .points-possible {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    margin-block-end: var(--space-5);
    padding: var(--space-3) var(--space-4);
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
  }
  .points-possible label {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-weight: 500;
  }
  .points-possible input[type="number"] {
    width: 5em;
  }
  .points-possible span {
    color: var(--color-text-muted);
  }
  .alert {
    margin-block-end: var(--space-4);
  }
  .resume-card {
    max-width: 32rem;
  }
  .resume-card .nav {
    display: flex;
    gap: var(--space-2);
    margin-block-start: var(--space-4);
  }
  .autosave-warning {
    position: fixed;
    right: var(--space-5);
    bottom: var(--space-5);
    max-width: 22em;
    margin: 0;
    box-shadow: var(--shadow-card);
  }
</style>
