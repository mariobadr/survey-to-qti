import { describe, expect, it } from "vitest";
import {
  isKeywordCountExpected,
  normalizeBloomLevel,
  normalizeCorrectAnswer,
  parseKeywords,
  wordCount,
} from "../fieldNormalization.js";

describe("normalizeBloomLevel", () => {
  it("accepts exact Bloom taxonomy option text", () => {
    expect(normalizeBloomLevel("Analyze")).toBe("Analyze");
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeBloomLevel("  Create \n")).toBe("Create");
  });

  it("returns null for unrecognized text", () => {
    expect(normalizeBloomLevel("Applying")).toBeNull();
    expect(normalizeBloomLevel("")).toBeNull();
  });
});

describe("normalizeCorrectAnswer", () => {
  it("accepts the literal letters A-D", () => {
    for (const letter of ["A", "B", "C", "D"]) {
      expect(normalizeCorrectAnswer(letter)).toBe(letter);
    }
  });

  it("returns null for anything else, e.g. full option text", () => {
    expect(normalizeCorrectAnswer("Option A")).toBeNull();
    expect(normalizeCorrectAnswer("a")).toBeNull();
    expect(normalizeCorrectAnswer("")).toBeNull();
  });
});

describe("parseKeywords", () => {
  it("splits, trims, and drops empty pieces", () => {
    expect(parseKeywords("recursion, base case ,  , loops")).toEqual([
      "recursion",
      "base case",
      "loops",
    ]);
  });

  it("returns an empty array for blank input", () => {
    expect(parseKeywords("")).toEqual([]);
  });
});

describe("isKeywordCountExpected", () => {
  it("accepts 2-4 keywords", () => {
    expect(isKeywordCountExpected(["a", "b"])).toBe(true);
    expect(isKeywordCountExpected(["a", "b", "c", "d"])).toBe(true);
  });

  it("rejects fewer than 2 or more than 4", () => {
    expect(isKeywordCountExpected(["a"])).toBe(false);
    expect(isKeywordCountExpected(["a", "b", "c", "d", "e"])).toBe(false);
  });
});

describe("wordCount", () => {
  it("counts whitespace-separated words", () => {
    expect(wordCount("What is the capital of France?")).toBe(6);
  });

  it("treats blank/whitespace-only text as zero words", () => {
    expect(wordCount("")).toBe(0);
    expect(wordCount("   ")).toBe(0);
  });
});
