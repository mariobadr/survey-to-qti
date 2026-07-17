// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EXPECTED_COLUMN_COUNT,
  METADATA_FIELDS,
  QUESTION_ANSWER_FIELDS,
} from "../../csv/columnLayout.js";
import Upload from "../Upload.svelte";

// @testing-library/svelte's auto-cleanup relies on global beforeEach/afterEach,
// which this project doesn't enable (tests import from "vitest" explicitly) --
// so cleanup is registered explicitly instead.
afterEach(() => cleanup());

// Fabricated fixture (see tools/generate_fixture_csv.py) -- not real Canvas data.
// Resolved from the CWD (vitest always runs from the project root) rather than
// import.meta.url, since jsdom's fake origin breaks fileURLToPath(import.meta.url).
const FIXTURE_PATH = path.join(
  process.cwd(),
  "fixtures",
  "fabricated-survey-export.csv",
);
const fixtureCsv = readFileSync(FIXTURE_PATH, "utf-8");

function csvFile(text, name = "upload.csv") {
  return new File([text], name, { type: "text/csv" });
}

// A minimal, structurally-valid, non-empty data row -- content doesn't need
// to be realistic (no Bloom-level/correct-answer normalization matters
// here), just the right column count with all 12 answer fields filled in.
function makeValidRow(i) {
  const metadata = [
    `Student ${i}`,
    `${1000 + i}`,
    `sis${i}`,
    "LEC0101",
    "200001",
    "CSC101-F-LEC0101-20269",
    "2026-05-31 04:00:00 UTC",
    "1",
  ];
  const answers = QUESTION_ANSWER_FIELDS.flatMap((field) => [
    `${field}-${i}`,
    "1.0",
  ]);
  const trailing = ["1", "0", "1.0"];
  return [...metadata, ...answers, ...trailing].join(",");
}

async function uploadFile(text, name) {
  const onParsed = vi.fn();
  render(Upload, { props: { onParsed } });
  const input = screen.getByLabelText(/canvas survey csv export/i);
  await userEvent.upload(input, csvFile(text, name));
  return onParsed;
}

describe("Upload", () => {
  it("shows the default-attempt picker but no Continue button before a file is chosen", () => {
    render(Upload, { props: { onParsed: vi.fn() } });

    expect(screen.getByLabelText(/default attempt/i)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /continue to review queue/i }),
    ).not.toBeInTheDocument();
  });

  it("parses the fabricated fixture without repeating non-blocking warnings, and enables Continue", async () => {
    await uploadFile(fixtureCsv, "fabricated-survey-export.csv");

    const continueButton = await screen.findByRole("button", {
      name: /continue to review queue/i,
    });
    expect(continueButton).toBeEnabled();

    // Non-blocking parse warnings (missing fields, empty rows, unrecognized
    // values, ...) resurface during review instead of being listed here --
    // but Erin Evans (missing one field) is still a valid, previewed row;
    // only Grace Green (completely empty, excluded entirely) is absent.
    expect(screen.queryByText(/total rows parsed/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Grace Green/)).not.toBeInTheDocument();
    expect(screen.getByText("Erin Evans")).toBeInTheDocument();
    expect(screen.queryByText(/missing feedbackD/)).not.toBeInTheDocument();
    expect(screen.queryByText(/warning/i)).not.toBeInTheDocument();
  });

  it("previews every valid parsed row in a table", async () => {
    await uploadFile(fixtureCsv, "fabricated-survey-export.csv");
    await screen.findByRole("button", { name: /continue to review queue/i });

    expect(
      screen.getByRole("columnheader", { name: "Student" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Alice Anderson")).toBeInTheDocument();
    expect(
      screen.getByText("What is the base case of a recursive function?"),
    ).toBeInTheDocument();
    // David Davis has two attempts -- both should be previewed as separate rows.
    expect(screen.getAllByText("David Davis")).toHaveLength(2);
  });

  it("caps the preview at 50 rows and notes how many more exist", async () => {
    const header = Array.from(
      { length: EXPECTED_COLUMN_COUNT },
      (_, i) => `col${i}`,
    ).join(",");
    const rows = Array.from({ length: 60 }, (_, i) => makeValidRow(i + 1));
    const csv = `${header}\n${rows.join("\n")}\n`;

    await uploadFile(csv, "many-rows.csv");
    await screen.findByRole("button", { name: /continue to review queue/i });

    expect(screen.getAllByRole("row")).toHaveLength(51); // header row + 50 preview rows
    expect(
      screen.getByText("Showing the first 50 of 60 rows."),
    ).toBeInTheDocument();
  });

  it("calls onParsed with all 7 questions (David Davis's two attempts both kept) and the chosen default attempt", async () => {
    const onParsed = await uploadFile(
      fixtureCsv,
      "fabricated-survey-export.csv",
    );
    const continueButton = await screen.findByRole("button", {
      name: /continue to review queue/i,
    });

    await userEvent.selectOptions(
      screen.getByLabelText(/default attempt/i),
      "latest",
    );
    await userEvent.click(continueButton);

    expect(onParsed).toHaveBeenCalledTimes(1);
    const [questions, defaultAttempt] = onParsed.mock.calls[0];
    expect(questions).toHaveLength(7);
    expect(questions.map((q) => q.submission.student.name)).toEqual([
      "Alice Anderson",
      "Bob Brown",
      "Carol Chen",
      "David Davis",
      "David Davis",
      "Erin Evans",
      "Frank Foster",
    ]);
    expect(defaultAttempt).toBe("latest");
  });

  it("warns and confirms before replacing already-loaded questions, and skips onParsed if canceled", async () => {
    const onParsed = vi.fn();
    render(Upload, { props: { onParsed, hasExistingQuestions: true } });

    expect(
      screen.getByText(/questions from an earlier upload are already loaded/i),
    ).toBeInTheDocument();

    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const input = screen.getByLabelText(/canvas survey csv export/i);
    await userEvent.upload(
      input,
      csvFile(fixtureCsv, "fabricated-survey-export.csv"),
    );
    const continueButton = await screen.findByRole("button", {
      name: /continue to review queue/i,
    });
    await userEvent.click(continueButton);

    expect(confirmSpy).toHaveBeenCalled();
    expect(onParsed).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("calls onParsed once replacing already-loaded questions is confirmed", async () => {
    const onParsed = vi.fn();
    render(Upload, { props: { onParsed, hasExistingQuestions: true } });

    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const input = screen.getByLabelText(/canvas survey csv export/i);
    await userEvent.upload(
      input,
      csvFile(fixtureCsv, "fabricated-survey-export.csv"),
    );
    const continueButton = await screen.findByRole("button", {
      name: /continue to review queue/i,
    });
    await userEvent.click(continueButton);

    expect(onParsed).toHaveBeenCalledTimes(1);
    confirmSpy.mockRestore();
  });

  it("disables Continue and shows an error for a structurally invalid CSV", async () => {
    const header = Array.from(
      { length: EXPECTED_COLUMN_COUNT },
      (_, i) => `col${i}`,
    ).join(",");
    const truncatedRow = METADATA_FIELDS.map((f) => `bad-${f}`).join(",");
    const badCsv = `${header}\n${truncatedRow}\n`;

    await uploadFile(badCsv, "bad.csv");

    await waitFor(() =>
      screen.getByText(/don't match the expected column layout/),
    );

    const continueButton = screen.getByRole("button", {
      name: /continue to review queue/i,
    });
    expect(continueButton).toBeDisabled();
    expect(
      screen.getByText(/no valid questions were found/),
    ).toBeInTheDocument();
  });
});
