#!/usr/bin/env python3
"""Search for scenarios in which specific teaching events provably occur.

A scenario is a (preset, element list) pair. This program tries candidates
against the Python re-derivation in tools/cuckoo_model.py until the predicate
holds, then writes tools/scenarios.txt. The authoritative recording still comes
from the C++ (tools/cxx/trace_gen.cc, which links the real reference), so the
miner only proposes; it never produces shipped data.

Deterministic: the pool and the enumeration order are fixed, so a re-run gives
the same file.

Usage:  python3 tools/mine.py [--check]
        --check  fail if tools/scenarios.txt would change
"""
from __future__ import annotations

import itertools
import json
import sys
from pathlib import Path
from typing import Callable, Optional

sys.path.insert(0, str(Path(__file__).resolve().parent))
from cuckoo_model import (CuckooHashTable, MultipleChoiceHashTable, SimpleHashTable,
                          per_function_seeds, sha256_ladder)

OUT = Path(__file__).resolve().parent / "scenarios.txt"
# What each scenario actually achieved. A scenario is named for an event, and a
# name is not evidence that the event is in the trace.
PREDICATES = Path(__file__).resolve().parent / "scenario-predicates.json"

# Short, concrete, easy to say out loud, and easy to tell apart in a diagram.
# Three letters keeps every chip the same width in the diagrams.
POOL = ["ant", "bee", "cat", "dog", "eel", "fox", "gnu", "hen",
        "jay", "koi", "owl", "pig", "ram", "yak"]


def run_cuckoo(m, k, budget, stash, elements):
    t = CuckooHashTable(per_function_seeds(k), m, budget, stash)
    ops = [t.insert(e.encode()) for e in elements]
    return t, ops


def achieved(m, k, budget, stash, elements) -> dict:
    """Measure a cuckoo run, so the manifest can state what is really in it."""
    t, ops = run_cuckoo(m, k, budget, stash, elements)
    per_op = [evictions(o) for o in ops]
    probes = [buckets_probed(o) for o in ops]
    revisits = max(
        (max((p.count(b) for b in set(p)), default=0) for p in probes), default=0)
    return {
        "inserts": len(ops),
        "cleanPlacements": sum(1 for o in ops if evictions(o) == 0
                               and any(e.kind == "place" for e in o.events)),
        "insertsWithOneEviction": sum(1 for n in per_op if n == 1),
        "longestEvictionChain": max(per_op, default=0),
        "totalEvictions": sum(per_op),
        "maxProbesOfOneBucketInAnInsert": revisits,
        "stashPushes": sum(1 for o in ops for e in o.events
                           if e.kind == "stash_push"),
        "errors": sum(1 for o in ops if o.status != "ok"),
        "finalOccupied": sum(1 for x in t.table if x is not None),
        "finalStash": len(t.stash),
    }


def evictions(op) -> int:
    return sum(1 for e in op.events if e.kind == "evict")


def buckets_probed(op) -> list[int]:
    return [e.data["bucket"] for e in op.events if e.kind == "hash"]


# --------------------------------------------------------------- the predicates

def p_first_contact(t, ops) -> bool:
    clean = any(evictions(o) == 0 and o.events and o.events[-1].kind == "place" for o in ops)
    single = any(evictions(o) == 1 for o in ops)
    return clean and single and all(o.status == "ok" for o in ops) and not t.stash


def p_chain(t, ops) -> bool:
    return any(evictions(o) >= 4 for o in ops)


def p_pingpong(t, ops) -> bool:
    for o in ops:
        probes = buckets_probed(o)
        if len(probes) < 3:
            continue
        # The same bucket probed at least twice inside one insert, with an
        # eviction each time: the walk went back where it came from.
        for b in set(probes):
            if probes.count(b) >= 2 and evictions(o) >= 2:
                return True
    return False


def p_stash(t, ops) -> bool:
    pushes = sum(1 for o in ops for e in o.events if e.kind == "stash_push")
    placed = sum(1 for o in ops if any(e.kind == "place" for e in o.events))
    return pushes >= 1 and placed >= 2 and all(o.status == "ok" for o in ops)


def p_stash_full(t, ops) -> bool:
    if not ops or ops[-1].status != "error":
        return False
    return all(o.status == "ok" for o in ops[:-1]) and len(ops) >= 4


def p_dense(t, ops) -> bool:
    """A run that fills most of the table and still keeps the stash small."""
    occupied = sum(1 for x in t.table if x is not None)
    return occupied >= t.m - 1 and len(t.stash) <= 2 and all(o.status == "ok" for o in ops)


# ------------------------------------------------------------------- the search

def search(m, k, budget, stash, n, predicate, pool=None, permute=False,
           max_tries=200000) -> Optional[list[str]]:
    pool = pool or POOL
    tries = 0
    source = (itertools.permutations(pool, n) if permute
              else itertools.combinations(pool, n))
    for combo in source:
        tries += 1
        if tries > max_tries:
            break
        t, ops = run_cuckoo(m, k, budget, stash, list(combo))
        if predicate(t, ops):
            return list(combo)
    return None


