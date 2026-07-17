import { describe, expect, it } from "vitest";
import { scaleGrades } from "../scaleGrades.js";

function makeQuestion(points) {
  return { review: { grade: { points } } };
}

describe("scaleGrades", () => {
  it("scales the example from the request: 0.5/1 becomes 1/2", () => {
    const questions = [makeQuestion(0.5)];

    scaleGrades(questions, 1, 2);

    expect(questions[0].review.grade.points).toBe(1);
  });

  it("scales every question with a non-null grade", () => {
    const questions = [makeQuestion(2), makeQuestion(4)];

    scaleGrades(questions, 5, 10);

    expect(questions[0].review.grade.points).toBe(4);
    expect(questions[1].review.grade.points).toBe(8);
  });

  it("leaves ungraded (null) questions alone", () => {
    const questions = [makeQuestion(null)];

    scaleGrades(questions, 1, 2);

    expect(questions[0].review.grade.points).toBeNull();
  });

  it("returns the count of grades actually rescaled", () => {
    const questions = [makeQuestion(1), makeQuestion(null), makeQuestion(2)];

    const count = scaleGrades(questions, 1, 2);

    expect(count).toBe(2);
  });

  it("rounds to 2 decimal places to avoid floating-point noise", () => {
    const questions = [makeQuestion(1)];

    scaleGrades(questions, 3, 1);

    expect(questions[0].review.grade.points).toBe(0.33);
  });

  it("scales down as well as up", () => {
    const questions = [makeQuestion(4)];

    scaleGrades(questions, 10, 5);

    expect(questions[0].review.grade.points).toBe(2);
  });

  it("scales existing grades down to 0 when newPossible is 0", () => {
    const questions = [makeQuestion(0.5), makeQuestion(1)];

    scaleGrades(questions, 1, 0);

    expect(questions[0].review.grade.points).toBe(0);
    expect(questions[1].review.grade.points).toBe(0);
  });
});
