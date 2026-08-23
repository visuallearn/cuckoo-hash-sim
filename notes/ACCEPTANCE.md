# Acceptance audit

The counters this project reports were self-reported, and a self-reported number
is a claim. This is the audit that turns them into evidence, run against the
tree as it stands. Every step here is a command anyone can repeat.

---

## 1. Two clean checkouts produce the same bytes

Two copies of the repository, both with `docs/data/` and every generated note
deleted, each running `./tools/06_all.sh` from nothing, independently and
concurrently.

```sh
rsync -a --exclude .work --exclude node_modules --exclude .git repo/ /tmp/repro/a/
rsync -a --exclude .work --exclude node_modules --exclude .git repo/ /tmp/repro/b/
rm -rf /tmp/repro/{a,b}/docs/data /tmp/repro/{a,b}/notes/{pins.json,rng-golden.txt,test-mapping.md,reference-sources.*,reference-test-run}
(cd /tmp/repro/a && ./tools/06_all.sh) & (cd /tmp/repro/b && ./tools/06_all.sh) & wait
diff -r /tmp/repro/a/docs/data /tmp/repro/b/docs/data
```

**Result: identical.** Both runs exit 0 and `diff -r` reports nothing.

```
BOTH DONE: A exit=0  B exit=0
docs/data                       IDENTICAL   (25 files, 1.4 MB)
notes/pins.json                 identical
notes/rng-golden.txt            identical
notes/test-mapping.md           identical
notes/reference-sources.tar.gz  identical
```

`tools/scenarios.txt`, `tools/scenario-predicates.json` and `content/tour.json`
are committed inputs, not outputs. `06_all.sh` checks them rather than
regenerating them, and its header says which files are which.

### One defect this found

The first run of this audit failed on a single field. `manifest.json` carried a
`generatedAtUtc` wall clock, so two clean builds differed by the second they
happened to start in. The continuous-integration diff gate still passed, because
it checks out the committed manifest first and the finalizer preserved an
unchanged timestamp — which meant the gate was weaker than it looked.

Fixed by removing the wall clock. The manifest now carries `derivedFrom`, with
the reference commit and that commit's own date. Everything under `docs/data/`
is a function of the pinned inputs and of nothing else.

### A second defect this found

`docs/data/tour.json` is hand-written prose, but it sat in the generated
directory, so a truly clean checkout cannot rebuild `docs/data/` at all. The
authored copy now lives in `content/tour.json` and `tools/03_finalize.py`
copies it in.

---

## 2. The browser agrees, on the files the browser downloads

`docs/selftest.html`, opened over HTTP. It re-checks the structure of every
shipped trace and then replays all nineteen through the browser port of the
reference, comparing field by field.

**Result: `data-selftest="pass"`. All 13541 checks passed across 19 scenarios and 512 golden draws. The browser engine reproduced every recorded trace exactly.**

The same page is driven headlessly by `tools/08_browser_check.py`, which is
what continuous integration runs.

---

## 3. The golden vectors, against an independent derivation

The decisive one. The index mapping is the single place where a wrong reading
produces a plausible, wrong table for every scenario on the site. The vectors
below were derived independently, from abseil 20240722.0 compiled directly, and
compared byte for byte against `notes/rng-golden.txt`, which
`tools/cxx/rng_vectors.cc` captured from the real library on this machine.

k = 3, `absl::uniform_int_distribution<int>(0, 2)`:

| draw | raw word | j |
|---|---|---|
| 0 | `c96d191cf6f6aea6` | 2 |
| 1 | `401f7ac78bc80f1c` | 1 |
| 2 | `b5ee8cb6abe457f8` | 2 |
| 3 | `f258d22d4db91392` | 0 |
| 4 | `04eef2b4b5d860cc` | 2 |
| 5 | `67a7aabe10d172d6` | 0 |
| 6 | `40565d50e72b4021` | 2 |
| 7 | `05d07b7d1e8de386` | 0 |
| 8 | `8548dea130821acc` | 0 |
| 9 | `583c502c832e0a3a` | 1 |

k = 2, the same raw stream, power-of-two mask path: j = 0 0 0 0 0 0 1 0 0 0.

**Result: every raw word and every index matched, both k, one word consumed per
draw with no rejection.** The site's stored draws are the library's draws.

Two spot-checks of the hash, from the same independent derivation, also match:
`h_0("ant") mod 6 = 5` with the full ladder in `notes/FIDELITY.md` section 2,
and `h_0("bee") = h_1("bee") = 1 mod 2`, which is the premise the `SH-overflow`
scenario depends on.

This closes the question the plan raised about the RNG law.

---

## 4. Every counter prints itself

No number in the README or in `notes/FIDELITY.md` is typed by hand.
`tools/16_counters.py` runs each layer, reads the count that layer prints about
itself, and writes [`notes/verification-counts.md`](verification-counts.md)
with the exact line it read. With `--check` it fails if a document quotes a
figure that nothing prints.

See that file for the current table.

---

## Scope

This audit covers the four checks the closeout plan lists under F2. It does not
re-derive the reference's semantics: that is what `notes/FIDELITY.md`,
`notes/test-mapping.md` and the archived run in `notes/reference-test-run/`
are for.
