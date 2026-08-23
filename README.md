# Cuckoo Hashing Explorer

A step-by-step visual simulation of cuckoo hashing, exactly as Google's
reference implementation computes it. Every value the site shows was recorded
from a program that links the real C++ sources without changing them, at small
sizes a person can follow by hand.

**The site:** `docs/` — a static site, no build step, ready for GitHub Pages.
**The proof:** `docs/selftest.html` — 13541 checks in the browser, on the files
the browser actually downloads.

---

## Where Google's cuckoo hashing actually lives

Not in `google/private-join-and-compute`. A clone of that repository at
`950c5e4` contains no file and no line that mentions cuckoo hashing.

It is in the sibling repository for private information retrieval:

```
github.com/google/distributed_point_functions   @ 859cafa71fc1e139c7b76d4d4c0f23438688a8ad
└── pir/hashing/
    ├── cuckoo_hash_table.{h,cc}            the algorithm, in a 92-line .cc
    ├── hash_family.{h,cc}                  the HashFunction and HashFamily types
    ├── sha256_hash_family.{h,cc}           the exact hash math
    ├── multiple_choice_hash_table.{h,cc}   the bucketed variant
    ├── simple_hash_table.{h,cc}            the server-side companion
    └── farm_hash_family.{h,cc}             used by the tests only
```

Full reasoning and evidence: [`notes/FIDELITY.md`](notes/FIDELITY.md), section 0.

---

## What the site shows

| Route | What it is |
|---|---|
| `#/tour` | Fourteen steps, from "what is a collision" to hand-executing an insert |
| `#/table` | The explorer: the table, the arithmetic, the draw, the source, one recorded event at a time |
| `#/hash` | One element, one hash function, every byte and every division |
| `#/lookup` | The client's probe: all k buckets, then the stash |
| `#/variants` | `MultipleChoiceHashTable`, `SimpleHashTable`, and a textbook comparison |
| `#/lab` | Load-factor curves |
| `#/sandbox` | Your own words, run in the browser |
| `#/about` | Provenance, and how to make every byte again |

Deep links carry the whole state, so
`#/table?s=CK-chain&step=17` opens exactly that step of exactly that run.

---

## How fidelity is established

The browser recomputes nothing on the recorded path. It reads values out of
JSON and puts them on the screen. Three separate implementations agree on every
one of those values.

1. **The recorder checks itself.** `tools/cxx/trace_gen.cc` links the unmodified
   reference. It recomputes each digest and each division and asserts the result
   equals what the reference returned. A shadow `std::mt19937_64` plus
   `absl::uniform_int_distribution` predicts which hash function the table will
   use, and asserts it matches. A shadow table is compared against `GetTable()`
   and `GetStash()` after every insert. Any disagreement aborts, so the failure
   mode is no data rather than wrong data.
2. **A second implementation, in Python.** `tools/04_verify.py` re-derives every
   field of every trace with `hashlib`, a Mersenne Twister written from the
   standard, and a transcription of the abseil index mapping.
   → **47369 checks, 0 failures.**
3. **A third implementation, in the browser.** `docs/js/engine/` reproduces all
   19 traces field for field, and `docs/selftest.html` reports it.
   → **13541 checks, 0 failures.** The sandbox and the lab turn themselves off
   if that ever stops holding.

And the reference's own tests, run with its own build system at the pin:

4. **The upstream suite.** `./tools/07_run_reference_tests.sh` runs
   `bazel test //pir/hashing/...` under Bazel 7.4.1.
   → **7 targets, 29 cases, all green.** Console log and per-test XML archived
   in [`notes/reference-test-run/`](notes/reference-test-run/).
5. **The same behavior without Bazel.** `tools/cxx/conformance_test.cc`
   re-expresses 25 of those 29 cases plus 8 checks of its own, including the
   NIST CAVP hash vector. → **58 checks, 0 failures.**
   `tools/12_check_mapping.py` reads the `TEST()` names out of the pinned
   sources and fails on any unmapped assertion, so the coverage claim is
   checked rather than asserted:
   [`notes/test-mapping.md`](notes/test-mapping.md).
6. **Byte reproducibility.** Two clean checkouts run `./tools/06_all.sh`
   independently and produce identical trees, so the continuous-integration
   diff gate means something.

Quality gates are measured, not asserted: Lighthouse accessibility **100** on
both the explorer and the tour, 200 color pairs at or above 4.5:1 in both
themes, a keyboard-only walkthrough, 52 KB gzipped for a route, and 845 ms from
a cold load to the first interaction. Numbers and commands in
[`notes/QA.md`](notes/QA.md).

The reference needs **no patching at all**. `CuckooHashTable::Create` takes an
injected `std::vector<HashFunction>` and `GetTable()`/`GetStash()` are public,
so the instrumentation is decoration from the outside.

---

