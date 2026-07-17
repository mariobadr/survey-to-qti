const RESPONSE_LETTERS = ["A", "B", "C", "D"];
const CHOICE_LETTERS = ["a", "b", "c", "d"];

// The standard Markdown.pl / Python-Markdown escapable-character set --
// text2qti processes almost all text as Markdown (python-markdown), so any
// of these appearing literally in student-submitted content (e.g. "3 * 4",
// "a_b", code in backticks) would otherwise be read as formatting instead
// of literal text.
const MARKDOWN_SPECIAL_CHARS = /[\\`*_{}[\]()#+\-.!]/g;

function escapeMarkdown(text) {
  return text.replace(MARKDOWN_SPECIAL_CHARS, "\\$&");
}

// text2qti treats certain line-initial patterns specially (question/choice
// markers, "%" comments, "COMMENT"/"END_COMMENT"). Our own field content
// is never the true start of a line -- it's always preceded by a marker
// this module controls ("a)  ", "...  ", etc.) -- except for one case: a
// literal newline embedded in submitted text (e.g. pasted multi-line
// text) would put whatever follows at a fresh, unmarked line start.
// Collapsing to a single line up front avoids that entirely.
function toSingleLine(text) {
  return text.replace(/\s*\n\s*/g, " ").trim();
}

function formatField(text) {
  return escapeMarkdown(toSingleLine(text));
}

/**
 * Build a text2qti-format quiz string (Section 6) from the accepted
 * questions only -- rejected and pending questions never reach the export.
 * Every question is worth a fixed 1 point; Section 6 treats per-question
 * point weighting as a placeholder decision, not configurable in this
 * build (separate from the review-grade `pointsPossible`, which feeds the
 * gradebook CSV export instead, not this one).
 *
 * @param {object[]} questions - Question objects (Section 4's data model).
 * @param {string} title - Quiz title; shown as the imported quiz's name in
 *   Quercus. Not processed as Markdown (per text2qti), so it isn't escaped.
 * @returns {string}
 */
export function buildQuizText(questions, title) {
  const accepted = questions.filter((q) => q.review.status === "accepted");

  const lines = [`Quiz title: ${title}`];

  for (const q of accepted) {
    lines.push("");
    lines.push("Points: 1");
    lines.push(`1.  ${formatField(q.question.stem)}`);

    for (let i = 0; i < RESPONSE_LETTERS.length; i++) {
      const responseLetter = RESPONSE_LETTERS[i];
      const choiceLetter = CHOICE_LETTERS[i];
      const isCorrect = q.question.correctAnswer === responseLetter;
      // "*d) " (one space) lines up with "a)  " (two spaces) once the
      // leading "*" is counted -- purely cosmetic, text2qti only requires
      // one or more spaces/tabs after the closing paren.
      const choicePrefix = isCorrect ? `*${choiceLetter})` : `${choiceLetter})`;
      const padding = isCorrect ? " " : "  ";
      lines.push(
        `${choicePrefix}${padding}${formatField(q.question.responses[responseLetter])}`,
      );
      lines.push(`... ${formatField(q.question.feedback[responseLetter])}`);
    }
  }

  return `${lines.join("\n")}\n`;
}
