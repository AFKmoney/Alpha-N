#!/usr/bin/env python3
"""Compare main (nouvelle version) vs main-backup-1010 (ancien main distant).

Histories are unrelated, so a tree diff shows: A = only in main (new),
D = only in backup (old), M = in both but different.
"""
import subprocess
from collections import defaultdict

MAIN = "9276e95"
OLD = "upstream/main-backup-1010"


def run(*args: str) -> str:
    return subprocess.run(["git", *args], capture_output=True, text=True, check=True).stdout


def top(path: str) -> str:
    parts = path.split("/")
    return parts[0] if len(parts) > 1 else "(racine)"


def main() -> None:
    status = run("diff", "--name-status", MAIN, OLD).splitlines()
    added, deleted, modified = [], [], []
    for line in status:
        parts = line.split("\t")
        st, path = parts[0], parts[-1]
        if st.startswith("A"):
            # git diff MAIN OLD: "A" = added in OLD → only in backup
            deleted.append(path)
        elif st.startswith("D"):
            # "D" = removed going MAIN→OLD → only in main
            added.append(path)
        elif st.startswith("M"):
            modified.append(path)

    print(f"TOTAL: {len(added)} seulement dans main | {len(deleted)} seulement dans backup | {len(modified)} modifiés")

    for title, files in [("SEULEMENT DANS MAIN (nouveau)", added), ("SEULEMENT DANS BACKUP (ancien)", deleted)]:
        print(f"\n== {title}: {len(files)} fichiers ==")
        by_dir = defaultdict(list)
        for f in files:
            by_dir[top(f)].append(f)
        for d in sorted(by_dir, key=lambda k: -len(by_dir[k])):
            print(f"  {d}: {len(by_dir[d])}")
            if len(by_dir[d]) <= 12:
                for f in sorted(by_dir[d]):
                    print(f"    - {f}")

    print(f"\n== MODIFIÉS (dans les deux): {len(modified)} ==")
    # line-change sizes for modified files
    numstat = run("diff", "--numstat", MAIN, OLD).splitlines()
    rows = []
    for line in numstat:
        p = line.split("\t")
        if len(p) == 3 and p[2] in modified and p[0].isdigit() and p[1].isdigit():
            rows.append((int(p[0]) + int(p[1]), p[2]))
    rows.sort(reverse=True)
    for n, f in rows[:20]:
        print(f"  {n:>6} lignes ±  {f}")
    if len(rows) > 20:
        print(f"  … +{len(rows) - 20} autres")

    # presence of key dirs on each side
    print("\n== CONTENU DES RÉPERTOIRES CLÉS ==")
    for ref, label in [(MAIN, "main (nouveau)"), (OLD, "backup (ancien)")]:
        print(f"\n  [{label}]")
        for d in ["mini-services", ".github", "docs", "models", "agent-ctx", ".zscripts", "examples", "download"]:
            try:
                out = run("ls-tree", "--name-only", ref, d)
            except subprocess.CalledProcessError:
                print(f"    {d}: ABSENT")
                continue
            entries = run("ls-tree", "--name-only", f"{ref}:{d}").splitlines() if out else []
            print(f"    {d}: {', '.join(entries[:10])}{' …' if len(entries) > 10 else ''}")

    # package.json deps diff
    print("\n== DEPENDANCES package.json ==")
    for ref, label in [(MAIN, "nouveau"), (OLD, "ancien")]:
        try:
            pkg = run("show", f"{ref}:package.json")
        except subprocess.CalledProcessError:
            print(f"  {label}: package.json absent")
            continue
        import json
        d = json.loads(pkg)
        deps = sorted(d.get("dependencies", {}))
        print(f"  {label}: {len(deps)} deps: {', '.join(deps[:14])}{' …' if len(deps) > 14 else ''}")

    # commit logs
    print("\n== COMMITS ==")
    for ref, label in [(MAIN, "main (nouveau)"), (OLD, "backup (ancien)")]:
        log = run("log", "--oneline", ref).splitlines()
        print(f"\n  [{label}] {len(log)} commits")
        for c in log[:12]:
            print(f"    {c[:75]}")

    # src size comparison
    print("\n== TAILLE src/ ==")
    for ref, label in [(MAIN, "nouveau"), (OLD, "ancien")]:
        files = run("ls-tree", "-r", "--name-only", f"{ref}:src").splitlines()
        print(f"  {label}: {len(files)} fichiers sous src/")


if __name__ == "__main__":
    main()
