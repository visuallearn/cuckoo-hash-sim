#!/usr/bin/env python3
"""Check the user-facing prose of the site against ASD-STE100 structural rules.

Extracts prose from the JS string literals, the HTML text and data/tour.json, then
reports violations by rule number. It cannot check words against the official ASD
dictionary (that is copyrighted and not redistributable), so it checks the rules
that are mechanically decidable:

  Rule 6.3  descriptive sentences of 25 words or fewer
  Rule 5.1  procedural sentences of 20 words or fewer
  Rule 8.1  no semicolons
  Rule 4.2  no contractions
  Rule 3.4  no present perfect ("has been", "have been")
  Rule 3.2  approved modals only: can, will, must
  Rule 9.3  no phrasal verbs from a known list
  Rule 1.11 one term per concept (no synonym rotation)
  Rule 1.14 American spelling
  Rule 6.6  paragraphs of six sentences or fewer
  GR-6      no Latin abbreviations

Rule 8.6: quoted text, identifiers and numbers with units count as one word.
"""
from __future__ import annotations

import html
import json
import re
import sys
from pathlib import Path

DOCS = Path(__file__).resolve().parent.parent / "docs"

# --- what counts as prose ---------------------------------------------------
# A string literal is prose when it has at least three words of two or more
# letters and is not a selector, path, URL, or format template.
NOT_PROSE = re.compile(
    r"^(https?:|data/|#/|\.|/|;|--|[A-Za-z-]+:[^ ]|margin|padding|flex|grid|outline|"
    r"display|color:|width|border|cursor|font|position|text-anchor|transform|aria-|"
    r"[0-9. ]+$)")
PROSE_WORDS = re.compile(r"[A-Za-z]{2,}")

BANNED_MODALS = re.compile(r"\b(should|would|may|might|could)\b", re.I)
CONTRACTIONS = re.compile(
    r"\b(it's|don't|doesn't|isn't|won't|can't|you're|that's|there's|we've|you'll|"
    r"let's|didn't|hasn't|haven't|aren't|wasn't|weren't|we're|they're|I'm)\b", re.I)
PERFECT = re.compile(r"\b(has|have|had)\s+been\b", re.I)
LATIN = re.compile(r"\b(e\.g\.|i\.e\.|etc\.|viz\.|cf\.)", re.I)
PHRASAL = [
    "hand out", "hand off", "pick out", "sort out", "figure out", "work out",
    "worked out", "carry out", "carries out", "make up", "makes up", "bother with",
    "end up", "ends up", "turn out", "turns out", "give up", "gives up",
]
# Rule 4.2 / 4.5: STE is short sentences with complete grammar, never telegraph
# style. A sentence must not start with a bare third-person verb (a fragment), and
# a countable noun needs an article or a demonstrative.
FRAGMENT_VERB = re.compile(
    r"^(Takes|Gives|Shows|Holds|Reads|Writes|Returns|Uses|Needs|Makes|Calculates|"
    r"Contains|Keeps|Sends|Adds|Removes)\b")
BARE_NOUN = re.compile(
    r"^(Output|Input|Result|Value|Bucket|Table|Element|Stash|Digest|Seed|Order|Cost|"
    r"Walk|Budget|Draw|Hash)\s+"
    r"(is|was|has|holds|becomes|shows|goes|stays|comes|lands|contains|needs)\b")

BRITISH = {
    "licence": "license", "optimiser": "optimizer", "optimise": "optimize",
    "visualise": "visualize", "visualised": "visualized", "colour": "color",
    "behaviour": "behavior", "centre": "center", "analyse": "analyze",
    "organisation": "organization", "normalise": "normalize", "normalised": "normalized",
    "maths": "math", "modelling": "modeling", "labelled": "labeled",
}
# Rule 1.11 / 9.4: one term per concept. Left column is banned, right is chosen.
ROTATIONS = {
    "verify": "make sure that / test", "verified": "the test passes",
    "confirm": "make sure that", "validate": "test", "ensure": "make sure that",
    "check that": "make sure that", "checks that": "makes sure that",
    "display": "show", "displays": "shows", "render": "show", "renders": "show",
    "execute": "run", "executes": "runs", "invoke": "run", "invokes": "run",
    "pick": "select", "picks": "select",
    # One name per concept (Rule 1.11). The left column is banned here because
    # the site already uses the word on the right for the same thing.
    "slot": "bucket",
    "cell": "bucket",
    "entry": "element",
    "item": "element",
    "kick out": "push out",
    "kicked out": "pushed out",
    "relocate": "move",
    "relocated": "moved",
}
# Words allowed to keep their form even though the list above bans them: proper
# names, code identifiers and the fixed titles of panels.
ALLOW_LINE = ("CuckooHashTable", "MultipleChoiceHashTable", "SimpleHashTable",
              "max_relocations", "max_stash_size", "max_bucket_size", "num_buckets",
              "hash_functions", "GetTable", "GetStash", "mt19937_64", "aria-label",
              "tools/", "uniform_int_distribution", "sha256_hash_family",
              "cuckoo_hash_table", "INTERNAL", "SHA-256", "abseil",
              # The reference's own error text and the terms it uses.
              "Cannot insert element", "the slot held", "the slot was free",
              "one slot", "a slot", "the slot", "slots")


