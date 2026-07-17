import { describe, expect, it, vi } from "vitest";
import { generateQtiZip } from "../generateQtiZip.js";
import { getPyodideRuntime } from "../pyodideRuntime.js";

vi.mock("../pyodideRuntime.js", () => ({
  getPyodideRuntime: vi.fn(),
}));

function makeFakePyodide(zipBytes) {
  const zipPyProxy = {
    toJs: vi.fn().mockReturnValue(zipBytes),
    destroy: vi.fn(),
  };
  return {
    pyodide: {
      globals: { set: vi.fn() },
      runPythonAsync: vi.fn().mockResolvedValue(zipPyProxy),
    },
    zipPyProxy,
  };
}

describe("generateQtiZip", () => {
  it("sets quiz_text as a Pyodide global and returns the zip bytes", async () => {
    const zipBytes = new Uint8Array([1, 2, 3]);
    const { pyodide, zipPyProxy } = makeFakePyodide(zipBytes);
    getPyodideRuntime.mockResolvedValue(pyodide);

    const result = await generateQtiZip("Quiz title: X\n");

    expect(pyodide.globals.set).toHaveBeenCalledWith(
      "quiz_text",
      "Quiz title: X\n",
    );
    expect(pyodide.runPythonAsync).toHaveBeenCalledWith(
      expect.stringContaining("QTI"),
    );
    expect(result).toBe(zipBytes);
    expect(zipPyProxy.destroy).toHaveBeenCalledTimes(1);
  });

  it("still destroys the Python proxy if toJs() throws", async () => {
    const { pyodide, zipPyProxy } = makeFakePyodide(null);
    zipPyProxy.toJs.mockImplementation(() => {
      throw new Error("boom");
    });
    getPyodideRuntime.mockResolvedValue(pyodide);

    await expect(generateQtiZip("text")).rejects.toThrow("boom");
    expect(zipPyProxy.destroy).toHaveBeenCalledTimes(1);
  });
});
