<script>
import { untrack } from "svelte";
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
 *   4's data model). A fresh Detail instance is created per navigated
 *   question (App.svelte wraps this component in a `{#key}` block), so the
 *   draft state below only ever initializes once per question.
 * @property {boolean} hasPrevious
 * @property {boolean} hasNext
 * @property {(id: string, updates: object) => void} onSave - Commits the
 *   draft back into the shared question data.
 * @property {() => void} onNext
 * @property {() => void} onPrevious
 * @property {() => void} onBack
 */

/** @type {Props} */
let { question, hasPrevious, hasNext, onSave, onNext, onPrevious, onBack } =
  $props();

// A fresh Detail instance is created per navigated question (App.svelte
// wraps this component in a {#key selectedQuestion.id} block), so it's safe
// to snapshot `question` exactly once here and treat it as fixed for this
// component's entire lifetime -- nothing below writes back to `question`
// itself until commit() runs (explicit Save, or auto-save on
// Next/Previous/Back -- Section 5). Snapshotting via a function, rather
// than reading `question` directly in the $state(...) calls below, avoids
// Svelte's state_referenced_locally warning, which exists to catch the
// (different) mistake of assuming a prop read stays live without a
// {#key}/$derived -- not applicable here, since it deliberately doesn't.
function snapshotQuestion(q) {
  return {
    stem: q.question.stem,
    responses: { ...q.question.responses },
    feedback: { ...q.question.feedback },
    correctAnswer: q.question.correctAnswer,
    bloomLevel: q.question.bloomLevel,
    keywords: q.question.keywords,
    points: q.review.grade.points,
    pointsPossible: q.review.grade.pointsPossible,
    comment: q.review.grade.comment,
    status: q.review.status,
  };
}

// Content fields as they stood when this Detail instance opened. Used both
// to initialize the draft below and, in commit(), to detect edits made
// *during this session* via contentDiffersFrom(opened).
const opened = untrack(() => snapshotQuestion(question));

// Draft state.
let stem = $state(opened.stem);
let responses = $state({ ...opened.responses });
let feedback = $state({ ...opened.feedback });
let correctAnswer = $state(opened.correctAnswer);
let bloomLevel = $state(opened.bloomLevel);
let keywordsText = $state(opened.keywords.join(", "));
let points = $state(opened.points);
let pointsPossible = $state(opened.pointsPossible);
let comment = $state(opened.comment);
let status = $state(opened.status);

let keywords = $derived(parseKeywords(keywordsText));

// Accepting requires a real correct answer -- an accepted question with no
// correct answer would produce a broken QTI export later (Section 6).
let canAccept = $derived(correctAnswer !== null);

// isDirty compares against the *live* question.question (which reflects
// the last save, if any -- Detail stays mounted across a plain Save click,
// only remounting on Next/Previous), so it correctly clears after saving.
// wasEdited, below, deliberately compares against `opened` instead, since
// it needs to know whether anything changed *this session*, regardless of
// whether that change has already been saved.
let isDirty = $derived(
  status !== question.review.status ||
    points !== question.review.grade.points ||
    pointsPossible !== question.review.grade.pointsPossible ||
    comment !== question.review.grade.comment ||
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
 * wasEdited is content-only (Section 4) and monotonic: once a question has
 * ever been edited from its original submission, it stays flagged, even if
 * the TA later types the original text back -- so this ORs the existing
 * flag with whether content changed relative to `opened` (this session's
 * starting point), rather than recomputing from scratch against the
 * original every time.
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
    grade: { points, pointsPossible, comment },
    status: finalStatus,
    wasEdited: question.review.wasEdited || contentDiffersFrom(opened),
  });
}

function handleSaveClick() {
  commit();
}

function handlePrevious() {
  commit();
  onPrevious();
}

function handleNext() {
  commit();
  onNext();
}

function handleBack() {
  commit();
  onBack();
}
</script>

<section>
  <h2>Review question — {question.submission.student.name}</h2>

  {#if isDirty}
    <p class="dirty">Unsaved changes</p>
  {/if}

  <label>
    Bloom level:
    <select bind:value={bloomLevel}>
      <option value={null}>— not set —</option>
      {#each BLOOM_LEVELS as level (level)}
        <option value={level}>{level}</option>
      {/each}
    </select>
  </label>

  <label>
    Keywords (comma-separated):
    <input type="text" bind:value={keywordsText} />
  </label>
  {#if !isKeywordCountExpected(keywords)}
    <p class="warning">{keywords.length} keyword(s), expected 2-4</p>
  {/if}

  <label>
    Stem:
    <textarea bind:value={stem}></textarea>
  </label>
  {#if wordCount(stem) > WORD_LIMITS.stem}
    <p class="warning">{wordCount(stem)} words, limit {WORD_LIMITS.stem}</p>
  {/if}

  <fieldset>
    <legend>Responses</legend>
    {#each RESPONSE_LETTERS as letter (letter)}
      <div class="response">
        <label>
          <input type="radio" name="correctAnswer" value={letter} bind:group={correctAnswer} />
          {letter} is correct
        </label>
        <label>
          Response {letter}:
          <textarea bind:value={responses[letter]}></textarea>
        </label>
        {#if wordCount(responses[letter]) > WORD_LIMITS.response}
          <p class="warning">
            {wordCount(responses[letter])} words, limit {WORD_LIMITS.response}
          </p>
        {/if}
        <label>
          Feedback {letter}:
          <textarea bind:value={feedback[letter]}></textarea>
        </label>
        {#if wordCount(feedback[letter]) > WORD_LIMITS.feedback}
          <p class="warning">
            {wordCount(feedback[letter])} words, limit {WORD_LIMITS.feedback}
          </p>
        {/if}
      </div>
    {/each}
  </fieldset>

  <fieldset>
    <legend>Grade</legend>
    <label>
      Points:
      <input type="number" bind:value={points} />
    </label>
    <label>
      Out of:
      <input type="number" bind:value={pointsPossible} />
    </label>
    <label>
      Comment:
      <textarea bind:value={comment}></textarea>
    </label>
  </fieldset>

  <fieldset>
    <legend>Status</legend>
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
  </fieldset>

  <div class="nav">
    <button type="button" onclick={handlePrevious} disabled={!hasPrevious}>Previous</button>
    <button type="button" onclick={handleSaveClick}>Save</button>
    <button type="button" onclick={handleNext} disabled={!hasNext}>Next</button>
    <button type="button" onclick={handleBack}>Back to queue</button>
  </div>
</section>

<style>
  fieldset {
    margin-block: 1em;
  }
  .response {
    margin-block-end: 0.75em;
  }
  textarea {
    display: block;
    width: 100%;
    max-width: 40em;
  }
  .dirty {
    color: #8a6100;
    font-weight: bold;
  }
  .warning {
    color: #8a6100;
  }
  .nav {
    display: flex;
    gap: 0.5em;
    margin-block-start: 1em;
  }
</style>
