// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearSession, loadSession, saveSession } from "../session.js";

afterEach(() => localStorage.clear());

const SAMPLE_SESSION = {
  questions: [{ id: "s1", review: { status: "pending" } }],
  pointsPossible: 5,
  statusFilter: "accepted",
};

describe("saveSession / loadSession", () => {
  it("round-trips a session through localStorage, and returns true on success", () => {
    expect(saveSession(SAMPLE_SESSION)).toBe(true);

    expect(loadSession()).toEqual(SAMPLE_SESSION);
  });

  it("returns false when localStorage.setItem throws (e.g. quota exceeded)", () => {
    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("QuotaExceededError");
      });

    expect(saveSession(SAMPLE_SESSION)).toBe(false);

    setItem.mockRestore();
  });

  it("returns null when nothing has been saved", () => {
    expect(loadSession()).toBeNull();
  });

  it("returns null for a session with the wrong (or missing) schema version", () => {
    localStorage.setItem(
      "survey-to-qti:session",
      JSON.stringify({ ...SAMPLE_SESSION, schemaVersion: 999 }),
    );

    expect(loadSession()).toBeNull();
  });

  it("returns null for malformed JSON already in storage", () => {
    localStorage.setItem("survey-to-qti:session", "not json");

    expect(loadSession()).toBeNull();
  });
});

describe("clearSession", () => {
  it("removes a previously saved session", () => {
    saveSession(SAMPLE_SESSION);
    clearSession();

    expect(loadSession()).toBeNull();
  });
});
