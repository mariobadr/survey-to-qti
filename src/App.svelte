<script>
import Queue from "./components/Queue.svelte";
import Upload from "./components/Upload.svelte";

let questions = $state(null);
let statusFilter = $state("all");

// pointsPossible is a single value shared across every question (Planned
// rework item 4), not a per-question field -- it's set here, via its own
// draft/commit input, and threaded down read-only to Queue and Detail.
let pointsPossibleDraft = $state(null);
let pointsPossible = $state(null);

function handleParsed(parsedQuestions) {
  questions = parsedQuestions;
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
</script>

<main>
  <h1>Canvas Question Review</h1>

  {#if questions === null}
    <Upload onParsed={handleParsed} />
  {:else}
    <div class="points-possible">
      <label>
        Points possible (all questions):
        <input type="number" bind:value={pointsPossibleDraft} />
      </label>
      <button type="button" onclick={handleCommitPointsPossible}>Set</button>
      <span>Current: {pointsPossible ?? "not set"}</span>
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
</style>
