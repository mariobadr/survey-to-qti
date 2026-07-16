<script>
import Queue from "./components/Queue.svelte";
import Upload from "./components/Upload.svelte";

let questions = $state(null);
let selectedQuestionId = $state(null);

let selectedQuestion = $derived(
  questions?.find((q) => q.id === selectedQuestionId) ?? null,
);

function handleParsed(parsedQuestions) {
  questions = parsedQuestions;
}

function handleSelect(id) {
  selectedQuestionId = id;
}

function handleBackToQueue() {
  selectedQuestionId = null;
}
</script>

<main>
  <h1>Canvas Question Review</h1>

  {#if questions === null}
    <Upload onParsed={handleParsed} />
  {:else if selectedQuestion === null}
    <Queue {questions} onSelect={handleSelect} />
  {:else}
    <p>
      Detail view for {selectedQuestion.submission.student.name} not built yet
      (Section 5, Screen 3).
    </p>
    <button type="button" onclick={handleBackToQueue}>Back to queue</button>
  {/if}
</main>
