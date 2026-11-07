// Tests for the AI code-line validator — the last line of defence before
// unbalanced AI-generated code is injected into the living editor.
import { describe, it, expect } from "vitest";
import { validateCodeLines, tokenizeLine } from "@/lib/alpha/mutations";

describe("validateCodeLines — brace balance", () => {
  it("accepts balanced code", () => {
    expect(validateCodeLines(["function foo() {", "  return 1;", "}"]).ok).toBe(true);
  });

  it("rejects unbalanced braces", () => {
    const r = validateCodeLines(["function foo() {", "  return 1;"]);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/brace/i);
  });

  it("rejects unbalanced parens", () => {
    // One open paren, no close → unbalanced.
    const r = validateCodeLines(["const x = foo(", "return x;"]);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/paren/i);
  });

  it("rejects unbalanced brackets", () => {
    const r = validateCodeLines(["const x = [1, 2;"]);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/bracket/i);
  });

  it("ignores braces inside strings and comments", () => {
    // The '{' in the string and the '}' in the comment should not count.
    expect(
      validateCodeLines([
        'const s = "contains { brace";',
        '// comment with } brace',
        "console.log(s);",
      ]).ok
    ).toBe(true);
  });

  it("accepts an empty array", () => {
    expect(validateCodeLines([]).ok).toBe(true);
  });
});

describe("tokenizeLine — classification", () => {
  it("returns an empty array for empty input", () => {
    expect(tokenizeLine("")).toEqual([]);
  });

  it("classifies keywords", () => {
    const tokens = tokenizeLine("const x = 1;");
    const kinds = tokens.map((t) => t.kind);
    expect(kinds).toContain("kw"); // const
  });

  it("classifies strings", () => {
    const tokens = tokenizeLine('const s = "hello";');
    expect(tokens.some((t) => t.kind === "str")).toBe(true);
  });

  it("classifies numbers", () => {
    const tokens = tokenizeLine("const n = 42.5;");
    expect(tokens.some((t) => t.kind === "num")).toBe(true);
  });

  it("classifies line comments", () => {
    const tokens = tokenizeLine("// a comment");
    expect(tokens.some((t) => t.kind === "comment")).toBe(true);
  });
});
