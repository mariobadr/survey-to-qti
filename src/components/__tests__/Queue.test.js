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
    grade: { points: null, pointsPossible: null },
  }),
  makeQuestion({
    id: "s2",
    name: "Bob Brown",
    bloomLevel: "Analyze",
    status: "accepted",
    grade: { points: 4, pointsPossible: 5 },
  }),
  makeQuestion({
    id: "s3",
    name: "Carol Chen",
    bloomLevel: "Analyze",
    status: "rejected",
    grade: { points: 2, pointsPossible: null },
  }),
  makeQuestion({
    id: "s4",
    name: "David Davis",
    bloomLevel: null,
    status: "pending",
    grade: { points: null, pointsPossible: null },
  }),
];

function renderQueue(questions = SAMPLE_QUESTIONS) {
  const onSelect = vi.fn();
  render(Queue, { props: { questions, onSelect } });
  return onSelect;
}

describe("Queue", () => {
  it("renders every question unfiltered, with formatted grades and an unrecognized Bloom level fallback", () => {
    renderQueue();

    expect(screen.getByText("4 of 4 question(s) shown.")).toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(5); // header + 4 data rows

    expect(screen.getAllByText("Not graded")).toHaveLength(2); // Alice and David share this
    expect(screen.getByText("4 / 5")).toBeInTheDocument(); // Bob: points and pointsPossible
    expect(screen.getByText("2")).toBeInTheDocument(); // Carol: points only
    expect(screen.getByText("Unrecognized")).toBeInTheDocument(); // David's null bloomLevel
  });

  it("filters by Bloom level", async () => {
    renderQueue();

    await userEvent.selectOptions(
      screen.getByLabelText(/bloom level/i),
      "Analyze",
    );

    expect(screen.getByText("2 of 4 question(s) shown.")).toBeInTheDocument();
    expect(screen.getByText("Bob Brown")).toBeInTheDocument();
    expect(screen.getByText("Carol Chen")).toBeInTheDocument();
    expect(screen.queryByText("Alice Anderson")).not.toBeInTheDocument();
    expect(screen.queryByText("David Davis")).not.toBeInTheDocument();
  });

  it("filters by status", async () => {
    renderQueue();

    await userEvent.selectOptions(screen.getByLabelText(/status/i), "accepted");

    expect(screen.getByText("1 of 4 question(s) shown.")).toBeInTheDocument();
    expect(screen.getByText("Bob Brown")).toBeInTheDocument();
    expect(screen.queryByText("Alice Anderson")).not.toBeInTheDocument();
  });

  it("shows an empty-state message when no questions match both filters", async () => {
    renderQueue();

    await userEvent.selectOptions(screen.getByLabelText(/status/i), "rejected");
    await userEvent.selectOptions(
      screen.getByLabelText(/bloom level/i),
      "Remember",
    );

    expect(screen.getByText("0 of 4 question(s) shown.")).toBeInTheDocument();
    expect(
      screen.getByText("No questions match the current filters."),
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
