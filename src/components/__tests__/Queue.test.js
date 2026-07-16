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

function makeQuestion({ id, name, bloomLevel, status, grade }) {
  return {
    id,
    submission: { student: { name } },
    question: { bloomLevel },
    review: { status, grade },
  };
}

const SAMPLE_QUESTIONS = [
  makeQuestion({
    id: "s1",
    name: "Alice Anderson",
    bloomLevel: "Remember",
    status: "pending",
    grade: { points: null },
  }),
  makeQuestion({
    id: "s2",
    name: "Bob Brown",
    bloomLevel: "Analyze",
    status: "accepted",
    grade: { points: 4 },
  }),
  makeQuestion({
    id: "s3",
    name: "Carol Chen",
    bloomLevel: "Analyze",
    status: "rejected",
    grade: { points: 2 },
  }),
  makeQuestion({
    id: "s4",
    name: "David Davis",
    bloomLevel: null,
    status: "pending",
    grade: { points: null },
  }),
];

function renderQueue(questions = SAMPLE_QUESTIONS, pointsPossible = null) {
  const onSelect = vi.fn();
  render(Queue, { props: { questions, pointsPossible, onSelect } });
  return onSelect;
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

  it("calls onSelect with the question's id when its row is clicked", async () => {
    const onSelect = renderQueue();

    await userEvent.click(screen.getByRole("button", { name: "Bob Brown" }));

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith("s2", ["s1", "s2", "s3", "s4"]);
  });
});
