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

async function uploadFile(text, name) {
  const onParsed = vi.fn();
  render(Upload, { props: { onParsed } });
  const input = screen.getByLabelText(/canvas survey csv export/i);
  await userEvent.upload(input, csvFile(text, name));
  return onParsed;
}

describe("Upload", () => {
  it("shows no summary before a file is chosen", () => {
    render(Upload, { props: { onParsed: vi.fn() } });
    expect(screen.queryByText(/total rows parsed/)).not.toBeInTheDocument();
  });

  it("parses the fabricated fixture and shows the summary, with Continue enabled", async () => {
    await uploadFile(fixtureCsv, "fabricated-survey-export.csv");

    await waitFor(() => screen.getByText(/7 total rows parsed/));
    expect(
      screen.getByText(/5 valid questions ready for review/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Erin Evans/)).toBeInTheDocument();
    expect(screen.getByText(/missing feedbackD/)).toBeInTheDocument();
    expect(screen.getByText(/3 other warning\(s\)/)).toBeInTheDocument();

    const continueButton = screen.getByRole("button", {
      name: /continue to review queue/i,
    });
    expect(continueButton).toBeEnabled();
  });

  it("calls onParsed with the 5 deduped, complete questions when Continue is clicked", async () => {
    const onParsed = await uploadFile(
      fixtureCsv,
      "fabricated-survey-export.csv",
    );
    await waitFor(() => screen.getByText(/5 valid questions ready for review/));

    await userEvent.click(
      screen.getByRole("button", { name: /continue to review queue/i }),
    );

    expect(onParsed).toHaveBeenCalledTimes(1);
    const questions = onParsed.mock.calls[0][0];
    expect(questions).toHaveLength(5);
    expect(questions.map((q) => q.submission.student.name)).toEqual([
      "Alice Anderson",
      "Bob Brown",
      "Carol Chen",
      "David Davis",
      "Frank Foster",
    ]);
  });

  it("disables Continue and shows an error for a structurally invalid CSV", async () => {
    const header = Array.from(
      { length: EXPECTED_COLUMN_COUNT },
      (_, i) => `col${i}`,
    ).join(",");
    const truncatedRow = METADATA_FIELDS.map((f) => `bad-${f}`).join(",");
    const badCsv = `${header}\n${truncatedRow}\n`;

    await uploadFile(badCsv, "bad.csv");

    await waitFor(() => screen.getByText(/1 total rows parsed/));
    expect(
      screen.getByText(/don't match the expected column layout/),
    ).toBeInTheDocument();

    const continueButton = screen.getByRole("button", {
      name: /continue to review queue/i,
    });
    expect(continueButton).toBeDisabled();
    expect(
      screen.getByText(/no valid questions were found/),
    ).toBeInTheDocument();
  });
});
