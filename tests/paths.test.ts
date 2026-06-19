// Tests for cross-platform path resolution — the traversal guard that keeps
// the AI's file operations inside the project root. Every escape attempt
// listed here MUST be rejected regardless of OS path separators.
import { describe, it, expect } from "vitest";
import { resolveSafe, isWithinProject, PROJECT_ROOT } from "@/lib/alpha/paths";

describe("paths — resolveSafe rejects traversal", () => {
  it("anchors a simple relative path at the project root", () => {
    const resolved = resolveSafe("src/lib/alpha/mutations.ts");
    expect(resolved).toBeTruthy();
    expect(resolved!.replace(/\\/g, "/")).toContain("src/lib/alpha/mutations.ts");
  });

  it("rejects absolute paths outright", () => {
    // Any absolute path is refused — the AI must address files relatively.
    expect(resolveSafe("/etc/passwd")).toBeNull();
    expect(resolveSafe("/home/z/my-project/../../../etc/passwd")).toBeNull();
    // Windows drive-absolute paths are also caught.
    expect(resolveSafe("C:\\Windows\\System32")).toBeNull();
  });

  it("rejects parent-directory traversal with ..", () => {
    expect(resolveSafe("../../etc/passwd")).toBeNull();
    // src/.. stays in root (resolves to root), but src/../.. escapes it.
    expect(resolveSafe("src/../package.json")).not.toBeNull();
    expect(resolveSafe("src/../../package.json")).toBeNull();
    expect(resolveSafe("src/../../../etc/passwd")).toBeNull();
  });

  it("handles mixed separators", () => {
    // The guard normalises both / and \ so a Windows-style escape is caught.
    expect(resolveSafe("..\\..\\windows\\system32")).toBeNull();
  });

  it("is null-safe", () => {
    expect(resolveSafe("")).toBeNull();
    // @ts-expect-error — deliberately non-string
    expect(resolveSafe(null)).toBeNull();
    // @ts-expect-error — deliberately non-string
    expect(resolveSafe(undefined)).toBeNull();
  });
});

describe("paths — isWithinProject", () => {
  it("returns true for paths inside the root", () => {
    expect(isWithinProject("src/app/page.tsx")).toBe(true);
    expect(isWithinProject("package.json")).toBe(true);
  });

  it("returns false for escaping paths", () => {
    expect(isWithinProject("../../secret")).toBe(false);
    expect(isWithinProject("/etc/shadow")).toBe(false);
  });
});

describe("paths — PROJECT_ROOT is set", () => {
  it("is a non-empty absolute path", () => {
    expect(PROJECT_ROOT.length).toBeGreaterThan(0);
    expect(PROJECT_ROOT.includes("Alpha-N") || PROJECT_ROOT.toLowerCase().includes("alpha-n")).toBe(true);
  });
});
