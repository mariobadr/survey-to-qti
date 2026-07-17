/**
 * Proportionally rescale every already-entered grade when the shared
 * `pointsPossible` value (Section 4, Planned rework item 4) changes, so
 * existing grades don't silently become inconsistent with the new
 * denominator -- e.g. 0.5/1 becomes 1/2 when pointsPossible changes from 1
 * to 2.
 *
 * Mutates each Question's `review.grade.points` in place, matching how
 * App.svelte's handleSave already mutates `questions` directly (it's deeply
 * reactive `$state`, so the queue table picks up changes without a
 * reassignment). Rounded to 2 decimal places to avoid floating-point noise
 * (e.g. 0.30000000000000004).
 *
 * @param {object[]} questions - Question objects (Section 4).
 * @param {number} oldPossible - The previous pointsPossible value. Callers
 *   should only call this when it's a positive number -- there's nothing
 *   coherent to scale from a zero or unset denominator.
 * @param {number} newPossible - The new pointsPossible value.
 * @returns {number} How many grades were rescaled (i.e. how many questions
 *   had a non-null `review.grade.points`).
 */
export function scaleGrades(questions, oldPossible, newPossible) {
  let count = 0;
  for (const q of questions) {
    const points = q.review.grade.points;
    if (points !== null) {
      q.review.grade.points =
        Math.round(((points * newPossible) / oldPossible) * 100) / 100;
      count++;
    }
  }
  return count;
}
