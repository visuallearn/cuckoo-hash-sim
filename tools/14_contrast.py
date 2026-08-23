#!/usr/bin/env python3
"""Check every colour pair the site actually renders, in both themes.

Lighthouse only sees what is on screen when it runs, so it finds contrast
failures one route at a time and misses any state a visitor has not reached.
This reads the tokens straight out of docs/css/base.css and checks every pair
the stylesheets and views put together, light and dark, plus the twelve
categorical hues the element chips use.

WCAG 2.1: 4.5:1 for text below 18.66px bold or 24px regular, which is all the
text here; 3:1 for a border or a graphical boundary.

Usage:  python3 tools/14_contrast.py
"""
from __future__ import annotations

import colorsys
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
BASE_CSS = REPO / "docs" / "css" / "base.css"
TABLE_VIEW = REPO / "docs" / "js" / "views" / "tableView.js"

TEXT_MIN = 4.5
EDGE_MIN = 3.0

# (foreground token, background token, what it is). Every entry is a pair the
# site really renders; the comment names where.
TEXT_PAIRS = [
    ("ink", "bg-panel", "body text in a panel"),
    ("ink", "bg", "body text on the page"),
    ("ink-soft", "bg-panel", "panel headings, .kv terms"),
    ("ink-soft", "bg", "the footer"),
    ("ink-soft", "bg-sunken", ".badge, table headers"),
    ("ink-soft", "bg-hover", "a hovered nav link"),
    ("ink-faint", "bg-panel", ".hint, .code line numbers, .slotnum"),
    ("ink-faint", "bg", ".hint on the page background"),
    ("ink-faint", "bg-sunken", ".code .n, .cand-tab headers"),
    ("ink-faint", "bg-hover", ".arrowlab over a hovered row"),
    ("probe", "bg-panel", "links, .m-res, the lit arrow label"),
    ("probe", "bg", "links in prose"),
    ("probe", "probe-soft", "the current nav link, .badge.probe, .ln.cur"),
    ("evict", "bg-panel", "the walker label, .note heading"),
    ("evict", "evict-soft", ".badge.sandbox, .note body, .pips"),
    ("settled", "bg-panel", "an element at rest"),
    ("settled", "settled-soft", ".badge.recorded, a bucket chip"),
    ("fail", "bg-panel", "the error narration"),
    ("fail", "fail-soft", ".badge.fail, the full stash tray"),
    ("stash", "bg-panel", "the stash heading"),
    ("stash", "stash-soft", "a stash chip, .badge.textbook"),
    # The current row of the event log takes the probe-soft background while
    # each kind cell keeps its own colour.
    ("evict", "probe-soft", ".log tr.now td.k.evict"),
    ("settled", "probe-soft", ".log tr.now td.k.place"),
    ("stash", "probe-soft", ".log tr.now td.k.stash_push"),
    ("fail", "probe-soft", ".log tr.now td.k.stash_overflow_error"),
    ("ink-faint", "probe-soft", ".log tr.now td.s"),
    ("ink", "probe-soft", ".log tr.now td, .code .ln.cur .t"),
]

# Borders and graphical boundaries need 3:1, not 4.5:1.
EDGE_PAIRS = [
    ("rule-strong", "bg-panel", "a control border"),
    ("rule-strong", "bg", "a panel edge on the page"),
    ("probe", "bg-panel", "the lit arrow and the hot bucket"),
    ("evict", "bg-panel", "the walker outline"),
    ("settled", "bg-panel", "an occupied bucket outline"),
    ("stash", "stash-soft", "the dashed stash tray"),
]

# The element chips are drawn as hsl(hue 55% CHIP_L%) on whatever fill the
# bucket has.
CHIP_SAT = 55
CHIP_BACKGROUNDS = ["bg-panel", "settled-soft", "probe-soft", "evict-soft"]


def srgb_lum(rgb: tuple[float, float, float]) -> float:
    c = [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in rgb]
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]


def to_rgb(value) -> tuple[float, float, float]:
    if isinstance(value, tuple):
        return value
    h = value.lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    return tuple(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))


def ratio(a, b) -> float:
    la, lb = srgb_lum(to_rgb(a)), srgb_lum(to_rgb(b))
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)


