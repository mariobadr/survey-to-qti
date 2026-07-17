// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateQtiZip } from "../../qti/generateQtiZip.js";
import Export from "../Export.svelte";

vi.mock("../../qti/generateQtiZip.js", () => ({
  generateQtiZip: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function makeQuestion(id, status, points = null) {
  return {
    id,
    submission: {
      student: { name: `Student ${id}`, canvasId: id, sisLoginId: id },
      section: { name: "Section 1" },
    },
    question: {
      stem: `Stem ${id}`,
      responses: { A: "A", B: "B", C: "C", D: "D" },
      feedback: { A: "fA", B: "fB", C: "fC", D: "fD" },
      correctAnswer: "A",
    },
    review: { status, grade: { points } },
  };
}

const SAMPLE_QUESTIONS = [
  makeQuestion("s1", "accepted"),
  makeQuestion("s2", "accepted"),
  makeQuestion("s3", "rejected"),
  makeQuestion("s4", "pending"),
];

describe("Export: summary counts", () => {
  it("shows accepted/rejected/pending counts", () => {
    render(Export, {
      props: {
        questions: SAMPLE_QUESTIONS,
        pointsPossible: 1,
        onBack: vi.fn(),
      },
    });

    expect(screen.getByText("2 accepted")).toBeInTheDocument();
    expect(screen.getByText("1 rejected")).toBeInTheDocument();
    expect(screen.getByText("1 pending")).toBeInTheDocument();
  });

  it("calls onBack when 'Back to review' is clicked", async () => {
    const onBack = vi.fn();
    render(Export, {
      props: { questions: SAMPLE_QUESTIONS, pointsPossible: 1, onBack },
    });

    await userEvent.click(
      screen.getByRole("button", { name: /back to review/i }),
    );

    expect(onBack).toHaveBeenCalledTimes(1);
  });
});

describe("Export: with no accepted questions", () => {
  it("disables Download and shows a warning", () => {
    render(Export, {
      props: {
        questions: [
          makeQuestion("s1", "rejected"),
          makeQuestion("s2", "pending"),
        ],
        pointsPossible: 1,
        onBack: vi.fn(),
      },
    });

    expect(
      screen.getByRole("button", { name: /download qti package/i }),
    ).toBeDisabled();
    expect(screen.getByText(/no accepted questions yet/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /download gradebook csv/i }),
    ).toBeEnabled();
  });
});

describe("Export: downloading", () => {
  beforeEach(() => {
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn(() => "blob:mock-url"),
      revokeObjectURL: vi.fn(),
    });
  });

  it("generates and downloads the QTI zip on success", async () => {
    const zipBytes = new Uint8Array([1, 2, 3]);
    generateQtiZip.mockResolvedValue(zipBytes);
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});

    render(Export, {
      props: {
        questions: SAMPLE_QUESTIONS,
        pointsPossible: 1,
        onBack: vi.fn(),
      },
    });

    await userEvent.click(
      screen.getByRole("button", { name: /download qti package/i }),
    );

    await waitFor(() => screen.getByText(/downloaded/i));

    expect(generateQtiZip).toHaveBeenCalledWith(
      expect.stringContaining("Quiz title:"),
    );
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:mock-url");
  });

  it("shows an error message if QTI generation fails", async () => {
    generateQtiZip.mockRejectedValue(new Error("Pyodide boom"));

    render(Export, {
      props: {
        questions: SAMPLE_QUESTIONS,
        pointsPossible: 1,
        onBack: vi.fn(),
      },
    });

    await userEvent.click(
      screen.getByRole("button", { name: /download qti package/i }),
    );

    await waitFor(() => screen.getByText(/couldn't generate/i));
    expect(screen.getByText(/pyodide boom/i)).toBeInTheDocument();
  });
});

describe("Export: gradebook CSV download", () => {
  beforeEach(() => {
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn(() => "blob:mock-url"),
      revokeObjectURL: vi.fn(),
    });
  });

  it("downloads a CSV including every student regardless of status", async () => {
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});
    let blobContent = null;
    const originalBlob = globalThis.Blob;
    // biome-ignore lint/complexity/useArrowFunction: must be a real function, not an arrow, so vitest's spy can invoke it as `new Blob(...)`
    vi.spyOn(globalThis, "Blob").mockImplementation(function (parts, options) {
      blobContent = parts[0];
      return new originalBlob(parts, options);
    });

    render(Export, {
      props: {
        questions: SAMPLE_QUESTIONS,
        pointsPossible: 1,
        onBack: vi.fn(),
      },
    });

    await userEvent.click(
      screen.getByRole("button", { name: /download gradebook csv/i }),
    );

    expect(blobContent).toContain("Student s1");
    expect(blobContent).toContain("Student s3");
    expect(blobContent).toContain("Student s4");
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:mock-url");
    expect(screen.getByText(/downloaded.*gradebook csv/i)).toBeInTheDocument();
  });

  it("is enabled even when there are no accepted questions", () => {
    render(Export, {
      props: {
        questions: [makeQuestion("s1", "pending")],
        pointsPossible: 1,
        onBack: vi.fn(),
      },
    });

    expect(
      screen.getByRole("button", { name: /download gradebook csv/i }),
    ).toBeEnabled();
  });
});
