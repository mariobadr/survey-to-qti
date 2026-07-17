import { describe, expect, it } from "vitest";
import {
  defaultAttemptNumber,
  groupByStudent,
  selectCanonicalQuestions,
  selectedQuestionFor,
} from "../attempts.js";

function makeQuestion(sisLoginId, attempt, overrides = {}) {
  return {
    id: `${sisLoginId}:${attempt}`,
    submission: {
      student: { sisLoginId, name: `Name ${sisLoginId}` },
      attempt,
    },
    review: { status: "pending", grade: { points: null } },
    ...overrides,
  };
}

describe("groupByStudent", () => {
  it("groups questions by sisLoginId, preserving first-appearance order", () => {
    const questions = [
      makeQuestion("s2", 1),
      makeQuestion("s1", 1),
      makeQuestion("s2", 2),
    ];

    const groups = groupByStudent(questions);

    expect(groups.map((g) => g.sisLoginId)).toEqual(["s2", "s1"]);
    expect(groups[0].attempts).toHaveLength(2);
    expect(groups[1].attempts).toHaveLength(1);
  });

  it("sorts each group's attempts ascending by attempt number", () => {
    const questions = [
      makeQuestion("s1", 3),
      makeQuestion("s1", 1),
      makeQuestion("s1", 2),
    ];

    const [group] = groupByStudent(questions);

    expect(group.attempts.map((q) => q.submission.attempt)).toEqual([1, 2, 3]);
  });
});

describe("defaultAttemptNumber", () => {
  const attempts = [
    makeQuestion("s1", 1),
    makeQuestion("s1", 2),
    makeQuestion("s1", 3),
  ].sort((a, b) => a.submission.attempt - b.submission.attempt);

  it("returns the first attempt's number when defaultAttempt is 'first'", () => {
    expect(defaultAttemptNumber(attempts, "first")).toBe(1);
  });

  it("returns the last attempt's number when defaultAttempt is 'latest'", () => {
    expect(defaultAttemptNumber(attempts, "latest")).toBe(3);
  });
});

describe("selectedQuestionFor", () => {
  const attempts = [makeQuestion("s1", 1), makeQuestion("s1", 2)];

  it("returns the explicitly selected attempt when one is given", () => {
    const selected = selectedQuestionFor(attempts, 2, "first");
    expect(selected.submission.attempt).toBe(2);
  });

  it("falls back to defaultAttemptNumber when no selection is given", () => {
    expect(
      selectedQuestionFor(attempts, undefined, "first").submission.attempt,
    ).toBe(1);
    expect(
      selectedQuestionFor(attempts, undefined, "latest").submission.attempt,
    ).toBe(2);
  });
});

describe("selectCanonicalQuestions", () => {
  it("returns exactly one question per student, using each student's selection or default", () => {
    const questions = [
      makeQuestion("s1", 1),
      makeQuestion("s1", 2),
      makeQuestion("s2", 1),
    ];

    const canonical = selectCanonicalQuestions(questions, { s1: 2 }, "first");

    expect(canonical).toHaveLength(2);
    expect(
      canonical.find((q) => q.submission.student.sisLoginId === "s1").submission
        .attempt,
    ).toBe(2);
    expect(
      canonical.find((q) => q.submission.student.sisLoginId === "s2").submission
        .attempt,
    ).toBe(1);
  });
});
