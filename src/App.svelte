<script>
import Upload from "./components/Upload.svelte";

let questions = $state(null);

function handleParsed(parsedQuestions) {
  questions = parsedQuestions;
}
</script>

<main>
  <h1>Canvas Question Review</h1>

  {#if questions === null}
    <Upload onParsed={handleParsed} />
  {:else}
    <p>{questions.length} question(s) ready for review.</p>
    <p>Review queue UI (Section 5) not built yet.</p>
  {/if}
</main>
