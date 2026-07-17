// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

// `pyodideRuntime.js` caches its runtime promise in a module-level
// variable, so each test needs a fresh module instance (via
// vi.resetModules() + a dynamic import) to avoid leaking state between
// tests -- otherwise only the first test would ever actually call
// window.loadPyodide.
async function freshModule() {
  vi.resetModules();
  return import("../pyodideRuntime.js");
}

function makeFakePyodide() {
  return {
    loadPackage: vi.fn().mockResolvedValue(undefined),
    pyimport: vi.fn().mockReturnValue({
      install: vi.fn().mockResolvedValue(undefined),
    }),
  };
}

afterEach(() => {
  delete window.loadPyodide;
  for (const s of document.head.querySelectorAll("script")) {
    s.remove();
  }
  vi.restoreAllMocks();
});

describe("getPyodideRuntime", () => {
  it("loads Pyodide, installs micropip + text2qti, and returns the runtime", async () => {
    const fakePyodide = makeFakePyodide();
    window.loadPyodide = vi.fn().mockResolvedValue(fakePyodide);

    const { getPyodideRuntime } = await freshModule();
    const runtime = await getPyodideRuntime();

    expect(runtime).toBe(fakePyodide);
    expect(fakePyodide.loadPackage).toHaveBeenCalledWith("micropip");
    expect(fakePyodide.pyimport).toHaveBeenCalledWith("micropip");
    expect(fakePyodide.pyimport().install).toHaveBeenCalledWith("text2qti");
  });

  it("does not inject a <script> tag if window.loadPyodide already exists", async () => {
    window.loadPyodide = vi.fn().mockResolvedValue(makeFakePyodide());

    const { getPyodideRuntime } = await freshModule();
    await getPyodideRuntime();

    expect(document.head.querySelector("script")).toBeNull();
  });

  it("injects a <script> tag pointing at the Pyodide CDN when not already loaded", async () => {
    const { getPyodideRuntime } = await freshModule();
    const promise = getPyodideRuntime();

    const script = document.head.querySelector("script");
    expect(script).not.toBeNull();
    expect(script.src).toContain("cdn.jsdelivr.net/pyodide/");

    // Simulate the script finishing its network load, then make
    // window.loadPyodide available the way the real script would.
    window.loadPyodide = vi.fn().mockResolvedValue(makeFakePyodide());
    script.onload();

    await expect(promise).resolves.toBeDefined();
  });

  it("caches the runtime -- window.loadPyodide is only called once across repeated calls", async () => {
    window.loadPyodide = vi.fn().mockResolvedValue(makeFakePyodide());

    const { getPyodideRuntime } = await freshModule();
    await getPyodideRuntime();
    await getPyodideRuntime();

    expect(window.loadPyodide).toHaveBeenCalledTimes(1);
  });

  it("does not cache a failed attempt, so the next call can retry and succeed", async () => {
    window.loadPyodide = vi
      .fn()
      .mockRejectedValueOnce(new Error("network error"))
      .mockResolvedValueOnce(makeFakePyodide());

    const { getPyodideRuntime } = await freshModule();
    await expect(getPyodideRuntime()).rejects.toThrow("network error");
    await expect(getPyodideRuntime()).resolves.toBeDefined();

    expect(window.loadPyodide).toHaveBeenCalledTimes(2);
  });
});
