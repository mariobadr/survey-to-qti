// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import Detail from "../Detail.svelte";

// @testing-library/svelte's auto-cleanup relies on global beforeEach/afterEach,
// which this project doesn't enable (tests import from "vitest" explicitly) --
// so cleanup is registered explicitly instead.
afterEach(() => cleanup());

// The content fields shared by `question` and `original` by default -- most
// tests don't care about the original-vs-current distinction, so both
// default to the same values (a freshly-parsed, never-edited question).
const BASE_CONTENT = {
  stem: "What is the base case of a recursive function?",
  responses: {
    A: "A case that calls itself",
    B: "A case that stops the recursion",
    C: "A case that only runs once",
    D: "A syntax error",
  },
  feedback: {
    A: "Not quite -- that's the recursive case.",
    B: "Correct.",
    C: "Not necessarily true for all recursive functions.",
    D: "No, this is a valid concept, not an error.",
  },
  correctAnswer: "B",
  bloomLevel: "Remember",
  keywords: ["recursion", "base case"],
};

// `questionOverrides`/`originalOverrides`/`reviewOverrides` are shallow-merged
// onto the defaults, one level deep -- e.g. { question: { correctAnswer: null } }
// keeps the default stem/responses/etc. and only overrides correctAnswer.
function makeQuestion({
  question: questionOverrides,
  original: originalOverrides,
  review: reviewOverrides,
} = {}) {
  return {
    id: "s1",
    submission: { student: { name: "Alice Anderson" } },
    question: { ...BASE_CONTENT, ...questionOverrides },
    original: { ...BASE_CONTENT, ...originalOverrides },
    review: {
      grade: { points: null },
      status: "pending",
      wasEdited: false,
      ...reviewOverrides,
    },
  };
}

function renderDetail({
  question,
  original,
  review,
  pointsPossible = null,
  hasPrevious = false,
  hasNext = false,
} = {}) {
  const callbacks = {
    onSave: vi.fn(),
    onNext: vi.fn(),
    onPrevious: vi.fn(),
    onBack: vi.fn(),
  };
  render(Detail, {
    props: {
      question: makeQuestion({ question, original, review }),
      pointsPossible,
      hasPrevious,
      hasNext,
      ...callbacks,
    },
  });
  return callbacks;
}

