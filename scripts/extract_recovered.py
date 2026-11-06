#!/usr/bin/env python3
"""Extract Alpha-OS source files recovered in tool-results/ snapshots.

The snapshots are captured "Read" outputs. Some have cat -n style prefixes
(`   123→content`), the worklog has a doubled prefix. This script strips the
prefixes and writes each recovered file to its real location in the project.
It also reports each file's size/line count and its import list so the
missing modules can be rebuilt to match.
"""
import os
import re

ROOT = "/home/z/my-project"
TR = os.path.join(ROOT, "tool-results")

PREFIX_RE = re.compile(r"^\s*\d+→")
DOUBLED_RE = re.compile(r"^\s*\d+→\s*\d+→")


def read_lines(fname: str) -> list[str]:
    with open(os.path.join(TR, fname), "r", encoding="utf-8", errors="replace") as f:
        return f.read().splitlines()


def strip_prefixes(lines: list[str], doubled: bool = False) -> list[str]:
    out = []
    for ln in lines:
        if doubled:
            m = DOUBLED_RE.match(ln)
            if m:
                ln = ln[m.end():]
            else:
                m2 = PREFIX_RE.match(ln)
                if m2:
                    ln = ln[m2.end():]
        else:
            m = PREFIX_RE.match(ln)
            if m:
                ln = ln[m.end():]
        out.append(ln)
    return out


def detect_prefix(lines: list[str]) -> bool:
    """True if the file uses the `   N→` prefix (>=50% of first 100 lines)."""
    sample = lines[:100]
    if not sample:
        return False
    hits = sum(1 for ln in sample if PREFIX_RE.match(ln))
    return hits >= len(sample) * 0.5


# mapping: tool-result id -> (destination, doubled_prefix?)
MAP = {
    "read_1793963563691_7c015fc894eb": ("WORKLOG.md", True),
    "read_1793963766339_aa08f913fc6c": ("src/lib/alpha/evolution-store.ts", False),
    "read_1793963768200_37fe1cd0e998": ("recovered/dup-evolution-store.txt", False),
    "read_1793963781424_8851ff06ae0b": ("src/app/api/alpha/think/route.ts", False),
    "read_1793963782151_b50a5e5afac8": ("src/components/alpha/autonomous-loop.tsx", False),
    "read_1793963783948_388f04644614": ("recovered/dup-autonomous-loop.txt", False),
    "read_1793963808974_118eae223cac": ("recovered/aether-handlers-v1.rs", False),
    "read_1793963823949_ff7e7e9dfb87": ("src/lib/alpha/metacognition.ts", False),
    "read_1793963831200_88c395bd0996": ("src/app/api/alpha/generate-app/route.ts", False),
    "read_1793963852710_73534e777297": ("mini-services/aether-engine/src/agent.rs", False),
    "read_1793963853184_32dd369ffafd": ("mini-services/aether-engine/src/tools.rs", False),
    "read_1793963860192_0d26a7b82b75": ("src/components/alpha/chat-panel.tsx", False),
    "read_1793963873236_e4a7fd640e78": ("src/components/alpha/apps/os-apps.tsx", False),
    "read_1793963884212_42ab377c9fbb": ("src/components/alpha/apps/generated-app-renderer.tsx", False),
    "read_1793966050181_118eae223cac": ("recovered/dup-aether-handlers-v1.rs", False),
    "read_1793967886246_51401e61c55f": ("mini-services/aether-engine/src/handlers.rs", False),
}

report = []
for key, (dest, doubled) in MAP.items():
    src = key + ".txt"
    if not os.path.exists(os.path.join(TR, src)):
        report.append(f"MISSING SNAPSHOT: {src}")
        continue
    lines = read_lines(src)
    prefixed = detect_prefix(lines)
    lines = strip_prefixes(lines, doubled=doubled)
    # drop trailing blank padding
    while lines and not lines[-1].strip():
        lines.pop()
    content = "\n".join(lines) + "\n"
    full = os.path.join(ROOT, dest)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    with open(full, "w", encoding="utf-8") as f:
        f.write(content)
    imports = [ln.strip() for ln in lines if re.match(r"^(import|export .* from)", ln.strip())]
    report.append(
        f"{dest}: {len(lines)} lines, {len(content)//1024}KB, prefixed={prefixed}\n"
        + "\n".join("  " + i[:150] for i in imports[:14])
    )

print("\n\n".join(report))
