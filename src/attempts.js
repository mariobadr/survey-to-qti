/**
 * Group Question objects (Section 4's data model) by student, and decide
 * which single attempt counts as "the" attempt for a student wherever only
 * one can be used (the Queue row's summary columns, the gradebook CSV --
 * Section 7). Shared by Queue.svelte and Export.svelte so both agree on the
 * same student and pick the same attempt for the same TA choices.
 *
 * @typedef {"first" | "latest"} DefaultAttempt
 */

/**
 * Group Question objects by student (submission.student.sisLoginId), each
 * group's attempts sorted ascending by submission.attempt. Group order
 * follows first appearance in `questions`.
 *
 * @param {object[]} questions - Question objects (Section 4), one per attempt.
 * @returns {{ sisLoginId: string, name: string, attempts: object[] }[]}
 */
export function groupByStudent(questions) {
  const order = [];
  const bySisLoginId = new Map();

  for (const question of questions) {
    const { sisLoginId, name } = question.submission.student;
    let group = bySisLoginId.get(sisLoginId);
    if (!group) {
      group = { sisLoginId, name, attempts: [] };
      bySisLoginId.set(sisLoginId, group);
      order.push(group);
    }
    group.attempts.push(question);
  }

  for (const group of order) {
    group.attempts.sort((a, b) => a.submission.attempt - b.submission.attempt);
  }

  return order;
}

/**
 * Pick a student's default attempt number when the TA hasn't explicitly
 * chosen one yet.
 *
 * @param {object[]} attempts - A group's attempts, already sorted ascending
 *   by submission.attempt (see groupByStudent).
 * @param {DefaultAttempt} defaultAttempt
 * @returns {number}
 */
export function defaultAttemptNumber(attempts, defaultAttempt) {
  return defaultAttempt === "latest"
    ? attempts[attempts.length - 1].submission.attempt
    : attempts[0].submission.attempt;
}

/**
 * Resolve which Question object a student's attempt group currently
 * represents: the TA's explicit choice if there is one, falling back to
 * `defaultAttemptNumber`.
 *
 * @param {object[]} attempts - A group's attempts (see groupByStudent).
 * @param {number | undefined} selectedAttemptNumber - The TA's chosen
 *   attempt number for this student, e.g. from `attemptSelection[sisLoginId]`
 *   -- undefined if they haven't chosen one.
 * @param {DefaultAttempt} defaultAttempt
 * @returns {object} The selected Question object.
 */
export function selectedQuestionFor(
  attempts,
  selectedAttemptNumber,
  defaultAttempt,
) {
  const attemptNumber =
    selectedAttemptNumber ?? defaultAttemptNumber(attempts, defaultAttempt);
  return (
    attempts.find((q) => q.submission.attempt === attemptNumber) ?? attempts[0]
  );
}

/**
 * Reduce `questions` to exactly one Question per student -- whichever
 * attempt is currently selected for them (see selectedQuestionFor). Used
 * anywhere only one row per student makes sense, e.g. the gradebook CSV
 * (Section 7), which can't carry more than one score per student.
 *
 * @param {object[]} questions - Question objects (Section 4), one per attempt.
 * @param {Record<string, number>} attemptSelection - TA-chosen attempt
 *   numbers, keyed by sisLoginId.
 * @param {DefaultAttempt} defaultAttempt
 * @returns {object[]} One Question object per student, in group order.
 */
export function selectCanonicalQuestions(
  questions,
  attemptSelection,
  defaultAttempt,
) {
  return groupByStudent(questions).map((group) =>
    selectedQuestionFor(
      group.attempts,
      attemptSelection[group.sisLoginId],
      defaultAttempt,
    ),
  );
}
