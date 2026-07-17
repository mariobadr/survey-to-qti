// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../App.svelte";
import { saveSession } from "../persistence/session.js";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

// Fabricated fixture (see tools/generate_fixture_csv.py) -- not real Canvas data.
const FIXTURE_PATH = path.join(
  process.cwd(),
  "fixtures",
  "fabricated-survey-export.csv",
);
const fixtureCsv = readFileSync(FIXTURE_PATH, "utf-8");

const SAVED_SESSION = {
  questions: [
    {
      id: "s1:1",
      submission: {
        student: { name: "Alice Anderson", sisLoginId: "s1" },
        attempt: 1,
      },
      question: { bloomLevel: "Remember" },
      original: {},
      review: { status: "pending", grade: { points: null }, wasEdited: false },
    },
  ],
  pointsPossible: 5,
  statusFilter: "pending",
  attemptSelection: {},
  defaultAttempt: "first",
};

describe("App: resume flow", () => {
  it("goes straight to Upload when there's no saved session", () => {
    render(App);

    expect(
      screen.getByRole("heading", { name: /^upload$/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/resume previous session/i),
    ).not.toBeInTheDocument();
  });

  it("shows a resume prompt instead of Upload when a saved session exists", () => {
    saveSession(SAVED_SESSION);

    render(App);

    expect(screen.getByText(/resume previous session/i)).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: /^upload$/i }),
    ).not.toBeInTheDocument();
  });

  it("Resume restores the saved questions/pointsPossible/statusFilter and shows the queue", async () => {
    saveSession(SAVED_SESSION);
    render(App);

    await userEvent.click(screen.getByRole("button", { name: "Resume" }));

    expect(screen.getByText("Alice Anderson")).toBeInTheDocument();
    expect(screen.getByText("Current: 5")).toBeInTheDocument();
    expect(screen.getByLabelText(/status/i)).toHaveValue("pending");
  });

  it("Start over clears the saved session and shows Upload", async () => {
    saveSession(SAVED_SESSION);
    render(App);

    await userEvent.click(screen.getByRole("button", { name: "Start over" }));

    expect(
      screen.getByRole("heading", { name: /^upload$/i }),
    ).toBeInTheDocument();

    // A second App instance (e.g. after a refresh) should no longer see
    // anything to resume.
    cleanup();
    render(App);
    expect(
      screen.queryByText(/resume previous session/i),
    ).not.toBeInTheDocument();
  });
});

describe("App: autosave", () => {
  it("autosaves after continuing from a fresh CSV upload", async () => {
    render(App);

    const input = screen.getByLabelText(/canvas survey csv export/i);
    await userEvent.upload(
      input,
      new File([fixtureCsv], "fabricated-survey-export.csv", {
        type: "text/csv",
      }),
    );
    await userEvent.click(
      await screen.findByRole("button", { name: /upload this data/i }),
    );

    await waitFor(() => screen.getByText("Alice Anderson"));

    const raw = localStorage.getItem("survey-to-qti:session");
    expect(raw).not.toBeNull();
    const saved = JSON.parse(raw);
    expect(saved.questions).toHaveLength(7);
  });

  it("shows an unobtrusive warning when autosave fails, and clears it once autosave succeeds again", async () => {
    // SAVED_SESSION's statusFilter starts at "pending" -- each change below
    // must land on a genuinely different value so the underlying $state
    // reassignment actually reruns the autosave $effect.
    saveSession(SAVED_SESSION);
    render(App);
    await userEvent.click(screen.getByRole("button", { name: "Resume" }));

    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("QuotaExceededError");
      });

    await userEvent.selectOptions(screen.getByLabelText(/status/i), "accepted");

    expect(screen.getByRole("status")).toHaveTextContent(
      /autosave isn't working/i,
    );

    setItem.mockRestore();
    await userEvent.selectOptions(screen.getByLabelText(/status/i), "rejected");

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});

