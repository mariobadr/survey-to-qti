<script>
import Export from "./components/Export.svelte";
import Queue from "./components/Queue.svelte";
import Upload from "./components/Upload.svelte";
import {
  clearSession,
  loadSession,
  saveSession,
} from "./persistence/session.js";

let questions = $state(null);
let statusFilter = $state("all");

// "review" (Question Review view, Screen 2) or "export" (Screen 3).
let view = $state("review");

// pointsPossible is a single value shared across every question (Planned
// rework item 4), not a per-question field -- it's set here, via its own
// draft/commit input, and threaded down read-only to Queue and Detail.
let pointsPossibleDraft = $state(null);
let pointsPossible = $state(null);

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

function handleParsed(parsedQuestions) {
  questions = parsedQuestions;
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
  sessionChoice = "decided";
}

function handleStartOver() {
  clearSession();
  sessionChoice = "decided";
}

function handleCommitPointsPossible() {
  // TODO: if points have already been entered against the old
  // pointsPossible value, consider scaling them proportionally (e.g.
  // points * newPossible / oldPossible) so existing grades don't silently
  // become inconsistent with the new denominator. Not implemented yet.
  pointsPossible = pointsPossibleDraft;
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
// through handleSave) and on every pointsPossible/statusFilter change --
// never on Detail's uncommitted keystroke-level draft state, which never
// touches `questions` until commit.
$effect(() => {
  if (questions === null) return;
  autosaveFailed = !saveSession({ questions, pointsPossible, statusFilter });
});
</script>

<main>
  <h1>Canvas Question Review</h1>

  {#if autosaveFailed}
    <p class="autosave-warning" role="status">
      Autosave isn't working right now -- recent changes may not be saved.
      This can happen in private/incognito browsing, or if your browser's
      storage is full.
    </p>
  {/if}

  {#if sessionChoice === "pending"}
    <section>
      <h2>Resume previous session?</h2>
      <p>Unsaved review progress was found from a previous session.</p>
      <button type="button" onclick={handleResume}>Resume</button>
      <button type="button" onclick={handleStartOver}>Start over</button>
    </section>
  {:else if questions === null}
    <Upload onParsed={handleParsed} />
  {:else if view === "export"}
    <Export {questions} onBack={() => (view = "review")} />
  {:else}
    <div class="points-possible">
      <label>
        Points possible (all questions):
        <input type="number" bind:value={pointsPossibleDraft} />
      </label>
      <button type="button" onclick={handleCommitPointsPossible}>Set</button>
      <span>Current: {pointsPossible ?? "not set"}</span>
      <button type="button" onclick={() => (view = "export")}>
        Go to export
      </button>
    </div>

    <Queue
      {questions}
      bind:statusFilter
      {pointsPossible}
      onSave={handleSave}
    />
  {/if}
</main>

<style>
  .points-possible {
    display: flex;
    align-items: center;
    gap: 0.75em;
    margin-block-end: 1em;
  }
  .autosave-warning {
    position: fixed;
    right: 1em;
    bottom: 1em;
    max-width: 22em;
    margin: 0;
    padding: 0.6em 0.9em;
    background: #fff3cd;
    color: #664d03;
    border: 1px solid #ffe69c;
    border-radius: 4px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
    font-size: 0.9em;
  }
</style>