describe("Detail", () => {
  it("renders the question's current field values", () => {
    renderDetail();

    expect(
      screen.getByRole("heading", { name: /Alice Anderson/ }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/stem/i)).toHaveValue(
      "What is the base case of a recursive function?",
    );
    expect(screen.getByLabelText(/response B/i)).toHaveValue(
      "A case that stops the recursion",
    );
    expect(screen.getByLabelText(/bloom level/i)).toHaveValue("Remember");
    expect(screen.getByLabelText(/keywords/i)).toHaveValue(
      "recursion, base case",
    );
    expect(screen.getByRole("radio", { name: "B is correct" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Pending" })).toBeChecked();
  });

  it("shows the original submitted value read-only next to each editable field", () => {
    renderDetail({
      question: {
        stem: "Edited stem.",
        responses: {
          A: "Edited A",
          B: "Edited B",
          C: "Edited C",
          D: "Edited D",
        },
        feedback: {
          A: "Edited FA",
          B: "Edited FB",
          C: "Edited FC",
          D: "Edited FD",
        },
        correctAnswer: "A",
        bloomLevel: "Analyze",
        keywords: ["edited", "keyword"],
      },
      // `original` left at BASE_CONTENT's defaults, simulating a question
      // edited in a previous session.
    });

    expect(
      screen.getByText(
        "Original: What is the base case of a recursive function?",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Original: A case that stops the recursion"),
    ).toBeInTheDocument(); // response B
    expect(screen.getByText("Original: Correct.")).toBeInTheDocument(); // feedback B
    expect(screen.getByText("Original correct answer: B")).toBeInTheDocument();
    expect(screen.getByText("Original: Remember")).toBeInTheDocument(); // bloom level
    expect(
      screen.getByText("Original: recursion, base case"),
    ).toBeInTheDocument(); // keywords
  });

  it("shows no 'unsaved changes' indicator until something is edited", async () => {
    renderDetail();

    expect(screen.queryByText("Unsaved changes")).not.toBeInTheDocument();

    await userEvent.type(screen.getByLabelText(/stem/i), " Extra text.");

    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
  });

  it("shows the shared pointsPossible value read-only, with no input to edit it", () => {
    renderDetail({ pointsPossible: 5 });

    expect(screen.getByText("Out of: 5")).toBeInTheDocument();
    expect(screen.queryByLabelText(/out of/i)).not.toBeInTheDocument();
  });

  it("shows a fallback when pointsPossible hasn't been set yet", () => {
    renderDetail({ pointsPossible: null });

    expect(screen.getByText("Out of: not set")).toBeInTheDocument();
  });

  it("disables Accept until a correct answer is set, and re-enables it once one is", async () => {
    const { onSave } = renderDetail({ question: { correctAnswer: null } });

    expect(screen.getByRole("radio", { name: "Accept" })).toBeDisabled();
    expect(screen.getByText(/set a correct answer/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("radio", { name: "A is correct" }));

    expect(screen.getByRole("radio", { name: "Accept" })).toBeEnabled();

    await userEvent.click(screen.getByRole("radio", { name: "Accept" }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(onSave).toHaveBeenCalledWith(
      "s1",
      expect.objectContaining({ status: "accepted", correctAnswer: "A" }),
    );
  });

  it("falls back an already-invalid accepted+no-correct-answer question to pending on save", async () => {
    const { onSave } = renderDetail({
      question: { correctAnswer: null },
      review: {
        grade: { points: null },
        status: "accepted",
        wasEdited: false,
      },
    });

    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(onSave).toHaveBeenCalledWith(
      "s1",
      expect.objectContaining({ status: "pending" }),
    );
  });

  it("marks wasEdited true when a content field is changed, and includes it in the saved payload", async () => {
    const { onSave } = renderDetail();

    await userEvent.type(screen.getByLabelText(/stem/i), " Extra text.");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(onSave).toHaveBeenCalledWith(
      "s1",
      expect.objectContaining({ wasEdited: true }),
    );
  });

  it("does not mark wasEdited when only grade/status change, not content", async () => {
    const { onSave } = renderDetail();

    await userEvent.type(screen.getByLabelText(/^points/i), "4");
    await userEvent.click(screen.getByRole("radio", { name: "Reject" }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(onSave).toHaveBeenCalledWith(
      "s1",
      expect.objectContaining({
        wasEdited: false,
        status: "rejected",
        grade: expect.objectContaining({ points: 4 }),
      }),
    );
  });

  it("computes wasEdited as a live diff against `original`, ignoring a stale review.wasEdited flag", async () => {
    const { onSave } = renderDetail({
      review: {
        grade: { points: null },
        status: "pending",
        wasEdited: true, // stale -- e.g. left over from an edit since reverted
      },
    });

    // Content matches `original` (both default to BASE_CONTENT) -- no edits
    // this session either, so the live diff says false regardless of the
    // stale flag above.
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(onSave).toHaveBeenCalledWith(
      "s1",
      expect.objectContaining({ wasEdited: false }),
    );
  });

  it("clears wasEdited if edited content is reverted back to the original value before saving", async () => {
    const { onSave } = renderDetail();

    const stem = screen.getByLabelText(/stem/i);
    await userEvent.type(stem, " Extra text.");
    await userEvent.type(stem, "{backspace}".repeat(" Extra text.".length));

    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(onSave).toHaveBeenCalledWith(
      "s1",
      expect.objectContaining({ wasEdited: false }),
    );
  });

  it("warns when a keyword count or word count is outside the expected range", async () => {
    renderDetail({ question: { keywords: ["onlyonekeyword"] } });

    expect(
      screen.getByText(/1 keyword\(s\), expected 2-4/),
    ).toBeInTheDocument();

    const stem = screen.getByLabelText(/stem/i);
    await userEvent.clear(stem);
    await userEvent.type(
      stem,
      Array.from({ length: 55 }, (_, i) => `word${i}`).join(" "),
    );

    expect(screen.getByText(/55 words, limit 50/)).toBeInTheDocument();
  });

  it("Previous/Next reflect hasPrevious/hasNext and commit the draft before navigating", async () => {
    const { onSave, onNext, onPrevious } = renderDetail({
      hasPrevious: true,
      hasNext: true,
    });

    await userEvent.type(screen.getByLabelText(/^points/i), "4");

    expect(screen.getByRole("button", { name: "Previous" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Next" })).toBeEnabled();

    await userEvent.click(screen.getByRole("button", { name: "Next" }));

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onNext).toHaveBeenCalledTimes(1);
    expect(onPrevious).not.toHaveBeenCalled();
  });

  it("disables Previous/Next when hasPrevious/hasNext are false", () => {
    renderDetail({ hasPrevious: false, hasNext: false });

    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  });

  it("Back to queue commits the draft before navigating back", async () => {
    const { onSave, onBack } = renderDetail();

    await userEvent.click(
      screen.getByRole("button", { name: "Back to queue" }),
    );

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
