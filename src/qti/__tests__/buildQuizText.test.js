import { describe, expect, it } from "vitest";
import { buildQuizText } from "../buildQuizText.js";

function makeQuestion({
  status = "accepted",
  correctAnswer = "B",
  ...overrides
} = {}) {
  return {
    question: {
      stem: "What is 2 + 2?",
      responses: { A: "3", B: "4", C: "5", D: "22" },
      feedback: {
        A: "Not quite.",
        B: "Correct!",
        C: "Not quite.",
        D: "That's concatenation, not addition.",
      },
      correctAnswer,
    },
    review: { status },
    ...overrides,
  };
}

describe("buildQuizText", () => {
  it("includes only accepted questions", () => {
    const text = buildQuizText(
      [
        makeQuestion({ status: "accepted" }),
        makeQuestion({ status: "pending" }),
        makeQuestion({ status: "rejected" }),
      ],
      "Test Quiz",
    );

    expect(text.match(/^1\.\s\s/gm)).toHaveLength(1);
  });

  it("produces the exact expected format for a single accepted question", () => {
    const text = buildQuizText([makeQuestion()], "Test Quiz");

    expect(text).toBe(
      [
        "Quiz title: Test Quiz",
        "",
        "Points: 1",
        "1.  What is 2 \\+ 2?",
        "a)  3",
        "... Not quite\\.",
        "*b) 4",
        "... Correct\\!",
        "c)  5",
        "... Not quite\\.",
        "d)  22",
        "... That's concatenation, not addition\\.",
        "",
      ].join("\n"),
    );
  });

  it("marks whichever letter is correctAnswer, not always B", () => {
    const text = buildQuizText([makeQuestion({ correctAnswer: "D" })], "Q");

    expect(text).toMatch(/^\*d\) 22$/m);
    expect(text).not.toMatch(/^\*b\)/m);
  });

  it("gives every accepted question a 'Points: 1' line and its own block", () => {
    const text = buildQuizText(
      [makeQuestion(), makeQuestion({ correctAnswer: "A" })],
      "Q",
    );

    expect(text.match(/^Points: 1$/gm)).toHaveLength(2);
    expect(text.match(/^1\.\s\s/gm)).toHaveLength(2);
  });

  it("does not escape the quiz title (not processed as Markdown by text2qti)", () => {
    const text = buildQuizText([], "CSC101 * Midterm Review!");

    expect(text).toContain("Quiz title: CSC101 * Midterm Review!");
  });

  it("backslash-escapes Markdown-special characters in stem/responses/feedback", () => {
    const text = buildQuizText(
      [
        makeQuestion({
          question: {
            stem: "What is 3 * 4? (use *, not x)",
            responses: {
              A: "12",
              B: "_twelve_",
              C: "`12`",
              D: "1[2]",
            },
            feedback: {
              A: "#winning!",
              B: "Not quite.",
              C: "Not quite.",
              D: "Not quite - close though.",
            },
            correctAnswer: "A",
          },
        }),
      ],
      "Q",
    );

    expect(text).toContain("1.  What is 3 \\* 4? \\(use \\*, not x\\)");
    expect(text).toContain("*a) 12");
    expect(text).toContain("... \\#winning\\!");
    expect(text).toContain("b)  \\_twelve\\_");
    expect(text).toContain("c)  \\`12\\`");
    expect(text).toContain("d)  1\\[2\\]");
    expect(text).toContain("... Not quite \\- close though\\.");
  });

  it("collapses an embedded newline in a field to a single line", () => {
    const text = buildQuizText(
      [
        makeQuestion({
          question: {
            stem: "Line one\nLine two",
            responses: { A: "a", B: "b", C: "c", D: "d" },
            feedback: { A: "x", B: "y", C: "z", D: "w" },
            correctAnswer: "A",
          },
        }),
      ],
      "Q",
    );

    expect(text).toContain("1.  Line one Line two");
    // No response/feedback/choice line should accidentally start a fresh
    // line from embedded content.
    expect(text.split("\n")).not.toContainEqual("Line two");
  });

  it("produces no question blocks when there are no accepted questions", () => {
    const text = buildQuizText(
      [
        makeQuestion({ status: "pending" }),
        makeQuestion({ status: "rejected" }),
      ],
      "Empty Quiz",
    );

    expect(text).toBe("Quiz title: Empty Quiz\n");
  });
});
