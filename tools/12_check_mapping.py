#!/usr/bin/env python3
"""Map every upstream TEST() onto the conformance check that re-expresses it.

"The conformance suite re-expresses every assertion the reference's own tests
make" is a transcription claim, and a transcription claim that nobody checks is
worth nothing. This program checks it:

  1. It reads every TEST(Suite, Name) out of the pinned reference's test files.
  2. It runs tools/cxx/conformance_test, which prints the ids of the groups it
     ran on a CHECK-IDS line.
  3. It fails if an upstream test maps to nothing, maps to an id that does not
     exist, or is waived without a reason.

It also writes the table into notes/test-mapping.md, so the document and the
code cannot drift apart.

Usage:  python3 tools/12_check_mapping.py [--check]
"""
from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DPF = REPO / ".work" / "dpf" / "pir" / "hashing"
BIN = REPO / ".work" / "build" / "conformance_test"
OUT = REPO / "notes" / "test-mapping.md"

TEST_FILES = [
    "cuckoo_hash_table_test.cc",
    "multiple_choice_hash_table_test.cc",
    "simple_hash_table_test.cc",
    "sha256_hash_family_test.cc",
    "hash_family_test.cc",
    "farm_hash_family_test.cc",
    "hash_family_config_test.cc",
]

# upstream "Suite.Name" -> the conformance group id that re-expresses it.
MAPPING = {
    # cuckoo_hash_table_test.cc
    "CuckooHashTableTest.TestInsert": "CK-INSERT",
    "CuckooHashTableTest.TestStashLimit": "CK-STASH-LIMIT",
    "CuckooHashTable.TestDefaultUnlimitedStash": "CK-UNLIMITED",
    "CuckooHashTable.FailsIfNumBucketsNegative": "CK-VALIDATE",
    "CuckooHashTable.FailsIfNumHashFunctionsLessThanTwo": "CK-VALIDATE",
    "CuckooHashTable.FailsIfMaxRelocationsNegative": "CK-VALIDATE",
    "CuckooHashTable.FailsIfMaxStashSizeNegative": "CK-VALIDATE",
    # multiple_choice_hash_table_test.cc
    "MultipleChoiceHashTableTest.TestInsert": "MC-INSERT-OVERFLOW",
    "MultipleChoiceHashTableTest.TestOverflow": "MC-INSERT-OVERFLOW",
    "MultipleChoiceHashTable.FailsIfNumBucketsNegative": "MC-SH-VALIDATE",
    "MultipleChoiceHashTable.FailsIfNumHashFunctionsNegative": "MC-SH-VALIDATE",
    "MultipleChoiceHashTable.FailsIfMaxBucketSizeNegative": "MC-SH-VALIDATE",
    # simple_hash_table_test.cc
    "SimpleHashTableTest.TestInsert": "SH-INSERT-OVERFLOW",
    "SimpleHashTableTest.TestOverflow": "SH-INSERT-OVERFLOW",
    "SimpleHashTable.FailsIfNumBucketsNegative": "MC-SH-VALIDATE",
    "SimpleHashTable.FailsIfNumHashZero": "MC-SH-VALIDATE",
    "SimpleHashTable.FailsIfMaxBucketSizeNegative": "MC-SH-VALIDATE",
    # sha256_hash_family_test.cc
    "Sha256HashFunction.IsAHashFunction": "SHA-CAVP",
    "Sha256HashFamily.IsAHashFamily": "SHA-CAVP",
    "Sha256HashFamily.HashesCorrectly": "SHA-CAVP",
    # hash_family_test.cc
    "HashTableTest.FailsIfNumHashFunctionsNegative": "HF-SEEDS",
    "HashTableTest.WrapWithSeedPrependsSeed": "HF-SEEDS",
    # farm_hash_family_test.cc
    "FarmHashFunction.IsAHashFunction": "FARM-HASH",
    "FarmHashFamily.IsAHashFamily": "FARM-HASH",
    "FarmHashFamily.HashesCorrectly": "FARM-HASH",
}

# Upstream tests that the conformance suite does not re-express, each with the
# reason. These are covered by the archived run of the reference's own suite in
# notes/reference-test-run/, not by a transcription.
WAIVED = {
    "CreateHashFamilyFromConfig.FailsOnUnspecifiedHashFunction":
        "needs the generated protobuf",
    "CreateHashFamilyFromConfig.FailsOnUnknownHashFunction":
        "needs the generated protobuf",
    "CreateHashFamilyFromConfig.FailsOnEmptySeed":
        "needs the generated protobuf",
    "CreateHashFamilyFromConfig.ReturnsSha256HashFunction":
        "needs the generated protobuf",
}
WAIVER_REASON = (
    "`hash_family_config.cc` reads a `HashFamilyConfig` protobuf. Building it "
    "would pull protobuf and its code generator into the CMake shim, and no "
    "shipped byte goes through that code path: every trace names its hash "
    "family directly. These four are covered by the archived run of the "
    "reference's own suite, which is green at the pin."
)

