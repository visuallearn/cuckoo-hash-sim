#!/usr/bin/env python3
"""Collect the count each verification layer prints about itself.

Every headline number in the README and in notes/FIDELITY.md comes from here,
and here it comes from running the thing and reading its output. A number that
nobody can re-derive is a claim, not evidence.

Writes notes/verification-counts.md, and with --check fails if the documents
quote a number that no longer matches.

Usage:  python3 tools/16_counters.py [--check] [--port 8791]
"""
from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
OUT = REPO / "notes" / "verification-counts.md"
BUILD = REPO / ".work" / "build"
PORT = "8791"
if "--port" in sys.argv:
    PORT = sys.argv[sys.argv.index("--port") + 1]

# Documents that quote these numbers. --check greps them.
QUOTING = ["README.md", "notes/FIDELITY.md"]


def run(cmd, cwd=None, timeout=1800) -> str:
    r = subprocess.run(cmd, cwd=cwd or REPO, capture_output=True, text=True,
                       timeout=timeout)
    return r.stdout + r.stderr


def grab(text: str, pattern: str, label: str) -> tuple[int, str]:
    m = re.search(pattern, text, re.M)
    if not m:
        raise SystemExit(f"[16] FATAL: could not read the count for {label}.\n"
                         f"      pattern: {pattern}\n"
                         f"      last output:\n{text[-1500:]}")
    return int(m.group(1).replace(",", "")), m.group(0).strip()


def main() -> int:
    rows = []

    print("[16] python re-derivation")
    out = run(["python3", "tools/04_verify.py"])
    n, line = grab(out, r"\[04\] (\d+) checks, \d+ failure", "04_verify.py")
    fails, _ = grab(out, r"\[04\] \d+ checks, (\d+) failure", "04_verify.py failures")
    rows.append(("independent re-derivation, in Python", "tools/04_verify.py", n, fails, line))

    print("[16] conformance suite")
    out = run([str(BUILD / "conformance_test")])
    n, line = grab(out, r"^(\d+) checks, \d+ failure", "conformance_test")
    fails, _ = grab(out, r"^\d+ checks, (\d+) failure", "conformance_test failures")
    rows.append(("behavior tests against the pinned reference",
                 "tools/cxx/conformance_test.cc", n, fails, line))

    print("[16] upstream test suite")
    console = REPO / "notes" / "reference-test-run" / "bazel-test-console.txt"
    if console.is_file():
        text = console.read_text()
        n, line = grab(text, r"Executed \d+ out of (\d+) tests: \d+ tests pass",
                       "the archived bazel run")
        rows.append(("the reference's own suite, archived",
                     "notes/reference-test-run/", n, 0, line))

    print("[16] upstream coverage mapping")
    out = run(["python3", "tools/12_check_mapping.py"])
    n, line = grab(out, r"\[12\] (\d+) upstream tests", "12_check_mapping.py")
    rows.append(("upstream TEST() cases, all mapped", "tools/12_check_mapping.py",
                 n, 0, line))

    print("[16] colour pairs")
    out = run(["python3", "tools/14_contrast.py"])
    n, line = grab(out, r"\[14\] (\d+) colour pairs", "14_contrast.py")
    rows.append(("colour pairs, both themes", "tools/14_contrast.py", n, 0, line))

    print("[16] golden index draws")
    golden = REPO / "notes" / "rng-golden.txt"
    draws = sum(1 for x in golden.read_text().splitlines() if not x.startswith("#"))
    rows.append(("golden index draws captured from the real abseil",
                 "tools/cxx/rng_vectors.cc", draws,
                 0, f"{draws} rows in notes/rng-golden.txt"))

    # The browser numbers need a server, so they are optional here.
    print("[16] browser checks")
    alive = subprocess.run(["curl", "-sf", "-o", "/dev/null",
                            f"http://localhost:{PORT}/index.html"]).returncode == 0
    if alive:
        out = run(["python3", "tools/08_browser_check.py", PORT])
        n, line = grab(out, r"All (\d+) checks passed", "the in-browser self-test")
        rows.append(("in-browser checks of the shipped files, and the engine "
                     "replay of every trace", "docs/selftest.html", n, 0, line))
        for name, pat in (("interact", r"interact:.*?\n\s+(\d+) ok, (\d+) failed"),
                          ("audit", r"audit:.*?\n\s+(\d+) ok, (\d+) failed")):
            m = re.search(pat, out, re.S)
            if m:
                rows.append((f"headless browser checks, {name}",
                             f"tools/browser-checks/{name}.html",
                             int(m.group(1)), int(m.group(2)),
                             f"{m.group(1)} ok, {m.group(2)} failed"))
    else:
        print(f"[16] nothing serving on port {PORT}; the browser rows are skipped")

    total = sum(r[2] for r in rows)
    lines = [
        "# Verification counts",
        "",
        "Every number here was printed by the program named beside it, and "
        "collected by `tools/16_counters.py`. None is copied by hand. Re-run "
        "with:",
        "",
        "```sh",
        "python3 tools/serve.py 8791 &",
        "python3 tools/16_counters.py",
        "```",
        "",
        "| what is checked | by | checks | failures |",
        "|---|---|---|---|",
    ]
    for what, by, n, fails, _ in rows:
        mark = "" if not fails else " **" + str(fails) + "**"
        lines.append(f"| {what} | `{by}` | {n:,} | {fails}{mark} |")
    lines += [
        f"| | | **{total:,}** | **{sum(r[3] for r in rows)}** |",
        "",
        "## The exact lines",
        "",
        "```",
    ]
    for _, by, _, _, line in rows:
        lines.append(f"{by}\n    {line}")
    lines += ["```", ""]
    text = "\n".join(lines)

    if "--check" in sys.argv:
        stale = []
        if not OUT.is_file() or OUT.read_text() != text:
            stale.append(str(OUT.relative_to(REPO)))
        # Any number the documents quote must be one of these.
        known = {str(r[2]) for r in rows} | {f"{r[2]:,}" for r in rows}
        for doc in QUOTING:
            body = (REPO / doc).read_text()
            for quoted in re.findall(r"\*\*([\d,]{3,})\s+checks?", body):
                if quoted not in known:
                    stale.append(f"{doc} quotes {quoted} checks, which nothing prints")
        if stale:
            for x in stale:
                print(f"[16] out of date: {x}", file=sys.stderr)
            return 1
        print("[16] the counts are current and the documents agree")
        return 0

    OUT.write_text(text, encoding="utf-8")
    print(f"\n[16] {len(rows)} layers, {total:,} checks, "
          f"{sum(r[3] for r in rows)} failures")
    print(f"[16] wrote {OUT.relative_to(REPO)}")
    return 1 if any(r[3] for r in rows) else 0


if __name__ == "__main__":
    sys.exit(main())
