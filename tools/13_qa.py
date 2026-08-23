#!/usr/bin/env python3
"""The quality gates, measured and written down.

"It feels fine" is not evidence. This program runs Lighthouse for
accessibility, Playwright for keyboard reach and reduced motion, and measures
the transfer size and the time to first interaction. It writes every number
into notes/QA.md together with the command that produced it, and it exits
non-zero when a gate is missed.

Gates:
  accessibility          Lighthouse >= 95 on #/table and #/tour
  keyboard               every control reachable and named, no mouse
  reduced motion         no travel, and a colour pulse in its place
  transfer size          <= 250 KB gzipped for one route
  first interaction      < 1 s, median of five cold loads

Usage:  python3 tools/serve.py 8791 &
        python3 tools/13_qa.py [port]
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import gzip
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DOCS = REPO / "docs"
QA = REPO / "tools" / "qa"
SHOTS = REPO / "notes" / "qa-screenshots"
OUT = REPO / "notes" / "QA.md"
PORT = sys.argv[1] if len(sys.argv) > 1 else "8791"
BASE = f"http://localhost:{PORT}"

A11Y_MIN = 95
SIZE_MAX_KB = 250
TTI_MAX_MS = 1000

# The routes the plan names for the accessibility gate.
A11Y_ROUTES = {
    "#/table?s=CK-classroom&step=8": "the explorer",
    "#/tour?t=6": "the guided tour",
}

failures: list[str] = []


def gz(path: Path) -> int:
    return len(gzip.compress(path.read_bytes(), 9))


def measure_sizes() -> dict:
    """Transfer size for one route, gzipped, as a server would send it."""
    shell = [DOCS / "index.html"] + sorted(DOCS.glob("css/*.css"))
    # Only the modules the explorer actually pulls: main and its import graph.
    explorer = [
        "js/main.js", "js/store.js", "js/traceLoader.js", "js/dom.js", "js/fmt.js",
        "js/replay.js", "js/narrate.js", "js/player.js",
        "js/routes/table.js", "js/views/tableView.js", "js/views/bucketsView.js",
        "js/views/badges.js", "js/views/mathBox.js", "js/views/rngBox.js",
        "js/views/codePanel.js", "js/views/timeline.js", "js/views/narration.js",
        "js/views/eventLog.js", "js/views/configPanel.js",
        "js/views/predictionOverlay.js",
    ]
    data = ["data/manifest.json", "data/source/code.json",
            "data/traces/CK-classroom.json"]
    code = sum(gz(p) for p in shell) + sum(gz(DOCS / p) for p in explorer)
    payload = sum(gz(DOCS / p) for p in data)
    every_js = sum(gz(p) for p in sorted(DOCS.glob("js/**/*.js")))
    biggest = max(DOCS.glob("data/traces/*.json"), key=lambda p: p.stat().st_size)
    return {
        "explorerCodeGz": code,
        "explorerDataGz": payload,
        "explorerTotalGz": code + payload,
        "everyModuleGz": every_js + sum(gz(p) for p in shell),
        "modulesOnExplorer": len(explorer),
        "modulesTotal": len(list(DOCS.glob("js/**/*.js"))),
        "largestTrace": biggest.name,
        "largestTraceGz": gz(biggest),
        "largestTraceRaw": biggest.stat().st_size,
    }


def lighthouse(route: str) -> dict:
    url = f"{BASE}/index.html{route}"
    out = QA / "lh.json"
    env = dict(os.environ)
    env.setdefault("CHROME_PATH", shutil.which("chromium") or "/snap/bin/chromium")
    cmd = [
        "npx", "--no-install", "lighthouse", url,
        "--only-categories=accessibility",
        "--output=json", f"--output-path={out}",
        "--chrome-flags=--headless=new --no-sandbox --disable-gpu",
        "--quiet", "--disable-full-page-screenshot",
    ]
    r = subprocess.run(cmd, cwd=QA, env=env, capture_output=True, text=True, timeout=600)
    if not out.is_file():
        raise SystemExit(f"[13] lighthouse produced nothing for {route}\n{r.stderr[-2000:]}")
    report = json.loads(out.read_text())
    out.unlink()
    # On WSL, chrome-launcher writes its temp profile to a Windows-style path
    # inside the working directory. Sweep it up rather than committing it.
    for junk in QA.glob("C:*"):
        shutil.rmtree(junk, ignore_errors=True)
    cat = report["categories"]["accessibility"]
    audits = report["audits"]
    failed = []
    for ref in cat["auditRefs"]:
        audit = audits.get(ref["id"], {})
        if audit.get("score") == 0:
            failed.append({"id": ref["id"], "title": audit.get("title", "")})
    return {
        "score": round(cat["score"] * 100),
        "failed": failed,
        "lighthouseVersion": report["lighthouseVersion"],
    }


def main() -> int:
    if subprocess.run(["curl", "-sf", "-o", "/dev/null", f"{BASE}/index.html"]).returncode:
        print(f"[13] FATAL: nothing is serving on {BASE}. Start it with:\n"
              f"       python3 tools/serve.py {PORT} &", file=sys.stderr)
        return 1
    SHOTS.mkdir(parents=True, exist_ok=True)

    print("== transfer size")
    sizes = measure_sizes()
    total_kb = sizes["explorerTotalGz"] / 1024
    print(f"   explorer route, gzipped: {total_kb:.1f} KB "
          f"({sizes['explorerCodeGz'] / 1024:.1f} KB code + "
          f"{sizes['explorerDataGz'] / 1024:.1f} KB data)")
    if total_kb > SIZE_MAX_KB:
        failures.append(f"transfer size {total_kb:.1f} KB > {SIZE_MAX_KB} KB")

    print("== accessibility (Lighthouse)")
    lh = {}
    for route, label in A11Y_ROUTES.items():
        lh[route] = lighthouse(route)
        print(f"   {label:20s} {lh[route]['score']}")
        if lh[route]["score"] < A11Y_MIN:
            failures.append(f"accessibility {lh[route]['score']} < {A11Y_MIN} on {route}")
        for f in lh[route]["failed"]:
            print(f"      failed audit: {f['id']} — {f['title']}")

    print("== keyboard, reduced motion, first interaction (Playwright)")
    r = subprocess.run(["node", "qa.mjs", BASE, str(SHOTS)],
                       cwd=QA, capture_output=True, text=True, timeout=900)
    print("   " + r.stdout.replace("\n", "\n   ").rstrip())
    if r.returncode != 0:
        failures.append("a Playwright check failed")
        print(r.stderr[-2000:], file=sys.stderr)
    pw = json.loads((REPO / "notes" / "qa-playwright.json").read_text())
    by_name = {x["name"]: x for x in pw}
    timings = json.loads(by_name["__timings"]["detail"]) if "__timings" in by_name else []
    median = sorted(timings)[len(timings) // 2] if timings else -1
    if median >= TTI_MAX_MS:
        failures.append(f"first interaction {median} ms >= {TTI_MAX_MS} ms")

    # ------------------------------------------------------------------ write up
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    lines = [
        "# Quality gates",
        "",
        "Measured numbers, with the command that produced each one. Regenerate "
        "with:",
        "",
        "```sh",
        "python3 tools/serve.py 8791 &",
        "python3 tools/13_qa.py 8791",
        "```",
        "",
        f"Last run {now}. `tools/13_qa.py` exits non-zero when a gate is missed, "
        "so a green pipeline is the evidence, not this file.",
        "",
        "## Summary",
        "",
        "| gate | target | measured | |",
        "|---|---|---|---|",
    ]

    def row(name, target, measured, ok):
        lines.append(f"| {name} | {target} | {measured} | {'pass' if ok else '**FAIL**'} |")

    for route, label in A11Y_ROUTES.items():
        s = lh[route]["score"]
        row(f"accessibility, {label}", f">= {A11Y_MIN}", str(s), s >= A11Y_MIN)
    row("transfer size, one route", f"<= {SIZE_MAX_KB} KB gz",
        f"{total_kb:.1f} KB", total_kb <= SIZE_MAX_KB)
    row("cold load to first interaction", f"< {TTI_MAX_MS} ms",
        f"{median} ms median of {len(timings)}", 0 <= median < TTI_MAX_MS)
    kb = [x for x in pw if not x["name"].startswith("__")]
    row("browser checks", "all pass",
        f"{len(kb) - len([x for x in kb if not x['pass']])} of {len(kb)}",
        all(x["pass"] for x in kb))

    lines += [
        "",
        "## Accessibility",
        "",
        f"Lighthouse {lh[list(A11Y_ROUTES)[0]]['lighthouseVersion']}, accessibility "
        "category only, headless Chromium.",
        "",
    ]
    for route, label in A11Y_ROUTES.items():
        lines.append(f"- **{label}** (`{route}`): **{lh[route]['score']}**")
        if lh[route]["failed"]:
            for f in lh[route]["failed"]:
                lines.append(f"  - failed: `{f['id']}` — {f['title']}")
        else:
            lines.append("  - no failed audit")
    lines += [
        "",
        "Accessibility is also checked structurally by `tools/08_browser_check.py`, "
        "which asserts that every control carries a name, that the primary "
        "controls are large enough to hit, that the narration reaches a live "
        "region, and that every step appears as text as well as in the diagram.",
        "",
        "## Keyboard, motion and provenance",
        "",
        "From `tools/qa/qa.mjs`, which uses no mouse at all.",
        "",
        "| check | result | detail |",
        "|---|---|---|",
    ]
    for x in pw:
        if x["name"].startswith("__"):
            continue
        lines.append(f"| {x['name']} | {'pass' if x['pass'] else '**FAIL**'} | "
                     f"{x.get('detail', '')} |")

    badge = by_name.get("__sandboxBadge", {}).get("detail", "")
    lines += [
        "",
        "## The provenance badges",
        "",
        "Recorded data and computed data must never look the same. Screenshots in "
        "`notes/qa-screenshots/`:",
        "",
        "- `recorded-badge.png` — the explorer, every panel marked "
        "\"recorded from C++\" in green",
        "- `sandbox-badge.png` — the sandbox, every panel marked "
        "\"computed in the browser\" in amber",
        "",
        f"Computed style of the sandbox badge: `{badge}`",
        "",
        "## Motion",
        "",
        "- `motion-no-preference.png` — the eviction step with the spring animation live",
        "- `motion-reduce.png` — the same step under `prefers-reduced-motion: reduce`",
        "",
        "Under reduced motion the walker does not travel. A 600 ms colour pulse on "
        "the bucket replaces the movement, so the same information arrives without "
        "anything sliding.",
        "",
        "## Size",
        "",
        "| | gzipped |",
        "|---|---|",
        f"| the explorer route: shell, CSS and its {sizes['modulesOnExplorer']} modules "
        f"| {sizes['explorerCodeGz'] / 1024:.1f} KB |",
        f"| its data: manifest, source slices, one trace | "
        f"{sizes['explorerDataGz'] / 1024:.1f} KB |",
        f"| **route total** | **{total_kb:.1f} KB** |",
        f"| every module on the site ({sizes['modulesTotal']}), if all were loaded "
        f"| {sizes['everyModuleGz'] / 1024:.1f} KB |",
        f"| the largest trace, `{sizes['largestTrace']}`, fetched only when selected "
        f"| {sizes['largestTraceGz'] / 1024:.1f} KB "
        f"({sizes['largestTraceRaw'] / 1024:.0f} KB raw) |",
        "",
        "There is no bundler by design: the modules are the teaching material. "
        "Routes load on demand, so no visitor pays for all of them.",
        "",
        "## Timing",
        "",
        f"Cold navigation to a keypress that actually moves the trace, five runs: "
        f"{timings} ms, median **{median} ms**.",
        "",
        "Measured against `tools/serve.py` on localhost. The published site sits "
        "behind a CDN with HTTP/2, which multiplexes the same requests over one "
        "connection.",
        "",
    ]
    OUT.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"\n[13] wrote {OUT.relative_to(REPO)}")

    if failures:
        for f in failures:
            print(f"[13] GATE MISSED: {f}", file=sys.stderr)
        return 1
    print("[13] every gate met")
    return 0


if __name__ == "__main__":
    sys.exit(main())
