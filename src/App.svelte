<script>
import Detail from "./components/Detail.svelte";
import Queue from "./components/Queue.svelte";
import Upload from "./components/Upload.svelte";

let questions = $state(null);
let statusFilter = $state("all");
let bloomFilter = $state("all");

// Frozen at selection time (Section 5): Next/Previous in the detail view
// move through this snapshot of ids, not a live re-filtered list, so
// editing a question mid-review can't shift what's navigable out from
// under the TA.
let workingSetIds = $state(null);
let selectedQuestionId = $state(null);

let selectedQuestion = $derived(
  questions?.find((q) => q.id === selectedQuestionId) ?? null,
);
let selectedIndex = $derived(
  workingSetIds && selectedQuestionId
    ? workingSetIds.indexOf(selectedQuestionId)
    : -1,
);
let hasPrevious = $derived(selectedIndex > 0);
let hasNext = $derived(
  workingSetIds !== null &&
    selectedIndex >= 0 &&
    selectedIndex < workingSetIds.length - 1,
);

function handleParsed(parsedQuestions) {
  questions = parsedQuestions;
}

function handleSelect(id, filteredIds) {
  workingSetIds = filteredIds;
  selectedQuestionId = id;
}

function handleBackToQueue() {
  selectedQuestionId = null;
  workingSetIds = null;
}

function handlePrevious() {
  if (hasPrevious) selectedQuestionId = workingSetIds[selectedIndex - 1];
}

function handleNext() {
  if (hasNext) selectedQuestionId = workingSetIds[selectedIndex + 1];
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
  {:else if selectedQuestion === null}
    <Queue {questions} bind:statusFilter bind:bloomFilter onSelect={handleSelect} />
  {:else}
    {#key selectedQuestion.id}
      <Detail
        question={selectedQuestion}
        {hasPrevious}
        {hasNext}
        onSave={handleSave}
        onNext={handleNext}
        onPrevious={handlePrevious}
        onBack={handleBackToQueue}
      />
    {/key}
  {/if}
</main>
