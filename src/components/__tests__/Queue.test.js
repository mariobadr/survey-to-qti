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
function makeQuestion({
  sisLoginId,
  attempt = 1,
  name,
  bloomLevel,
  status,
  points,
}) {
  const content = {
    stem: `Stem for ${sisLoginId}:${attempt}`,
    responses: { A: "A", B: "B", C: "C", D: "D" },
    feedback: { A: "FA", B: "FB", C: "FC", D: "FD" },
    correctAnswer: "A",
    bloomLevel,
    keywords: ["kw1", "kw2"],
  };
  return {
    id: `${sisLoginId}:${attempt}`,
    submission: { student: { name, sisLoginId }, attempt },
    question: { ...content },
    original: { ...content },
    review: { status, grade: { points }, wasEdited: false },
  };
}

const SAMPLE_QUESTIONS = [
  makeQuestion({
    sisLoginId: "s1",
    name: "Alice Anderson",
    bloomLevel: "Remember",
    status: "pending",
    points: null,
  }),
  makeQuestion({
    sisLoginId: "s2",
    name: "Bob Brown",
    bloomLevel: "Analyze",
    status: "accepted",
    points: 4,
  }),
  makeQuestion({
    sisLoginId: "s3",
    name: "Carol Chen",
    bloomLevel: "Analyze",
    status: "rejected",
    points: 2,
  }),
  makeQuestion({
    sisLoginId: "s4",
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

    expect(screen.getByText("4 of 4 student(s) shown.")).toBeInTheDocument();
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

    expect(screen.getByText("1 of 4 student(s) shown.")).toBeInTheDocument();
    expect(screen.getByText("Bob Brown")).toBeInTheDocument();
    expect(screen.queryByText("Alice Anderson")).not.toBeInTheDocument();
  });

  it("shows an empty-state message when no questions match the filter", async () => {
    // Bob (accepted) and Carol (rejected) only -- neither is "pending".
    renderQueue([SAMPLE_QUESTIONS[1], SAMPLE_QUESTIONS[2]]);

    await userEvent.selectOptions(screen.getByLabelText(/status/i), "pending");

    expect(screen.getByText("0 of 2 student(s) shown.")).toBeInTheDocument();
    expect(
      screen.getByText("No questions match the current filter."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("expands a row to show the review fields when clicked, and collapses it when clicked again", async () => {
    renderQueue();

    expect(screen.queryByLabelText(/stem/i)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Bob Brown" }));

    expect(screen.getByLabelText(/stem/i)).toHaveValue("Stem for s2:1");

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
      "s1:1",
      expect.objectContaining({
        grade: expect.objectContaining({ points: 3 }),
      }),
    );
    expect(screen.getByLabelText(/stem/i)).toHaveValue("Stem for s2:1");
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

describe("Queue: multiple attempts per student (Planned rework item 6)", () => {
  const MULTI_ATTEMPT_QUESTIONS = [
    makeQuestion({
      sisLoginId: "s1",
      name: "Alice Anderson",
      bloomLevel: "Remember",
      status: "pending",
      points: null,
    }),
    makeQuestion({
      sisLoginId: "s5",
      attempt: 1,
      name: "Erin Evans",
      bloomLevel: "Remember",
      status: "accepted",
      points: 1,
    }),
    makeQuestion({
      sisLoginId: "s5",
      attempt: 2,
      name: "Erin Evans",
      bloomLevel: "Apply",
      status: "pending",
      points: null,
    }),
    makeQuestion({
      sisLoginId: "s5",
      attempt: 3,
      name: "Erin Evans",
      bloomLevel: "Evaluate",
      status: "rejected",
      points: 0,
    }),
  ];

  it("shows a single attempt as plain text, not a dropdown", () => {
    renderQueue(MULTI_ATTEMPT_QUESTIONS);

    const aliceRow = screen.getByText("Alice Anderson").closest("tr");
    expect(aliceRow).toHaveTextContent("1");
    expect(
      screen.queryByLabelText(/attempt for alice anderson/i),
    ).not.toBeInTheDocument();
  });

  it("shows a dropdown labeled first/latest for a student with multiple attempts, defaulting to 'first'", () => {
    renderQueue(MULTI_ATTEMPT_QUESTIONS);

    const select = screen.getByLabelText(/attempt for erin evans/i);
    expect(select).toHaveValue("1");
    expect(
      screen.getByRole("option", { name: "1 (first)" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "2" })).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "3 (latest)" }),
    ).toBeInTheDocument();

    // Row summary columns reflect attempt 1 (accepted) by default.
    const erinRow = select.closest("tr");
    expect(erinRow).toHaveTextContent("accepted");
  });

  it("defaults to the latest attempt when defaultAttempt is 'latest'", () => {
    render(Queue, {
      props: {
        questions: MULTI_ATTEMPT_QUESTIONS,
        pointsPossible: null,
        onSave: vi.fn(),
        defaultAttempt: "latest",
      },
    });

    const select = screen.getByLabelText(/attempt for erin evans/i);
    expect(select).toHaveValue("3");
    expect(select.closest("tr")).toHaveTextContent("rejected");
  });

  it("switching the attempt dropdown updates the row summary and the expanded Detail view", async () => {
    renderQueue(MULTI_ATTEMPT_QUESTIONS);

    await userEvent.click(screen.getByRole("button", { name: "Erin Evans" }));
    expect(screen.getByLabelText(/stem/i)).toHaveValue("Stem for s5:1");

    await userEvent.selectOptions(
      screen.getByLabelText(/attempt for erin evans/i),
      "3",
    );

    // Switching attempts while expanded shows attempt 3's data -- the same
    // "switching auto-commits the outgoing draft" behavior as switching to
    // a different student's row.
    expect(screen.getByLabelText(/stem/i)).toHaveValue("Stem for s5:3");
    expect(screen.getByLabelText(/attempt for erin evans/i)).toHaveValue("3");
  });

  it("shows no mismatch warning when the selected attempt is the accepted one", () => {
    renderQueue(MULTI_ATTEMPT_QUESTIONS);

    // Defaults to attempt 1, which is also the accepted one.
    expect(
      screen.queryByText(/accepted but not graded/i),
    ).not.toBeInTheDocument();
  });

  it("warns when an accepted attempt isn't the one selected for grading", async () => {
    renderQueue(MULTI_ATTEMPT_QUESTIONS);

    // Attempt 1 is accepted; switching the dropdown to attempt 2 (pending)
    // leaves attempt 1's grade out of the gradebook -- the row should flag
    // that explicitly rather than let it pass silently.
    await userEvent.selectOptions(
      screen.getByLabelText(/attempt for erin evans/i),
      "2",
    );

    expect(
      screen.getByText(/attempt 1 accepted but not graded/i),
    ).toBeInTheDocument();
  });
});