# Conformance groups that have no upstream counterpart. They lock the behavior
# the site teaches, so that a re-pin of the reference is a reviewed act.
EXTRA = {
    "RNG-LAW": "the index mapping, against golden draws from the real abseil",
    "Q1-Q2": "the hash function is drawn on every attempt, the first included",
    "Q4": "duplicates are allowed, so one key can occupy two buckets",
    "Q5": "max_relocations = 0 sends everything to the stash",
    "Q8": "a bounded stash gives an error, never a rehash",
    "MC-TIE": "the first minimum keeps the choice on a tie",
    "SH-DUP-CAP": "duplicate candidates push a bucket past max_bucket_size",
    "PROD-PARAMS": "the production constants and the truncating bucket count",
}


def die(msg: str) -> None:
    print(f"[12] FATAL: {msg}", file=sys.stderr)
    raise SystemExit(1)


def upstream_tests() -> dict[str, list[str]]:
    found: dict[str, list[str]] = {}
    for name in TEST_FILES:
        path = DPF / name
        if not path.is_file():
            die(f"{path} is missing; run tools/00_fetch_reference.sh")
        text = path.read_text()
        cases = re.findall(r"^TEST(?:_F)?\(\s*(\w+)\s*,\s*(\w+)\s*\)", text, re.M)
        found[name] = [f"{a}.{b}" for a, b in cases]
    return found


def conformance_ids() -> list[str]:
    if not BIN.is_file():
        die(f"{BIN} is missing; run tools/01_build.sh")
    out = subprocess.run([str(BIN)], capture_output=True, text=True)
    if out.returncode != 0:
        die("the conformance suite itself failed; fix that before mapping")
    for line in out.stdout.splitlines():
        if line.startswith("CHECK-IDS:"):
            return line.split(":", 1)[1].split()
    die("the conformance suite printed no CHECK-IDS line")
    return []


def main() -> int:
    tests = upstream_tests()
    ids = set(conformance_ids())
    problems: list[str] = []
    total = 0

    for name, cases in tests.items():
        for case in cases:
            total += 1
            if case in WAIVED:
                continue
            target = MAPPING.get(case)
            if target is None:
                problems.append(f"{name}: TEST({case.replace('.', ', ')}) maps to nothing. "
                                "Add a check to tools/cxx/conformance_test.cc, or waive it "
                                "with a reason in tools/12_check_mapping.py.")
            elif target not in ids:
                problems.append(f"{name}: TEST({case.replace('.', ', ')}) maps to "
                                f"{target!r}, which the conformance suite did not run.")

    known = set().union(*tests.values()) if tests else set()
    for case in MAPPING:
        if case not in known:
            problems.append(f"the mapping names {case!r}, which no longer exists upstream.")
    for case in WAIVED:
        if case not in known:
            problems.append(f"the waiver names {case!r}, which no longer exists upstream.")

    # Render the table. Doing it here is what stops the document drifting.
    lines = [
        "# Upstream test coverage",
        "",
        "Generated by `tools/12_check_mapping.py`. Do not edit by hand.",
        "",
        f"The reference has **{total}** `TEST()` cases across {len(tests)} files at the pin. "
        f"All {total} pass under Bazel (see `notes/reference-test-run/`). "
        f"**{total - len(WAIVED)}** of them are also re-expressed in "
        "`tools/cxx/conformance_test.cc`, which runs in the normal pipeline "
        "without Bazel.",
        "",
        "| upstream file | `TEST()` | conformance id |",
        "|---|---|---|",
    ]
    for name, cases in tests.items():
        for case in cases:
            suite, tname = case.split(".", 1)
            target = ("_waived_" if case in WAIVED else MAPPING.get(case, "**MISSING**"))
            lines.append(f"| `{name}` | `{suite}.{tname}` | `{target}` |")
    lines += [
        "",
        f"## The {len(WAIVED)} waived cases",
        "",
        WAIVER_REASON,
        "",
    ]
    for case, why in WAIVED.items():
        lines.append(f"- `{case}` — {why}")
    lines += [
        "",
        "## Conformance checks with no upstream counterpart",
        "",
        "These lock the behavior this site teaches, so that a re-pin of the "
        "reference is a reviewed act rather than a silent change.",
        "",
    ]
    for cid, why in EXTRA.items():
        mark = "" if cid in ids else "  **(not run)**"
        lines.append(f"- `{cid}` — {why}{mark}")
        if cid not in ids:
            problems.append(f"the extra check {cid!r} is documented but was not run.")
    text = "\n".join(lines) + "\n"

    if "--check" in sys.argv:
        if not OUT.is_file() or OUT.read_text() != text:
            problems.append("notes/test-mapping.md is out of date; "
                            "run tools/12_check_mapping.py")
    else:
        OUT.write_text(text, encoding="utf-8")

    if problems:
        for p in problems:
            print(f"[12] {p}", file=sys.stderr)
        print(f"\n[12] {len(problems)} gap(s)", file=sys.stderr)
        return 1
    print(f"[12] {total} upstream tests, {total - len(WAIVED)} re-expressed, "
          f"{len(WAIVED)} waived with a reason, {len(EXTRA)} extra checks. No gaps.")
    print(f"[12] wrote {OUT.relative_to(REPO)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