# A regex literal can contain quote characters -- tour.js has one holding a
# backtick -- which derails a naive string scanner for the rest of the file.
# Blank them out first, keeping newlines so line numbers stay right.
REGEX_LIT = re.compile(
    r"([=(,:]|return|replace|split|match|test)(\s*)"
    r"(/(?![/*])(?:[^/\\\n\[]|\\.|\[(?:[^\]\\]|\\.)*\])+/[gimsuyd]*)")


def strip_regex(src: str) -> str:
    return REGEX_LIT.sub(lambda m: m.group(1) + m.group(2) + " " * len(m.group(3)), src)


def js_strings(src: str):
    """Yield (line, text) for every string literal in a JS source file."""
    src = strip_regex(src)
    i, line = 0, 1
    n = len(src)
    while i < n:
        c = src[i]
        if c == "\n":
            line += 1
            i += 1
            continue
        if c == "/" and i + 1 < n and src[i + 1] == "/":          # line comment
            while i < n and src[i] != "\n":
                i += 1
            continue
        if c == "/" and i + 1 < n and src[i + 1] == "*":          # block comment
            j = src.find("*/", i + 2)
            j = n if j < 0 else j + 2
            line += src.count("\n", i, j)
            i = j
            continue
        if c in "'\"`":
            quote, start, j = c, line, i + 1
            buf = []
            while j < n:
                if src[j] == "\\":
                    buf.append(src[j:j + 2])
                    j += 2
                    continue
                if src[j] == quote:
                    break
                if src[j] == "\n":
                    line += 1
                buf.append(src[j])
                j += 1
            yield start, "".join(buf)
            i = j + 1
            continue
        i += 1


def collect_markdown(path: Path) -> list[tuple[str, int, str]]:
    """Prose from a Markdown or plain-text file.

    Fenced code blocks, inline code, link targets, table rules and HTML comments
    are technical names or markup (Rules 1.5, 8.6), so they are removed before the
    prose is checked.
    """
    out: list[tuple[str, int, str]] = []
    lines = path.read_text().splitlines()
    fenced = False
    for i, raw in enumerate(lines, start=1):
        if raw.lstrip().startswith("```"):
            fenced = not fenced
            continue
        if fenced:
            continue
        t = raw.strip()
        if not t or t.startswith(("<!--", "-->", "|--", "[", "#|")):
            continue
        if set(t) <= set("|-: "):          # table rule
            continue
        t = re.sub(r"`[^`]*`", "CODE", t)   # inline code counts as one word
        t = re.sub(r"!?\[([^\]]*)\]\([^)]*\)", r"\1", t)   # links -> their text
        t = re.sub(r"!?\[([^\]]*)\]\[[^\]]*\]", r"\1", t)  # reference links
        t = re.sub(r"^#+\s*", "", t)       # heading marks
        t = re.sub(r"^[-*+]\s+", "", t)    # list marks
        t = re.sub(r"^\d+\.\s+", "", t)
        t = t.strip("|").replace("|", ". ")  # a table row is a set of short cells
        t = t.strip()
        if len(PROSE_WORDS.findall(t)) >= 3:
            out.append((path.name, i, t))
    return out