def need(name, elements) -> list[str]:
    if elements is None:
        print(f"[mine] FATAL: no candidate found for {name}", file=sys.stderr)
        raise SystemExit(1)
    print(f"[mine] {name:20s} {','.join(elements)}")
    return elements


def find_simple_overflow(m: int, cap: int) -> Optional[tuple[str, str]]:
    """A word whose two candidates coincide, plus a filler with exactly one."""
    seeds = per_function_seeds(2)
    for w in POOL:
        a = sha256_ladder(seeds[0], w.encode(), m).bucket
        b = sha256_ladder(seeds[1], w.encode(), m).bucket
        if a != b:
            continue
        for f in POOL:
            if f == w:
                continue
            fa = sha256_ladder(seeds[0], f.encode(), m).bucket
            fb = sha256_ladder(seeds[1], f.encode(), m).bucket
            if (fa == a) + (fb == a) != 1:
                continue
            t = SimpleHashTable(seeds, m, cap)
            if t.insert(f.encode()).status != "ok":
                continue
            before = len(t.table[a])
            if before != cap - 1:
                continue
            r = t.insert(w.encode())
            if r.status == "ok" and len(t.table[a]) > cap:
                return f, w
    return None


def find_mcht_tie(m: int) -> Optional[str]:
    seeds = per_function_seeds(2)
    for w in POOL:
        a = sha256_ladder(seeds[0], w.encode(), m).bucket
        b = sha256_ladder(seeds[1], w.encode(), m).bucket
        if a != b:
            return w
    return None


# ------------------------------------------------------------------ the scenarios

def build() -> tuple[list[tuple], dict]:
    rows: list[tuple] = []
    facts: dict[str, dict] = {}

    def row(sid, structure, m, k, budget, stash, cap, seedhex, elements, lookups,
            title, teaches):
        rows.append((sid, structure, m, k, budget, stash, cap, seedhex,
                     ",".join(elements), ",".join(lookups) if lookups else "-",
                     title, teaches))
        if structure == "cuckoo":
            facts[sid] = achieved(m, k, budget, stash, elements)

    # --- the tour's own scenario, chosen by hand ----------------------------
    row("CK-classroom", "cuckoo", 6, 3, 4, None, None, "",
        ["ant", "bee", "cat", "dog"], ["cat", "yak"],
        "Four words, six buckets",
        "the core loop: draw, hash, place or evict")

    # The plan proposed a budget of three here. No four-bucket two-function run
    # over this pool places an element after exactly one eviction inside three
    # attempts, so the budget is six: the scenario has to contain the event it
    # is named for.
    row("CK-first-contact", "cuckoo", 4, 2, 6, None, None, "",
        need("CK-first-contact", search(4, 2, 6, None, 4, p_first_contact)), [],
        "One clean landing, one eviction",
        "what an insert does when the bucket is free, and when it is not")

    row("CK-chain", "cuckoo", 6, 3, 8, None, None, "",
        need("CK-chain", search(6, 3, 8, None, 6, p_chain)), [],
        "A long displacement chain",
        "one insert can move several elements before it settles")

    row("CK-pingpong", "cuckoo", 4, 2, 6, None, None, "",
        need("CK-pingpong", search(4, 2, 6, None, 4, p_pingpong)), [],
        "The walk goes back where it came from",
        "a random walk is not a smart walk")

    row("CK-stash", "cuckoo", 6, 3, 2, None, None, "",
        need("CK-stash", search(6, 3, 2, None, 5, p_stash)), [],
        "The relocation budget runs out",
        "the stash is the reference's answer to a failed walk")

    row("CK-stash-full", "cuckoo", 4, 2, 2, 1, None, "",
        need("CK-stash-full", search(4, 2, 2, 1, 6, p_stash_full)), [],
        "The only hard failure",
        "a bounded stash turns overflow into an error")

    row("CK-budget-zero", "cuckoo", 6, 3, 0, None, None, "",
        ["ant", "bee", "cat"], [],
        "A budget of zero",
        "max_relocations = 0 sends every element straight to the stash")

    row("CK-duplicate", "cuckoo", 6, 3, 4, None, None, "",
        ["ant", "bee", "ant"], ["ant"],
        "The same key twice",
        "the reference has no membership test, so a key can occupy two slots")

    row("CK-order-a", "cuckoo", 6, 3, 4, None, None, "",
        ["cat", "dog", "ant", "bee"], [],
        "Four words, one order",
        "the build is deterministic once the order is fixed")
    row("CK-order-b", "cuckoo", 6, 3, 4, None, None, "",
        ["dog", "cat", "bee", "ant"], [],
        "The same four words, another order",
        "the same set of keys, a different table")

    row("CK-degenerate", "cuckoo", 1, 2, 4, None, None, "",
        ["ant", "bee"], [],
        "One bucket, two hash functions",
        "what the validation permits, and what then happens")

    row("CK-dense", "cuckoo", 8, 3, 8, None, None, "",
        need("CK-dense", search(8, 3, 8, None, 8, p_dense)), [],
        "A table that is nearly full",
        "how the walk lengthens as the load factor climbs")

    # Production parameters at a size a person can still follow:
    # k = 3, num_buckets = int64(1.5 * n), max_relocations = n, unlimited stash.
    n = 8
    row("CK-production", "cuckoo", int(1.5 * n), 3, n, None, None, "",
        POOL[:n], ["ant", "yak"],
        "The production recipe, at eight elements",
        "k = 3, buckets = 1.5 x n, budget = n, an unlimited stash")

    # The same recipe with the 16-byte session seed the server generates.
    row("CK-seeded", "cuckoo", int(1.5 * n), 3, n, None, None,
        "000102030405060708090a0b0c0d0e0f", POOL[:n], [],
        "The same recipe with a session seed",
        "in production every hash function is seeded with 16 shared bytes")

    # The unit test's own constants, with SHA-256 in place of the test's FarmHash.
    row("CK-test-preset", "cuckoo", 100, 3, 50, 3, None, "",
        [f"Element number {i}" for i in range(96)], [],
        "The unit test's own parameters",
        "the same shape at a size that no longer fits on one screen")

    # --- multiple choice -----------------------------------------------------
    tie = find_mcht_tie(6)
    if tie is None:
        print("[mine] FATAL: no MCHT tie case", file=sys.stderr)
        raise SystemExit(1)
    row("MC-least-loaded", "multiple_choice", 6, 2, 0, None, None, "",
        ["ant", "bee", "cat", "dog", "eel", "fox"], [],
        "The least loaded of two buckets",
        "d-choice hashing compares counts and never evicts")
    row("MC-bucket-full", "multiple_choice", 4, 2, 0, None, 2, "",
        ["ant", "bee", "cat", "dog", "eel", "fox", "gnu"], [],
        "Every candidate is full",
        "the capacity failure of a bucketed table")

    # --- simple hashing ------------------------------------------------------
    row("SH-fanout", "simple", 6, 3, 0, None, None, "",
        ["ant", "bee", "cat"], [],
        "One element, k copies",
        "the server side of a PIR protocol stores every candidate")

    hit = find_simple_overflow(6, 2)
    if hit is None:
        print("[mine] FATAL: no SimpleHashTable overflow case at m=6", file=sys.stderr)
        raise SystemExit(1)
    filler, dup = hit
    print(f"[mine] {'SH-overflow':20s} filler={filler} duplicate-candidate={dup}")
    row("SH-overflow", "simple", 6, 2, 0, None, 2, "",
        [filler, dup], [],
        "A capacity test that runs twice",
        "why the exact order of the two loops matters")

    return rows, facts


