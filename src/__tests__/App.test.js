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
      id: "s1",
      submission: { student: { name: "Alice Anderson" } },
      question: { bloomLevel: "Remember" },
      original: {},
      review: { status: "pending", grade: { points: null }, wasEdited: false },
    },
  ],
  pointsPossible: 5,
  statusFilter: "pending",
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
    await waitFor(() => screen.getByText(/5 valid questions ready for review/));
    await userEvent.click(
      screen.getByRole("button", { name: /continue to review queue/i }),
    );

    await waitFor(() => screen.getByText("Alice Anderson"));

    const raw = localStorage.getItem("survey-to-qti:session");
    expect(raw).not.toBeNull();
    const saved = JSON.parse(raw);
    expect(saved.questions).toHaveLength(5);
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