def collect() -> list[tuple[str, int, str]]:
    """(source label, line, prose text) for everything a reader sees."""
    out = []
    for f in sorted(list(DOCS.glob("js/**/*.js"))):
        for line, text in js_strings(f.read_text()):
            t = text.strip()
            if NOT_PROSE.match(t) or len(PROSE_WORDS.findall(t)) < 3:
                continue
            out.append((str(f.relative_to(DOCS)), line, text))
    for f in (DOCS / "index.html", DOCS / "selftest.html"):
        src = f.read_text()
        body = re.sub(r"<script.*?</script>|<style.*?</style>", "", src, flags=re.S)
        for m in re.finditer(r">([^<>]{25,})<", body):
            # Entities such as &nbsp; end in a semicolon but are not punctuation.
            t = html.unescape(re.sub(r"\s+", " ", m.group(1))).strip()
            if len(PROSE_WORDS.findall(t)) >= 3:
                out.append((f.name, src[:m.start()].count("\n") + 1, t))
    # The scenario titles and the one-line summaries come from tools/scenarios.txt
    # and reach the reader through the manifest. They are prose too.
    man = json.loads((DOCS / "data" / "manifest.json").read_text())
    for sc in man.get("scenarios", []):
        out.append(("manifest.json:scenarios", 0, sc["title"]))
        out.append(("manifest.json:scenarios", 0, sc["teaches"]))

    tour = json.loads((DOCS / "data" / "tour.json").read_text())
    for i, st in enumerate(tour["steps"]):
        out.append(("tour.json", i + 1, st["title"]))
        for b in st["body"]:
            out.append(("tour.json", i + 1, b))
    return out


def sentences(text: str) -> list[str]:
    # Rule 8.6: a quoted or code-formatted run counts as one word.
    t = re.sub(r"`[^`]*`", "CODE", text)
    t = re.sub(r"\s+", " ", t).strip()
    return [s.strip() for s in re.split(r"(?<=[.!?:])\s+", t) if s.strip()]


def words(sentence: str) -> int:
    return len([w for w in sentence.split() if re.search(r"[A-Za-z0-9]", w)])


def main() -> int:
    findings: list[tuple[str, str, int, str]] = []
    # --file checks one Markdown or text file instead of the site.
    target = None
    if "--file" in sys.argv:
        target = Path(sys.argv[sys.argv.index("--file") + 1])
        if not target.is_file():
            print(f"[10] FATAL: {target} not found", file=sys.stderr)
            return 1

    def note(rule, src, line, detail):
        findings.append((rule, src, line, detail))

    for src, line, text in (collect_markdown(target) if target else collect()):
        low = text.lower()
        skip = any(a in text for a in ALLOW_LINE)

        # Procedural text starts with an imperative; everything else is descriptive.
        procedural = bool(re.match(
            r"(Select|Run|Put|Use|Make sure|Read|Compare|Go|See|Start|Install|Open|Set)\b", text))
        limit = 20 if procedural else 25

        sents = sentences(text)
        if len(sents) > 6:
            note("6.6", src, line, f"{len(sents)} sentences in one paragraph")
        for s in sents:
            n = words(s)
            if n > limit:
                note("5.1" if procedural else "6.3", src, line, f"{n} words: {s[:88]}")
            if FRAGMENT_VERB.match(s):
                note("4.2", src, line, f"sentence has no subject: {s[:70]}")
            if BARE_NOUN.match(s):
                note("4.5", src, line, f"noun needs an article: {s[:70]}")

        if ";" in text:
            note("8.1", src, line, f"semicolon: {text[:80]}")
        for m in CONTRACTIONS.finditer(text):
            note("4.2", src, line, f"contraction {m.group(0)!r}")
        for m in PERFECT.finditer(text):
            note("3.4", src, line, f"present perfect {m.group(0)!r}")
        for m in BANNED_MODALS.finditer(text):
            note("3.2", src, line, f"banned modal {m.group(0)!r}: {text[:70]}")
        for m in LATIN.finditer(text):
            note("GR-6", src, line, f"Latin abbreviation {m.group(0)!r}")
        for ph in PHRASAL:
            if ph in low:
                note("9.3", src, line, f"phrasal verb {ph!r}: {text[:70]}")
        for bad, good in BRITISH.items():
            if re.search(rf"\b{bad}\b", low):
                note("1.14", src, line, f"{bad!r} -> {good!r}")
        if not skip:
            # Identifiers inside `backticks` are technical names (Rule 1.5).
            bare = re.sub(r"`[^`]*`", " ", low)
            for bad, good in ROTATIONS.items():
                if re.search(rf"\b{re.escape(bad)}\b", bare):
                    note("1.11", src, line, f"{bad!r} -> use {good!r}: {text[:60]}")

    label = str(target) if target else "the site"
    if not findings:
        print(f"[10] STE structural check on {label}: clean")
        return 0
    by_rule: dict[str, list] = {}
    for rule, src, line, detail in findings:
        by_rule.setdefault(rule, []).append((src, line, detail))
    for rule in sorted(by_rule):
        print(f"[10] Rule {rule} — {len(by_rule[rule])} finding(s)")
        for src, line, detail in by_rule[rule]:
            print(f"       {src}:{line}  {detail}")
    print(f"\n[10] {len(findings)} finding(s)")
    return 1


if __name__ == "__main__":
    sys.exit(main())