describe("App: nav bar, pointsPossible default, and grade scaling", () => {
  async function uploadAndContinue() {
    render(App);

    const input = screen.getByLabelText(/canvas survey csv export/i);
    await userEvent.upload(
      input,
      new File([fixtureCsv], "fabricated-survey-export.csv", {
        type: "text/csv",
      }),
    );
    await userEvent.click(
      await screen.findByRole("button", { name: /upload this data/i }),
    );
    await waitFor(() => screen.getByText("Alice Anderson"));
  }

  it("defaults pointsPossible to 1", async () => {
    await uploadAndContinue();

    expect(screen.getByText("Current: 1")).toBeInTheDocument();
  });

  it("scales an already-entered grade and notifies the TA when pointsPossible changes", async () => {
    await uploadAndContinue();

    // Grade Alice's question 0.5 out of the default 1 point possible.
    await userEvent.click(
      screen.getByRole("button", { name: "Alice Anderson" }),
    );
    await userEvent.type(screen.getByLabelText(/^points:/i), "0.5");
    await userEvent.click(
      screen.getByRole("button", { name: "Save and Close" }),
    );

    // Change points possible from 1 to 2.
    const pointsPossibleInput = screen.getByLabelText(/points possible/i);
    await userEvent.clear(pointsPossibleInput);
    await userEvent.type(pointsPossibleInput, "2");
    await userEvent.click(screen.getByRole("button", { name: "Set" }));

    expect(screen.getByText("Current: 2")).toBeInTheDocument();
    expect(
      screen.getByText(/scaled 1 existing grade.*out of 1.*out of 2/i),
    ).toBeInTheDocument();

    // 0.5 out of 1 scaled to out of 2 is 1.
    await userEvent.click(
      screen.getByRole("button", { name: "Alice Anderson" }),
    );
    expect(screen.getByLabelText(/^points:/i)).toHaveValue(1);
  });

  it("shows no scaling notice when there's nothing to scale (no grades entered yet)", async () => {
    await uploadAndContinue();

    const pointsPossibleInput = screen.getByLabelText(/points possible/i);
    await userEvent.clear(pointsPossibleInput);
    await userEvent.type(pointsPossibleInput, "2");
    await userEvent.click(screen.getByRole("button", { name: "Set" }));

    expect(screen.getByText("Current: 2")).toBeInTheDocument();
    expect(screen.queryByText(/scaled/i)).not.toBeInTheDocument();
  });

  it("disables Set and shows an error for a negative draft, without committing", async () => {
    await uploadAndContinue();

    const pointsPossibleInput = screen.getByLabelText(/points possible/i);
    await userEvent.clear(pointsPossibleInput);
    await userEvent.type(pointsPossibleInput, "-1");

    expect(screen.getByRole("button", { name: "Set" })).toBeDisabled();
    expect(
      screen.getByText(/points possible can't be negative/i),
    ).toBeInTheDocument();
    expect(screen.getByText("Current: 1")).toBeInTheDocument();
  });

  it("Review and Export tabs are disabled until a file is uploaded, then enabled", async () => {
    render(App);

    expect(screen.getByRole("button", { name: "Review" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Export" })).toBeDisabled();

    const input = screen.getByLabelText(/canvas survey csv export/i);
    await userEvent.upload(
      input,
      new File([fixtureCsv], "fabricated-survey-export.csv", {
        type: "text/csv",
      }),
    );
    await userEvent.click(
      await screen.findByRole("button", { name: /upload this data/i }),
    );
    await waitFor(() => screen.getByText("Alice Anderson"));

    expect(screen.getByRole("button", { name: "Review" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Export" })).toBeEnabled();
  });

  it("lets the TA freely navigate between Upload, Review, and Export via the nav bar", async () => {
    await uploadAndContinue();

    await userEvent.click(screen.getByRole("button", { name: "Export" }));
    expect(
      screen.getByRole("heading", { name: /^export$/i }),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Upload" }));
    expect(
      screen.getByRole("heading", { name: /^upload$/i }),
    ).toBeInTheDocument();
    // Navigating to Upload doesn't discard the already-loaded questions.
    expect(
      screen.getByText(/questions from an earlier upload are already loaded/i),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Review" }));
    expect(screen.getByText("Alice Anderson")).toBeInTheDocument();
  });

  it("confirms before replacing already-loaded questions with a new upload, and does nothing if canceled", async () => {
    await uploadAndContinue();
    await userEvent.click(screen.getByRole("button", { name: "Upload" }));

    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const input = screen.getByLabelText(/canvas survey csv export/i);
    await userEvent.upload(
      input,
      new File([fixtureCsv], "fabricated-survey-export.csv", {
        type: "text/csv",
      }),
    );
    await userEvent.click(
      await screen.findByRole("button", { name: /overwrite the old data/i }),
    );

    expect(confirmSpy).toHaveBeenCalled();
    // Still on Upload (canceled) -- the nav didn't switch to Review.
    expect(
      screen.getByRole("heading", { name: /^upload$/i }),
    ).toBeInTheDocument();

    confirmSpy.mockRestore();
  });

  it("replaces already-loaded questions with a new upload once confirmed", async () => {
    await uploadAndContinue();
    await userEvent.click(screen.getByRole("button", { name: "Upload" }));

    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const input = screen.getByLabelText(/canvas survey csv export/i);
    await userEvent.upload(
      input,
      new File([fixtureCsv], "fabricated-survey-export.csv", {
        type: "text/csv",
      }),
    );
    await userEvent.click(
      await screen.findByRole("button", { name: /overwrite the old data/i }),
    );

    expect(screen.getByText("Alice Anderson")).toBeInTheDocument();
    confirmSpy.mockRestore();
  });

  it("allows 0 as points possible and scales an existing grade down to 0", async () => {
    await uploadAndContinue();

    await userEvent.click(
      screen.getByRole("button", { name: "Alice Anderson" }),
    );
    await userEvent.type(screen.getByLabelText(/^points:/i), "0.5");
    await userEvent.click(
      screen.getByRole("button", { name: "Save and Close" }),
    );

    const pointsPossibleInput = screen.getByLabelText(/points possible/i);
    await userEvent.clear(pointsPossibleInput);
    await userEvent.type(pointsPossibleInput, "0");
    await userEvent.click(screen.getByRole("button", { name: "Set" }));

    expect(screen.getByText("Current: 0")).toBeInTheDocument();
    expect(
      screen.getByText(/scaled 1 existing grade.*out of 1.*out of 0/i),
    ).toBeInTheDocument();

    await userEvent.click(
      screen.getByRole("button", { name: "Alice Anderson" }),
    );
    expect(screen.getByLabelText(/^points:/i)).toHaveValue(0);
  });
});
