import { describe, expect, it } from "vitest";
import { codeFenceInfo, codeLanguageToken, integerInRange, positiveInteger, safeColor, slugify, Slugger } from "./render-utils";

describe("render utilities", () => {
  it("accepts only known color tokens", () => {
    expect(safeColor("blue")).toBe("blue");
    expect(safeColor("javascript:alert(1)", "gray")).toBe("gray");
  });

  it("normalizes heading slugs", () => {
    expect(slugify("Gloss Markdown — Complete Reference")).toBe("gloss-markdown-complete-reference");
  });

  it("preserves underscores in slugs (matching GitHub)", () => {
    expect(slugify("Hello_World")).toBe("hello_world");
    expect(slugify("snake_case_name")).toBe("snake_case_name");
  });

  it("de-duplicates repeated heading slugs like GitHub", () => {
    const slugger = new Slugger();
    expect(slugger.slug("Setup")).toBe("setup");
    expect(slugger.slug("Setup")).toBe("setup-1");
    expect(slugger.slug("Setup")).toBe("setup-2");
    // A heading that collides with an already-suffixed slug keeps advancing.
    expect(slugger.slug("Other")).toBe("other");
    expect(slugger.slug("setup-1")).toBe("setup-1-1");
  });

  it("rejects unsafe code language class tokens", () => {
    expect(codeLanguageToken("ts")).toBe("ts");
    expect(codeLanguageToken('ts" onclick="alert(1)')).toBe("");
    expect(codeLanguageToken("x".repeat(41))).toBe("");
  });

  it("parses filename attributes from code fence info strings", () => {
    expect(codeFenceInfo('ts filename="src/greet.ts"')).toEqual({
      language: "ts",
      filename: "src/greet.ts",
    });
  });

  it("parses only full positive integer tokens", () => {
    expect(positiveInteger("2")).toBe(2);
    expect(positiveInteger("2abc")).toBeNull();
    expect(positiveInteger("0")).toBeNull();
  });

  it("treats out-of-range integers as invalid", () => {
    expect(integerInRange("3", 1, 6)).toBe(3);
    expect(integerInRange("7", 1, 6)).toBeNull();
  });
});
