// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import Queue from "../Queue.svelte";

// @testing-library/svelte's auto-cleanup relies on global beforeEach/afterEach,
// which this project doesn't enable (tests import from "vitest" explicitly) --
// so cleanup is registered explicitly instead.
afterEach(() => cleanup());

// Full Question shape (Section 4) is needed even though most tests here
// only look at the table row -- expanding a row renders Detail inline
// (Planned rework item 1), which reads every content/original field.
function makeQuestion({ id, name, bloomLevel, status, points }) {
  const content = {
    stem: `Stem for ${id}`,
    responses: { A: "A", B: "B", C: "C", D: "D" },
    feedback: { A: "FA", B: "FB", C: "FC", D: "FD" },
    correctAnswer: "A",
    bloomLevel,
    keywords: ["kw1", "kw2"],
  };
  return {
    id,
    submission: { student: { name } },
    question: { ...content },
    original: { ...content },
    review: { status, grade: { points }, wasEdited: false },
  };
}

const SAMPLE_QUESTIONS = [
  makeQuestion({
    id: "s1",
    name: "Alice Anderson",
    bloomLevel: "Remember",
    status: "pending",
    points: null,
  }),
  makeQuestion({
    id: "s2",
    name: "Bob Brown",
    bloomLevel: "Analyze",
    status: "accepted",
    points: 4,
  }),
  makeQuestion({
    id: "s3",
    name: "Carol Chen",
    bloomLevel: "Analyze",
    status: "rejected",
    points: 2,
  }),
  makeQuestion({
    id: "s4",
    name: "David Davis",
    bloomLevel: null,
    status: "pending",
    points: null,
  }),
];

function renderQueue(
  questions = SAMPLE_QUESTIONS,
  pointsPossible = null,
  onSave = vi.fn(),
) {
  render(Queue, { props: { questions, pointsPossible, onSave } });
  return onSave;
}

describe("Queue", () => {
  it("renders every question unfiltered, with points-only grades when pointsPossible isn't set", () => {
    renderQueue();

    expect(screen.getByText("4 of 4 question(s) shown.")).toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(5); // header + 4 data rows

    expect(screen.getAllByText("Not graded")).toHaveLength(2); // Alice and David share this
    expect(screen.getByText("4")).toBeInTheDocument(); // Bob: points only, no shared pointsPossible
    expect(screen.getByText("2")).toBeInTheDocument(); // Carol: points only
    expect(screen.getByText("Unrecognized")).toBeInTheDocument(); // David's null bloomLevel
  });

  it("formats grades against the shared pointsPossible value when it's set", () => {
    renderQueue(SAMPLE_QUESTIONS, 5);

    expect(screen.getAllByText("Not graded")).toHaveLength(2);
    expect(screen.getByText("4 / 5")).toBeInTheDocument(); // Bob
    expect(screen.getByText("2 / 5")).toBeInTheDocument(); // Carol
  });

  it("filters by status", async () => {
    renderQueue();

    await userEvent.selectOptions(screen.getByLabelText(/status/i), "accepted");

    expect(screen.getByText("1 of 4 question(s) shown.")).toBeInTheDocument();
    expect(screen.getByText("Bob Brown")).toBeInTheDocument();
    expect(screen.queryByText("Alice Anderson")).not.toBeInTheDocument();
  });

  it("shows an empty-state message when no questions match the filter", async () => {
    // Bob (accepted) and Carol (rejected) only -- neither is "pending".
    renderQueue([SAMPLE_QUESTIONS[1], SAMPLE_QUESTIONS[2]]);

    await userEvent.selectOptions(screen.getByLabelText(/status/i), "pending");

    expect(screen.getByText("0 of 2 question(s) shown.")).toBeInTheDocument();
    expect(
      screen.getByText("No questions match the current filter."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("expands a row to show the review fields when clicked, and collapses it when clicked again", async () => {
    renderQueue();

    expect(screen.queryByLabelText(/stem/i)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Bob Brown" }));

    expect(screen.getByLabelText(/stem/i)).toHaveValue("Stem for s2");

    await userEvent.click(screen.getByRole("button", { name: "Bob Brown" }));

    expect(screen.queryByLabelText(/stem/i)).not.toBeInTheDocument();
  });

  it("only expands one row at a time, auto-saving the previous row's draft when a different row is expanded", async () => {
    const onSave = renderQueue();

    await userEvent.click(
      screen.getByRole("button", { name: "Alice Anderson" }),
    );
    await userEvent.type(screen.getByLabelText(/^points/i), "3");

    await userEvent.click(screen.getByRole("button", { name: "Bob Brown" }));

    // Switching rows unmounted Alice's Detail, which auto-commits on the way
    // out (no explicit Save click needed), and mounted Bob's instead.
    expect(onSave).toHaveBeenCalledWith(
      "s1",
      expect.objectContaining({
        grade: expect.objectContaining({ points: 3 }),
      }),
    );
    expect(screen.getByLabelText(/stem/i)).toHaveValue("Stem for s2");
  });

  it("Close collapses the expanded row", async () => {
    renderQueue();

    await userEvent.click(
      screen.getByRole("button", { name: "Alice Anderson" }),
    );
    expect(screen.getByLabelText(/stem/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(screen.queryByLabelText(/stem/i)).not.toBeInTheDocument();
  });
});
