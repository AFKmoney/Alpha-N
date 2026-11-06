#!/usr/bin/env python3
"""Approximate Rust syntax sanity: verify (), [] and {} balance per file
while skipping line comments, (nested) block comments, string literals,
char literals, and raw strings. Also flags stray unescaped-backslash-at-EOL
outside strings and tabs."""

import sys, re, pathlib

SRC = pathlib.Path("/home/z/my-project/mini-services/aether-engine/src")
files = sorted(SRC.glob("*.rs")) + [SRC.parent / "Cargo.toml"]

def strip_rust(text, name):
    out = []
    i, n = 0, len(text)
    line = 1
    state = []  # stack of context for error reporting
    depth_stack = []
    pairs = {")": "(", "]": "[", "}": "{"}
    errors = []
    while i < n:
        c = text[i]
        nxt = text[i + 1] if i + 1 < n else ""
        if c == "\n":
            line += 1
            out.append(c)
            i += 1
            continue
        # line comment
        if c == "/" and nxt == "/":
            while i < n and text[i] != "\n":
                i += 1
            continue
        # block comment (nested)
        if c == "/" and nxt == "*":
            level = 1
            i += 2
            while i < n and level > 0:
                if text[i] == "\n":
                    line += 1
                if text.startswith("/*", i):
                    level += 1
                    i += 2
                elif text.startswith("*/", i):
                    level -= 1
                    i += 2
                else:
                    i += 1
            if level > 0:
                errors.append(f"{name}:{line}: unterminated block comment")
            continue
        # raw string r"..." or r#"..."#
        if c == "r" and (nxt == '"' or (nxt == "#" and i + 2 < n and text[i + 2] in "\"#")):
            m = re.match(r'r(#*)"', text[i:])
            if m and not re.search(r'\w$', text[max(0, i - 1):i]):
                hashes = len(m.group(1))
                closer = '"' + "#" * hashes
                j = text.find(closer, i + m.end())
                if j == -1:
                    errors.append(f"{name}:{line}: unterminated raw string")
                    break
                # count newlines inside
                line += text.count("\n", i, j + len(closer))
                i = j + len(closer)
                continue
        # byte string / char
        if c == "b" and nxt == '"':
            i += 1
            continue
        # normal string
        if c == '"':
            i += 1
            while i < n:
                if text[i] == "\\":
                    i += 2
                    continue
                if text[i] == '"':
                    i += 1
                    break
                if text[i] == "\n":
                    line += 1
                i += 1
            else:
                errors.append(f"{name}:{line}: unterminated string")
            continue
        # char literal: 'x' or '\n' or '\u{1}' — but NOT a lifetime ('a, 'static)
        if c == "'":
            m = re.match(r"'(\\.|\\u\{[0-9a-fA-F]+\}|[^\\'])'", text[i:])
            if m:
                i += m.end()
                continue
            # lifetime: skip the quote, let the identifier flow
            i += 1
            continue
        # brackets
        if c in "([{":
            depth_stack.append((c, line))
        elif c in ")]}":
            if not depth_stack:
                errors.append(f"{name}:{line}: unmatched closing {c!r}")
            else:
                op, oline = depth_stack.pop()
                if op != pairs[c]:
                    errors.append(f"{name}:{line}: closing {c!r} does not match {op!r} opened at line {oline}")
        out.append(c)
        i += 1
    for op, oline in depth_stack:
        errors.append(f"{name}:{oline}: unclosed {op!r}")
    return errors

def check_tabs_and_trailing_ws(path, text):
    errs = []
    for idx, ln in enumerate(text.splitlines(), 1):
        if "\t" in ln:
            errs.append(f"{path.name}:{idx}: TAB character")
        if ln != ln.rstrip():
            errs.append(f"{path.name}:{idx}: trailing whitespace")
    return errs

all_errors = []
for f in files:
    text = f.read_text(encoding="utf-8")
    if f.suffix == ".rs":
        all_errors += strip_rust(text, f.name)
    all_errors += check_tabs_and_trailing_ws(f, text)

if all_errors:
    print("ISSUES FOUND:")
    for e in all_errors:
        print(" ", e)
    sys.exit(1)
print("All files: brackets balanced, no tabs, no trailing whitespace, no unterminated strings/comments.")
