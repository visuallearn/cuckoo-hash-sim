#!/usr/bin/env python3
"""Re-derive every field of every shipped trace, from scratch, in Python.

This is the fidelity proof. The traces come from a C++ program that links the
real reference; this program recomputes the same values with hashlib, a
hand-written Mersenne Twister and a transcription of abseil's index mapping,
and compares every byte. Two implementations that agree on everything is the
evidence, and neither one is allowed to be the definition.

Nothing here reads the C++ output except to compare against it.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from cuckoo_model import (MASK32, CuckooHashTable, MultipleChoiceHashTable, MT19937_64,
                          SimpleHashTable, UniformIndex, lookup, per_function_seeds,
                          sha256_ladder)

REPO = Path(__file__).resolve().parent.parent
DATA = REPO / "docs" / "data"
TRACES = DATA / "traces"
SCENARIOS = REPO / "tools" / "scenarios.txt"
GOLDEN = REPO / "notes" / "rng-golden.txt"

checks = 0
fails: list[str] = []


def check(cond: bool, msg: str) -> bool:
    global checks
    checks += 1
    if not cond:
        fails.append(msg)
    return bool(cond)


def eq(got, want, msg: str) -> bool:
    return check(got == want, f"{msg}: got {got!r}, want {want!r}")


# --------------------------------------------------------------- golden draws

def verify_golden() -> None:
    if not GOLDEN.is_file():
        fails.append("notes/rng-golden.txt is missing; run tools/03_generate.sh")
        return
    per_k: dict[int, list[tuple[int, list[int]]]] = {}
    for line in GOLDEN.read_text().splitlines():
        if line.startswith("#") or not line.strip():
            continue
        f = line.split()
        k, n, j, nraw = int(f[0]), int(f[1]), int(f[2]), int(f[3])
        raws = [int(x) for x in f[4:]]
        eq(len(raws), nraw, f"golden k={k} n={n}: raw count")
        per_k.setdefault(k, []).append((j, raws))
    for k, rows in sorted(per_k.items()):
        idx = UniformIndex(k)
        bad = 0
        for n, (want_j, want_raws) in enumerate(rows):
            d = idx.draw()
            if d.j != want_j or d.raws != want_raws:
                bad += 1
                if bad < 4:
                    fails.append(f"golden k={k} n={n}: python j={d.j} raws={d.raws} "
                                 f"vs abseil j={want_j} raws={want_raws}")
        check(bad == 0, f"golden k={k}: {bad} of {len(rows)} draws differ")
    print(f"[04] golden draws: {sum(len(v) for v in per_k.values())} rows over "
          f"k={sorted(per_k)}")


# ------------------------------------------------------------------ scenarios

def read_scenarios() -> dict[str, dict]:
    out = {}
    for line in SCENARIOS.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        f = line.split("|")
        assert len(f) == 12, line
        out[f[0]] = {
            "structure": f[1], "m": int(f[2]), "k": int(f[3]), "budget": int(f[4]),
            "stash": None if f[5] == "-" else int(f[5]),
            "cap": None if f[6] == "-" else int(f[6]),
            "seedhex": f[7],
            "elements": [] if f[8] in ("", "-") else f[8].split(","),
            "lookups": [] if f[9] in ("", "-") else f[9].split(","),
            "title": f[10], "teaches": f[11],
        }
    return out


# ------------------------------------------------------------- step verifiers

def verify_hash_step(st: dict, seeds: list[bytes], m: int, tag: str) -> None:
    seed = seeds[st["j"]]
    data = st["input"].encode()
    L = sha256_ladder(seed, data, m)
    eq(st["seed"], seed.decode("latin-1"), f"{tag}: seed text")
    eq(st["seedHex"], seed.hex(), f"{tag}: seed hex")
    eq(st["preimageHex"], (seed + data).hex(), f"{tag}: preimage")
    eq(st["digestHex"], L.digest.hex(), f"{tag}: digest")
    eq(st["loHex"], "0x%032x" % L.lo, f"{tag}: lo")
    eq(st["hiHex"], "0x%032x" % L.hi, f"{tag}: hi")
    eq(st["nDec"], str(L.n), f"{tag}: N as one integer")
    eq(st["m"], m, f"{tag}: upper bound")
    lad = st["ladder"]
    eq(lad["r1"], L.r1, f"{tag}: r1")
    eq(lad["d2"], str(L.d2), f"{tag}: d2")
    eq(lad["d2Hex"], "0x%032x" % L.d2, f"{tag}: d2 hex")
    eq(lad["r2"], L.r2, f"{tag}: r2")
    eq(lad["d3"], str(L.d3), f"{tag}: d3")
    eq(lad["d3Hex"], "0x%032x" % L.d3, f"{tag}: d3 hex")
    eq(lad["r3"], L.r3, f"{tag}: r3")
    eq(st["bucket"], L.bucket, f"{tag}: bucket")
    check(L.r3 == L.n % m, f"{tag}: the ladder equals one 256-bit reduction")


def verify_draw_step(st: dict, want, k: int, tag: str) -> None:
    eq([int(x) for x in st["raw"]], want.raws, f"{tag}: raw words")
    eq(st["rawHex"], ["0x%016x" % r for r in want.raws], f"{tag}: raw words in hex")
    eq(st["j"], want.j, f"{tag}: hash-function index")
    eq(st["k"], k, f"{tag}: k")
    eq(st["redraws"], len(want.raws) - 1, f"{tag}: redraws")
    bits = want.raws[-1] & MASK32
    eq(st["bits32"], bits, f"{tag}: the low 32 bits")
    if (k - 1) & k == 0:
        eq(st["mapKind"], "mask", f"{tag}: map kind")
        eq(st["mapFormula"], f"bits32 & {k - 1} = {want.j}", f"{tag}: map formula")
        check(bits & (k - 1) == want.j, f"{tag}: the mask reproduces the index")
    else:
        eq(st["mapKind"], "multiply-shift", f"{tag}: map kind")
        eq(st["mapFormula"], f"floor({bits} * {k} / 2^32) = {want.j}",
           f"{tag}: map formula")
        eq(st["product"], str(bits * k), f"{tag}: product")
        eq(st["productLow32"], (bits * k) & MASK32, f"{tag}: product low half")
        eq(st["rejectThreshold"], (1 << 32) % k, f"{tag}: rejection threshold")
        check((bits * k) >> 32 == want.j, f"{tag}: multiply-shift reproduces the index")


def as_table(xs):
    return [None if x is None else x.encode() for x in xs]


def verify_cuckoo(trace: dict, sc: dict, seeds: list[bytes], tag: str) -> None:
    m, k = sc["m"], sc["k"]
    model = CuckooHashTable(seeds, m, sc["budget"], sc["stash"])
    full = trace["snapshots"] == "full"
    s_expect = 0
    op_index = 0

    for op in trace["ops"]:
        if op["op"] == "lookup":
            continue
        otag = f"{tag}/op{op_index}:{op['arg']}"
        before_table = [x for x in model.table]
        before_stash = list(model.stash)
        eq(as_table(op["tableBefore"]), before_table, f"{otag}: tableBefore")
        eq([x.encode() for x in op["stashBefore"]], before_stash, f"{otag}: stashBefore")

        res = model.insert(op["arg"].encode())
        eq(op["status"], res.status, f"{otag}: status")
        eq(op["statusCode"], res.status_code, f"{otag}: status code")
        if res.status != "ok":
            eq(op.get("message"), res.message, f"{otag}: message")
        eq(op["relocationsUsed"], res.relocations_used, f"{otag}: relocations used")
        eq(op["maxRelocations"], sc["budget"], f"{otag}: maxRelocations")

        # Replay the recorded steps against the model's own event list.
        rec = op["steps"]
        eq(len(rec), len(res.events), f"{otag}: micro-step count")
        # A separate copy of the state, advanced by the recorded steps alone, so
        # that the snapshots are checked rather than assumed.
        replay_table = list(before_table)
        replay_stash = list(before_stash)
        walker = op["arg"].encode()
        for st, want in zip(rec, res.events):
            stag = f"{otag}/s{st['s']}"
            eq(st["s"], s_expect, f"{stag}: step index is contiguous")
            s_expect += 1
            eq(st["kind"], want.kind, f"{stag}: kind")
            if want.kind == "draw":
                verify_draw_step(st, _draw_of(want), k, stag)
                eq(st["i"], want.data["i"], f"{stag}: iteration")
            elif want.kind == "hash":
                verify_hash_step(st, seeds, m, stag)
                eq(st["i"], want.data["i"], f"{stag}: iteration")
                eq(st["input"].encode(), walker, f"{stag}: the walker being hashed")
            elif want.kind == "evict":
                eq(st["bucket"], want.data["bucket"], f"{stag}: bucket")
                eq(st["incoming"].encode(), want.data["incoming"], f"{stag}: incoming")
                eq(st["outgoing"].encode(), want.data["outgoing"], f"{stag}: outgoing")
                b = st["bucket"]
                check(replay_table[b] == want.data["outgoing"],
                      f"{stag}: the slot held the outgoing element")
                walker, replay_table[b] = replay_table[b], walker
            elif want.kind == "place":
                eq(st["bucket"], want.data["bucket"], f"{stag}: bucket")
                eq(st["element"].encode(), want.data["element"], f"{stag}: element")
                b = st["bucket"]
                check(replay_table[b] is None, f"{stag}: the slot was free")
                replay_table[b] = walker
                walker = None
            elif want.kind == "stash_push":
                eq(st["element"].encode(), want.data["element"], f"{stag}: element")
                eq(st["stashIndexAfter"], len(replay_stash), f"{stag}: stash index")
                replay_stash.append(walker)
                walker = None
            elif want.kind == "stash_overflow_error":
                eq(st["element"].encode(), want.data["element"], f"{stag}: element")
                eq(st["statusCode"], "INTERNAL", f"{stag}: status code")
                eq(st["message"], "Cannot insert element: stash is full",
                   f"{stag}: the exact message")
            else:
                fails.append(f"{stag}: unexpected kind {st['kind']}")
            if full and "tableAfter" in st:
                eq(as_table(st["tableAfter"]), replay_table,
                   f"{stag}: the snapshot matches the replay")
                eq([x.encode() for x in st["stashAfter"]], replay_stash,
                   f"{stag}: the stash snapshot matches the replay")

        eq(as_table(op["tableAfter"]), model.table, f"{otag}: tableAfter")
        eq([x.encode() for x in op["stashAfter"]], model.stash, f"{otag}: stashAfter")
        eq(replay_table, model.table, f"{otag}: the step replay reaches the same table")
        eq(replay_stash, model.stash, f"{otag}: the step replay reaches the same stash")
        op_index += 1

    eq(as_table(trace["finalTable"]), model.table, f"{tag}: finalTable")
    eq([x.encode() for x in trace["finalStash"]], model.stash, f"{tag}: finalStash")

    # Lookups run against the finished table.
    for op in trace["ops"]:
        if op["op"] != "lookup":
            continue
        otag = f"{tag}/lookup:{op['arg']}"
        want = lookup(seeds, model.table, model.stash, op["arg"].encode(), m)
        eq(op["candidateBuckets"], want["buckets"], f"{otag}: candidate buckets")
        eq(op["foundInTable"], want["foundInTable"], f"{otag}: found in the table")
        eq(op["bucket"], want["bucket"], f"{otag}: the bucket that matched")
        eq(op["foundInStash"], want["foundInStash"], f"{otag}: found on the stash")
        probes = [st for st in op["steps"] if st["kind"] == "probe"]
        eq(len(probes), k, f"{otag}: one probe per hash function")
        for st in op["steps"]:
            eq(st["s"], s_expect, f"{otag}: step index is contiguous")
            s_expect += 1
            if st["kind"] == "hash":
                verify_hash_step(st, seeds, m, f"{otag}/s{st['s']}")
            elif st["kind"] == "probe":
                b = st["bucket"]
                occ = model.table[b]
                eq(st["occupant"], None if occ is None else occ.decode(),
                   f"{otag}/s{st['s']}: occupant")
                eq(st["match"], occ is not None and occ == op["arg"].encode(),
                   f"{otag}/s{st['s']}: match")

    eq(trace["microStepCount"], s_expect, f"{tag}: microStepCount")


def _draw_of(ev):
    class D:
        pass
    d = D()
    d.raws = ev.data["raws"]
    d.j = ev.data["j"]
    return d


def verify_buckets(trace: dict, sc: dict, seeds: list[bytes], tag: str) -> None:
    m = sc["m"]
    if sc["structure"] == "multiple_choice":
        model = MultipleChoiceHashTable(seeds, m, sc["cap"])
    else:
        model = SimpleHashTable(seeds, m, sc["cap"])
    full = trace["snapshots"] == "full"
    s_expect = 0
    for i, op in enumerate(trace["ops"]):
        otag = f"{tag}/op{i}:{op['arg']}"
        before = [list(b) for b in model.table]
        eq([[e for e in b] for b in op["bucketsBefore"]],
           [[e.decode() for e in b] for b in before], f"{otag}: bucketsBefore")
        res = model.insert(op["arg"].encode())
        eq(op["status"], res.status, f"{otag}: status")
        eq(op["statusCode"], res.status_code, f"{otag}: status code")
        if res.status != "ok":
            eq(op.get("message"), res.message, f"{otag}: message")
        eq(len(op["steps"]), len(res.events), f"{otag}: micro-step count")
        replay = [list(b) for b in before]
        for st, want in zip(op["steps"], res.events):
            stag = f"{otag}/s{st['s']}"
            eq(st["s"], s_expect, f"{stag}: step index is contiguous")
            s_expect += 1
            eq(st["kind"], want.kind, f"{stag}: kind")
            if want.kind == "hash":
                verify_hash_step(st, seeds, m, stag)
            elif want.kind == "capacity_check":
                eq(st["bucket"], want.data["bucket"], f"{stag}: bucket")
                eq(st["size"], want.data["size"], f"{stag}: bucket size")
                eq(st["full"], want.data["full"], f"{stag}: full")
                eq(st["size"], len(replay[st["bucket"]]),
                   f"{stag}: the size is the size before any append")
            elif want.kind == "choose":
                eq(st["bucket"], want.data["bucket"], f"{stag}: the chosen bucket")
                eq([c["bucket"] for c in st["candidates"]], want.data["candidates"],
                   f"{stag}: candidate buckets")
                sizes = [len(replay[c["bucket"]]) for c in st["candidates"]]
                eq([c["size"] for c in st["candidates"]], sizes, f"{stag}: candidate sizes")
                # Line 62 uses a strict <, so the first minimum keeps the choice.
                best, bi = sizes[0], st["candidates"][0]["bucket"]
                for c, s2 in list(zip(st["candidates"], sizes))[1:]:
                    if s2 < best:
                        best, bi = s2, c["bucket"]
                eq(st["bucket"], bi, f"{stag}: the first minimum wins")
            elif want.kind == "append":
                eq(st["bucket"], want.data["bucket"], f"{stag}: bucket")
                eq(st["element"], want.data["element"].decode(), f"{stag}: element")
                replay[st["bucket"]].append(want.data["element"])
            elif want.kind == "bucket_full_error":
                eq(st["bucket"], want.data["bucket"], f"{stag}: bucket")
                eq(st["statusCode"], "INTERNAL", f"{stag}: status code")
                eq(st["message"], "Cannot insert element: maximum bucket size reached",
                   f"{stag}: the exact message")
            else:
                fails.append(f"{stag}: unexpected kind {st['kind']}")
            if full and "bucketsAfter" in st:
                eq([[e for e in b] for b in st["bucketsAfter"]],
                   [[e.decode() for e in b] for b in replay],
                   f"{stag}: the snapshot matches the replay")
        eq([[e for e in b] for b in op["bucketsAfter"]],
           [[e.decode() for e in b] for b in model.table], f"{otag}: bucketsAfter")
        eq(replay, model.table, f"{otag}: the step replay reaches the same buckets")
    eq([[e for e in b] for b in trace["finalBuckets"]],
       [[e.decode() for e in b] for b in model.table], f"{tag}: finalBuckets")
    eq(trace["microStepCount"], s_expect, f"{tag}: microStepCount")


# ----------------------------------------------------------------------- main

def main() -> int:
    scenarios = read_scenarios()
    index = json.loads((DATA / "scenario-index.json").read_text())
    eq(sorted(e["id"] for e in index), sorted(scenarios),
       "scenario-index.json lists exactly the mined scenarios")

    verify_golden()

    for sid, sc in scenarios.items():
        path = TRACES / f"{sid}.json"
        if not path.is_file():
            fails.append(f"{sid}: {path} is missing")
            continue
        before = len(fails)
        trace = json.loads(path.read_text())
        tag = sid

        eq(trace["schemaVersion"], 1, f"{tag}: schemaVersion")
        eq(trace["id"], sid, f"{tag}: id")
        eq(trace["structure"], sc["structure"], f"{tag}: structure")
        eq(trace["title"], sc["title"], f"{tag}: title")
        p = trace["params"]
        eq(p["numBuckets"], sc["m"], f"{tag}: numBuckets")
        eq(p["numHashFunctions"], sc["k"], f"{tag}: k")
        eq(p["maxRelocations"], sc["budget"], f"{tag}: maxRelocations")
        eq(p["maxStashSize"], sc["stash"], f"{tag}: maxStashSize")
        eq(p["maxBucketSize"], sc["cap"], f"{tag}: maxBucketSize")
        eq(p["hashFamily"], "SHA256", f"{tag}: hash family")
        eq(p["familySeedHex"], sc["seedhex"], f"{tag}: family seed")
        eq(trace["snapshots"], "full" if sc["m"] <= 24 else "op", f"{tag}: snapshot mode")

        family_seed = bytes.fromhex(sc["seedhex"]) if sc["seedhex"] else b""
        seeds = per_function_seeds(sc["k"], family_seed)
        eq(p["perFunctionSeedsHex"], [s.hex() for s in seeds], f"{tag}: per-function seeds")
        eq(trace["elements"], sc["elements"], f"{tag}: elements")

        want_c = {}
        for e in sorted(set(sc["elements"]) | set(sc["lookups"])):
            want_c[e] = [sha256_ladder(s, e.encode(), sc["m"]).bucket for s in seeds]
        eq(trace["candidates"], want_c, f"{tag}: the candidate table")

        if sc["structure"] == "cuckoo":
            verify_cuckoo(trace, sc, seeds, tag)
        else:
            verify_buckets(trace, sc, seeds, tag)

        counts: dict[str, int] = {}
        for op in trace["ops"]:
            for st in op["steps"]:
                counts[st["kind"]] = counts.get(st["kind"], 0) + 1
        eq(trace["eventCounts"], counts, f"{tag}: eventCounts")
        eq(trace["opCount"], len(trace["ops"]), f"{tag}: opCount")

        status = "pass" if len(fails) == before else "FAIL"
        print(f"[04] {sid:18s} {trace['microStepCount']:6d} micro-steps  {status}")

    print(f"\n[04] {checks} checks, {len(fails)} failure(s)")
    for f in fails[:40]:
        print(f"[04]   {f}")
    return 0 if not fails else 1


if __name__ == "__main__":
    sys.exit(main())