## The one part that needed care

`cuckoo_hash_table.cc:71` draws a hash-function index with
`absl::uniform_int_distribution<int>(0, k-1)` over a default-constructed
`std::mt19937_64`. That mapping is an implementation detail of abseil, and the
obvious guess is wrong.

The distribution's unsigned type comes from the width of an `int`, so the
arithmetic is **32-bit**: it uses the low half of each 64-bit generator word.

```
bits = low 32 bits of one mt19937_64 word
if k is a power of two:  j = bits & (k - 1)                     -- never redraws
else:                    j = floor(bits * k / 2^32),
                         redrawing while (bits * k) mod 2^32 < 2^32 mod k
```

Reading it as 64-bit gives a different index for nearly every draw, and a
plausible, wrong table. So it is never trusted: `tools/cxx/rng_vectors.cc`
captures golden draws from the real library into `notes/rng-golden.txt`, and the
Python and browser implementations are both replayed against them.

---

## Make every byte again

You need git, cmake, a C++17 compiler, OpenSSL headers, python3, and about ten
minutes. Nothing is downloaded that is not pinned by a hash or a commit.

```sh
./tools/06_all.sh          # everything below, in order, failing loudly
```

A cold run takes about ten minutes, most of it building abseil once and the
reference's Bazel dependencies once. Both are cached afterwards. While
iterating on something else, `SKIP_REFERENCE_TESTS=1 ./tools/06_all.sh` leaves
out the upstream suite, which is the slow part.

| Script | What it does |
|---|---|
| `00_fetch_reference.sh` | Clone and pin the reference, check the versions it pins, hash every file into `notes/pins.json` |
| `01_build.sh` | Build abseil at the pinned version, then the reference's hashing module and the harnesses |
| `02_extract_source.py` | Slice the pristine source for the code panel, asserting every line number a trace points at |
| `mine.py` | Search for scenarios in which specific teaching events provably occur |
| `03_generate.sh` | Record every trace from the reference, capture the golden draws, assemble the manifest |
| `04_verify.py` | Re-derive every field of every trace, in Python |
| `05_conformance.sh` | 58 behavior tests against the pinned reference |
| `07_run_reference_tests.sh` | The reference's own tests, under Bazel 7 through bazelisk |
| `10_ste_check.py` | Simplified Technical English structural check on the site's prose |
| `11_stamp_assets.py` | Content-hash the CSS links and the module import map |
| `12_check_mapping.py` | Every upstream `TEST()` mapped onto the conformance check for it, with no gaps |
| `14_contrast.py` | Every color pair the site shows, both themes, against WCAG |
| `15_archive_pins.py` | Archive the reference sources so the pins survive their upstreams |
| `16_counters.py` | Run each verification layer and collect the count it prints about itself |

Then the browser checks, which need a server and chromium:

```sh
python3 tools/serve.py 8791 &
python3 tools/08_browser_check.py 8791     # self-test, layout, keyboard, races
python3 tools/13_qa.py 8791                # Lighthouse, motion, size, timing
python3 tools/16_counters.py               # every layer's own count, collected
```

`13_qa.py` needs the pinned tools in `tools/qa/`:

```sh
cd tools/qa && npm ci && npx playwright install chromium
```

`09_explore.sh` runs the Phase 0 exploration program, whose output is archived
in `notes/explore-output.txt`.

---

## Repository layout

```
docs/            the site, served as-is
  css/           three stylesheets, design tokens in base.css
  js/            ES modules, no framework and no build step
    engine/      the browser port: SHA-256, mt19937_64, the three structures
    views/       the table, the arithmetic, the draw, the source, the timeline
    routes/      one module per route
  data/          generated: traces, the manifest, the source slices
content/         the one hand-written data file, copied into docs/data/ by the
                 pipeline, so a clean checkout can rebuild docs/data/ from nothing
notes/           the fidelity worksheet, the quality numbers, the pins, the
                 archived source tarball and the archived test runs
tools/           the pipeline, numbered in the order it runs
  cxx/           the harnesses that link the reference
  qa/            Lighthouse and Playwright, pinned; not part of the site
  browser-checks/  probe pages, copied into docs/ only while they run
```

`.work/` holds the fetched reference, abseil, and the build. It is not
committed.

---

## License

The site code is under the MIT license. The excerpts from the reference are
Copyright 2023 Google LLC under the Apache License 2.0, redistributed with the
full license text at `docs/data/source/LICENSE-dpf.txt`.

The algorithm is Rasmus Pagh and Flemming Friche Rodler, *Cuckoo Hashing*,
Journal of Algorithms 51(2), 2004. The stash follows Adam Kirsch, Michael
Mitzenmacher and Udi Wieder, *More Robust Hashing: Cuckoo Hashing with a Stash*,
SIAM Journal on Computing 39(4), 2009.