def main() -> int:
    rows, facts = build()
    lines = [
        "# Scenarios, one per line, written by tools/mine.py.",
        "# tools/cxx/trace_gen.cc records each one from the real reference.",
        "#",
        "# id | structure | m | k | budget | stash | maxBucket | familySeedHex |"
        " elements | lookups | title | teaches",
        "#",
        "# A dash means the option is not set. structure is cuckoo,"
        " multiple_choice or simple.",
    ]
    for r in rows:
        sid, structure, m, k, budget, stash, cap, seedhex, elements, lookups, title, teaches = r
        lines.append("|".join([
            sid, structure, str(m), str(k), str(budget),
            "-" if stash is None else str(stash),
            "-" if cap is None else str(cap),
            seedhex, elements, lookups, title, teaches,
        ]))
    text = "\n".join(lines) + "\n"
    facts_text = json.dumps(
        {"note": "What each cuckoo scenario actually contains, measured by "
                 "tools/cuckoo_model.py. A scenario named for an event has to "
                 "hold that event.",
         "scenarios": facts},
        indent=1, sort_keys=True) + "\n"

    if "--check" in sys.argv:
        stale = []
        if not OUT.is_file() or OUT.read_text() != text:
            stale.append("tools/scenarios.txt")
        if not PREDICATES.is_file() or PREDICATES.read_text() != facts_text:
            stale.append("tools/scenario-predicates.json")
        if stale:
            print(f"[mine] out of date: {', '.join(stale)}", file=sys.stderr)
            return 1
        print("[mine] tools/scenarios.txt and the predicate record are up to date")
        return 0
    OUT.write_text(text)
    PREDICATES.write_text(facts_text)
    print(f"[mine] wrote {OUT.name} with {len(rows)} scenarios "
          f"and {PREDICATES.name} with {len(facts)} measured runs")

    # The scenarios named for an event must contain it.
    must = {
        "CK-first-contact": ("insertsWithOneEviction", 1),
        "CK-chain": ("longestEvictionChain", 4),
        "CK-pingpong": ("maxProbesOfOneBucketInAnInsert", 2),
        "CK-stash": ("stashPushes", 1),
        "CK-stash-full": ("errors", 1),
        "CK-budget-zero": ("stashPushes", 1),
    }
    bad = 0
    for sid, (key, least) in must.items():
        got = facts.get(sid, {}).get(key, 0)
        ok = got >= least
        bad += not ok
        print(f"[mine]   {sid:18s} {key} = {got} (needs at least {least}) "
              f"{'ok' if ok else 'MISSING'}")
    if bad:
        print(f"[mine] {bad} scenario(s) do not contain the event they are named for",
              file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
