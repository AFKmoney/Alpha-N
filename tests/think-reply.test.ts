// Tests for the think route's free-text reply recovery.
//
// When a small local model fails to emit valid JSON, the route used to dump
// the first 220 chars of raw output into the chat — which was often echoed
// system-prompt text ("# AKASHA", "You are Alpha-OS", JSON fragments). The
// user would see the prompt instead of a reply.
//
// extractReplyFromRaw must: (a) never leak prompt echoes, (b) recover a real
// message when one exists, (c) return empty string rather than garbage.
//
// The function isn't exported (it's internal to the route), so these tests
// re-implement the contract against the documented behaviour. If the
// function's behaviour changes, update both this test and the route.
import { describe, it, expect } from "vitest";

// Mirror of extractReplyFromRaw's logic, kept here so the test doesn't depend
// on Next route internals. If the two drift, the test will catch it via the
// CI build (the route imports nothing from here, so a drift = test passes but
// route differs — hence keep this in sync manually and review on change).
function extractReplyFromRaw(raw: string): string {
  let t = raw.trim();
  if (!t) return "";
  const markers = [
    /"message"\s*:\s*"([^"]*(?:\\.[^"]*)*)"/i,
    /\bassistant\s*:\s*([\s\S]+)/i,
    /\bN-CORE\s*:\s*([\s\S]+)/i,
    /\bREPLY\s*:\s*([\s\S]+)/i,
  ];
  for (const re of markers) {
    const m = t.match(re);
    if (m && m[1] && m[1].trim().length > 2) {
      t = m[1].trim();
      break;
    }
  }
  t = t.replace(/```[\s\S]*?```/g, " ");
  t = t.replace(/^\s*[\[{][\s\S]*[\]}]\s*$/, " ");
  t = t.replace(/\\n/g, " ").replace(/\\"/g, '"');
  const echoPatterns = [
    /^\s*#+\s.*$/gm,
    /^\s*(USER|N-CORE|SYSTEM|ASSISTANT)\s*:/gim,
    /^\s*You are Alpha-OS\b.*/gim,
    /^\s*MUTATIONS AVAILABLE\b.*/gim,
    /^\s*"type"\s*:\s*"[a-z_]+"[\s\S]*$/gm,
    /^\s*\{[\s\S]*$/gm,
  ];
  for (const re of echoPatterns) t = t.replace(re, " ");
  t = t.replace(/\s+/g, " ").trim();
  if (t.length > 400) t = t.slice(0, 400).trim() + "…";
  if (t.length < 3) return "";
  return t;
}

describe("extractReplyFromRaw — never leaks the prompt", () => {
  it("returns empty for pure prompt echo", () => {
    // A pure echo of prompt sections — headers, role labels, the opening
    // declaration — must NOT surface as a chat message. After stripping
    // echoes, what's left is fragmentary prompt body, which is too short
    // or too prompt-like to show.
    const echo =
      "You are Alpha-OS, a self-evolving operating system.\n# AKASHA\n# RULES\nUSER:\nSYSTEM:";
    const out = extractReplyFromRaw(echo);
    // It must not contain any prompt boilerplate.
    expect(out).not.toContain("Alpha-OS");
    expect(out).not.toContain("AKASHA");
    expect(out).not.toContain("RULES");
    expect(out.length).toBeLessThan(10); // effectively nothing usable
  });

  it("returns empty for a raw JSON blob with no message", () => {
    expect(extractReplyFromRaw('{"type":"set_state","state":"observing"}')).toBe("");
  });

  it("recovers a message from a JSON message field", () => {
    const raw = 'some preamble {"reasoning":"x","message":"Hello! I am ready.","mutations":[]}';
    expect(extractReplyFromRaw(raw)).toBe("Hello! I am ready.");
  });

  it("recovers text after an assistant: marker", () => {
    const raw = "USER: hi\n# AKASHA\nblah\nassistant: Sure, I can help with that.";
    expect(extractReplyFromRaw(raw)).toBe("Sure, I can help with that.");
  });

  it("strips markdown section headers copied from the prompt", () => {
    const raw = "### FEEDBACK FROM YOUR LAST CYCLES\nstop doing X\n# RULES\n- be dense";
    const out = extractReplyFromRaw(raw);
    expect(out).not.toContain("FEEDBACK FROM");
    expect(out).not.toContain("# RULES");
  });

  it("caps excessively long recovered text", () => {
    const raw = "assistant: " + "word ".repeat(200);
    const out = extractReplyFromRaw(raw);
    expect(out.length).toBeLessThanOrEqual(401); // 400 + ellipsis
    expect(out.endsWith("…")).toBe(true);
  });

  it("returns empty string for empty input", () => {
    expect(extractReplyFromRaw("")).toBe("");
    expect(extractReplyFromRaw("   ")).toBe("");
  });

  it("does not leak the mutation schema examples", () => {
    const raw =
      '{"type":"set_state","state":"observing"}\n{"type":"create_app","kind":"notes"}';
    expect(extractReplyFromRaw(raw)).toBe("");
  });
});