def parse_tokens() -> tuple[dict[str, str], dict[str, str]]:
    """Light tokens from bare :root, dark from the [data-theme="dark"] block."""
    css = BASE_CSS.read_text()
    blocks = re.findall(r"(:root(?:\[data-theme=\"dark\"\])?)\s*\{(.*?)\n\}", css, re.S)
    light: dict[str, str] = {}
    dark: dict[str, str] = {}
    for selector, body in blocks:
        target = dark if "dark" in selector else light
        for name, value in re.findall(
                r"--([a-z-]+)\s*:\s*(#[0-9a-fA-F]{3,8}|\d+%)\s*;", body):
            target[name] = value
    # The media-query block must repeat the same values as [data-theme="dark"].
    media = re.search(r"@media \(prefers-color-scheme: dark\).*?:root:not\(\[data-theme=\"light\"\]\)\s*\{(.*?)\n  \}",
                      css, re.S)
    media_tokens = {}
    if media:
        for name, value in re.findall(
                r"--([a-z-]+)\s*:\s*(#[0-9a-fA-F]{3,8}|\d+%)\s*;", media.group(1)):
            media_tokens[name] = value
    return light, dark, media_tokens


def chip_lightness(tokens: dict[str, str]) -> float:
    """--chip-l is a percentage, so it is not in the hex token map."""
    m = tokens.get("chip-l")
    if m is None:
        raise SystemExit("[14] FATAL: --chip-l is not defined for this theme")
    return float(m.rstrip("%"))


def hues() -> list[int]:
    m = re.search(r"const HUES = \[([^\]]+)\]", (REPO / "docs" / "js" / "fmt.js").read_text())
    if not m:
        raise SystemExit("[14] FATAL: the categorical hue list was not found in fmt.js")
    return [int(x) for x in m.group(1).split(",")]


def main() -> int:
    light, dark, media = parse_tokens()
    light_pct = light
    dark_pct = {**light, **dark}
    # Percentages are not colours; keep them out of the ratio loops.
    light = {k: v for k, v in light.items() if v.startswith("#")}
    dark = {k: v for k, v in dark.items() if v.startswith("#")}
    media = {k: v for k, v in media.items() if v.startswith("#")}
    problems: list[str] = []
    checks = 0

    # The two dark blocks must agree, or the toggle and the system setting
    # disagree about what dark means.
    for name, value in dark.items():
        checks += 1
        if name in media and media[name] != value:
            problems.append(f"dark token --{name}: [data-theme] says {value}, "
                            f"the media query says {media[name]}")
    for name in media:
        checks += 1
        if name not in dark:
            problems.append(f"--{name} is set in the media query but not in [data-theme=dark]")

    for theme_name, tokens in (("light", light), ("dark", {**light, **dark})):
        for fg, bg, what in TEXT_PAIRS:
            checks += 1
            if fg not in tokens or bg not in tokens:
                problems.append(f"{theme_name}: unknown token in ({fg}, {bg})")
                continue
            r = ratio(tokens[fg], tokens[bg])
            if r < TEXT_MIN:
                problems.append(f"{theme_name}: --{fg} on --{bg} is {r:.2f}, "
                                f"needs {TEXT_MIN} ({what})")
        for fg, bg, what in EDGE_PAIRS:
            checks += 1
            r = ratio(tokens[fg], tokens[bg])
            if r < EDGE_MIN:
                problems.append(f"{theme_name}: --{fg} against --{bg} is {r:.2f}, "
                                f"needs {EDGE_MIN} ({what})")

    # The element chips, every hue on every fill they can land on. Light only:
    # the dark theme keeps the chip colour but the fills are dark, and the same
    # loop covers it below.
    for theme_name, tokens in (("light", light_pct), ("dark", dark_pct)):
        lightness = chip_lightness(tokens)
        for hue in hues():
            rgb = colorsys.hls_to_rgb(hue / 360, lightness / 100, CHIP_SAT / 100)
            for bg in CHIP_BACKGROUNDS:
                checks += 1
                r = ratio(rgb, tokens[bg])
                if r < TEXT_MIN:
                    problems.append(f"{theme_name}: element chip hue {hue} at "
                                    f"{lightness}% on --{bg} is {r:.2f}, "
                                    f"needs {TEXT_MIN}")

    if problems:
        for p in problems:
            print(f"[14] {p}", file=sys.stderr)
        print(f"\n[14] {checks} pairs, {len(problems)} below the threshold", file=sys.stderr)
        return 1
    print(f"[14] {checks} colour pairs across both themes, all at or above "
          f"{TEXT_MIN}:1 for text and {EDGE_MIN}:1 for edges")
    return 0


if __name__ == "__main__":
    sys.exit(main())
