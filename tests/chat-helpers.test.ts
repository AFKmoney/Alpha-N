// Tests for the pure helpers extracted from the chat panel and evolution
// store. These lock down the suggestion engine, byte formatting, file
// classification, and version bumping so future refactors can't silently
// regress them.
import { describe, it, expect } from "vitest";
import {
  generateSuggestions,
  formatBytes,
  fileExtension,
  getPersonality,
  PERSONALITIES,
} from "@/components/alpha/chat-helpers";
import { bumpVersion } from "@/lib/alpha/evolution-store-helpers";

describe("chat-helpers — generateSuggestions", () => {
  it("returns fallback suggestions when no keyword matches", () => {
    const s = generateSuggestions("hello world, nothing relevant here");
    expect(s.length).toBeGreaterThan(0);
    expect(s.length).toBeLessThanOrEqual(2);
  });

  it("matches code-related keywords", () => {
    const s = generateSuggestions("Here is a code function snippet for you");
    expect(s.some((x) => x.toLowerCase().includes("code") || x.toLowerCase().includes("run"))).toBe(true);
  });

  it("matches error-related keywords", () => {
    const s = generateSuggestions("There was an error in the build, it failed");
    expect(s.some((x) => x.toLowerCase().includes("fix") || x.toLowerCase().includes("caused"))).toBe(true);
  });

  it("caps at 3 suggestions", () => {
    // Many keywords in one message — still capped at 3.
    const s = generateSuggestions(
      "code function error bug plan step memory search file metric optimize speed"
    );
    expect(s.length).toBeLessThanOrEqual(3);
  });

  it("de-duplicates identical suggestions", () => {
    const s = generateSuggestions("code snippet code snippet");
    // All entries must be unique.
    expect(new Set(s).size).toBe(s.length);
  });
});

describe("chat-helpers — formatBytes", () => {
  it("formats bytes under 1KB", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1023)).toBe("1023 B");
  });

  it("formats kilobytes", () => {
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(10240)).toBe("10.0 KB");
  });

  it("formats megabytes", () => {
    expect(formatBytes(1024 * 1024)).toBe("1.0 MB");
    expect(formatBytes(2.5 * 1024 * 1024)).toBe("2.5 MB");
  });
});

describe("chat-helpers — fileExtension", () => {
  it("extracts lowercase extension", () => {
    expect(fileExtension("photo.PNG")).toBe("png");
    expect(fileExtension("script.TS")).toBe("ts");
  });

  it("returns empty string for files with no extension", () => {
    expect(fileExtension("README")).toBe("");
    expect(fileExtension("Makefile")).toBe("");
  });

  it("handles dotted filenames", () => {
    expect(fileExtension(".gitignore")).toBe("gitignore");
    expect(fileExtension("archive.tar.gz")).toBe("gz");
  });
});

describe("chat-helpers — personalities", () => {
  it("exposes exactly four profiles", () => {
    expect(PERSONALITIES).toHaveLength(4);
    expect(PERSONALITIES.map((p) => p.key).sort()).toEqual([
      "architect",
      "hacker",
      "mentor",
      "rogue",
    ]);
  });

  it("returns the matching profile", () => {
    expect(getPersonality("hacker").name).toBe("Hacker");
  });

  it("falls back to the first profile for an unknown key", () => {
    // @ts-expect-error — deliberately invalid key
    expect(getPersonality("ghost").key).toBe("architect");
  });

  it("every profile has a non-empty preamble", () => {
    for (const p of PERSONALITIES) {
      expect(p.preamble.length).toBeGreaterThan(10);
    }
  });
});

describe("evolution-store-helpers — bumpVersion", () => {
  it("increments the patch number", () => {
    expect(bumpVersion("0.3.0")).toBe("0.3.1");
    expect(bumpVersion("1.2.3")).toBe("1.2.4");
  });

  it("rolls patch into minor at 10", () => {
    expect(bumpVersion("0.3.9")).toBe("0.4.0");
  });

  it("rolls minor into major at 10", () => {
    expect(bumpVersion("0.9.9")).toBe("1.0.0");
  });

  it("rolls major indefinitely", () => {
    expect(bumpVersion("9.9.9")).toBe("10.0.0");
  });
});
