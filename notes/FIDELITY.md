# Fidelity worksheet

Every claim the site makes about the reference, with the file and line it comes
from and the program that checks it. Nothing here is from memory: each row was
either read in the pinned source or produced by running it.

| | |
|---|---|
| Reference | `google/distributed_point_functions`, `pir/hashing/` |
| Commit | `859cafa71fc1e139c7b76d4d4c0f23438688a8ad` |
| License | Apache-2.0 |
| Per-file hashes | [`notes/pins.json`](pins.json) |
| Run output | [`notes/explore-output.txt`](explore-output.txt) |
| Conformance output | [`notes/conformance-output.txt`](conformance-output.txt) |
| Golden index draws | [`notes/rng-golden.txt`](rng-golden.txt) |

---

## 0. Where the code is, and where it is not

The brief said the reference lives in `google/private-join-and-compute`, "hidden
inside `/private_join_and_compute/crypto/`". That was checked and it is not the
case.

- A clone of `private-join-and-compute` at `950c5e4c88d7effe85147beb7856152f7c53394b`
  was searched with `grep -ril cuckoo` and `find -iname '*cuckoo*'`. **Zero
  matches** anywhere, including `private_join_and_compute/crypto/`, which holds
  BigNum, Paillier, the elliptic-curve commutative cipher, ElGamal,
  Camenisch-Shoup, Pedersen over Z_n and the Dodis-Yampolskiy PRF. None of that
  uses a cuckoo table.
- Google's open-source cuckoo hashing is in the sibling PIR repository,
  `google/distributed_point_functions`, under `pir/hashing/`. The header guards
  there still read `PRIVACY_PRIVATE_MEMBERSHIP_INTERNAL_HASHING_...`, so the code
  came out of Google's private-membership stack.

Everything below is grounded in that module at the pinned commit.

---

## 1. `CuckooHashTable`

| Aspect | What it does | Anchor | Checked by |
|---|---|---|---|
| Table | one flat `vector<optional<string>>`, one element per bucket | `.h:103` | shadow table in `trace_gen.cc` |
| k | `hash_functions_.size()`, at least 2 | `.cc:53-56` | `conformance_test.cc` |
| Validation | `num_buckets > 0`, `max_relocations >= 0`, `max_stash_size >= 0` if set | `.cc:50-62` | `conformance_test.cc`, exact strings |
| Generator | `std::mt19937_64 rng_` default-constructed, so seed 5489 | `.h:107` | golden draws |
| Index | `absl::uniform_int_distribution<int>(0, k-1)` | `.h:108`, `.cc:41` | golden draws, §5 |
| Loop | `for (int i = 0; i < max_relocations_; i++)`: draw one index, hash once, place or swap | `.cc:69-81` | shadow table, `04_verify.py` |
| Overflow | bounded stash full gives `INTERNAL "Cannot insert element: stash is full"`, otherwise `push_back` | `.cc:83-89` | `conformance_test.cc` |
| Stash | built in, unlimited unless `max_stash_size` is set | `.h:44-51` | `CK-stash`, `CK-stash-full` |
| Absent | no lookup, no delete, no rehash, no membership test, no cycle detection beyond the counter | whole file | read |

### The insertion loop, statement for statement

```
Insert(x):
  current <- copy(x)
  for i in 0 .. max_relocations - 1:            # i counts every attempt,
      j <- UniformInt[0, k-1](mt19937_64)       #   including the first
      b <- h_j(current, m)                      # one bucket per iteration; the
      if table[b] is occupied:                  #   code never scans all k
          swap(current, table[b])
      else:
          table[b] <- current
          return OK
  if max_stash_size is set and |stash| >= max_stash_size:
      return INTERNAL "Cannot insert element: stash is full"
  stash.append(current)
  return OK
```

### The quirks, and where each one is shown

| # | Quirk | Anchor | Scenario | Test |
|---|---|---|---|---|
| Q1 | The hash function is drawn at random on every attempt, the first included. There is no scan for an empty candidate. | `.cc:70-72` | `CK-classroom`, tour step 6 | `conformance_test.cc` "Q1/Q2" |
| Q2 | Consecutive draws can repeat, so a walk can return to a bucket and swap the same pair again. | consequence of Q1 | `CK-pingpong` | mined predicate |
| Q3 | When `h_i(x) = h_j(x)` an element has fewer than k homes. Real case: `h_1("ant") = h_2("ant") = 0` at m=6. | hash math | `CK-classroom` | `explore-output.txt` §1 |
| Q4 | Duplicates are allowed. The same key can occupy two buckets, or a bucket and the stash. | `.cc:73-79` | `CK-duplicate` | `conformance_test.cc` "Q4" |
| Q5 | `max_relocations = 0` sends every element straight to the stash. It is legal. | `.cc:69` | `CK-budget-zero` | `conformance_test.cc` "Q5" |
| Q6 | The budget is one counter for the whole displacement chain. A successful landing after four evictions used five attempts. | `.cc:69` | `CK-chain` | `04_verify.py` relocation count |
| Q7 | The generator is never re-seeded, so a fixed insertion order gives a fixed table on every machine. The order changes everything. | `.h:107` | `CK-order-a`, `CK-order-b` | `explore-output.txt` §4 |
| Q8 | The reference never rehashes. Its answer to a failed walk is the stash, and a bounded stash turns overflow into an error. | `.cc:83-89` | `CK-stash`, `CK-stash-full` | `conformance_test.cc` "Q8" |

---

## 2. `SHA256HashFunction`

`pir/hashing/sha256_hash_family.cc:59-87`.

1. `digest[0..31] <- SHA-256(seed || input)`. The seed is absorbed once into a
   saved `SHA256_CTX` in the constructor, so it is a prefix of the message.
   Inputs above 2^30 bytes are chunked (`.cc:32-43`), which never happens at
   these sizes.
2. The 32 bytes are copied raw into two `absl::uint128`:
   `lo <- digest[0..15]`, `hi <- digest[16..31]` (`.cc:69-77`). On a
   little-endian host that reads the digest as one 256-bit little-endian
   integer `N = hi * 2^128 + lo`.
3. Reduction by long division in base 2^64 (`.cc:78-87`):
   `r1 = hi mod m`. Then `d2 = r1 * 2^64 + Uint128High64(lo)` and `r2 = d2 mod m`.
   Then `d3 = r2 * 2^64 + Uint128Low64(lo)` and the result is `d3 mod m`.
   The result equals `N mod m`. The three steps exist because hardware division
   is at most 128 bits wide.

**Endianness.** The copy is `std::copy` over raw bytes, so the result depends on
the byte order of the host. `reference_wrap.h` performs the same copy and then
rebuilds both halves arithmetically, and aborts if they differ. Every trace was
therefore produced on a host where the assert held. The manifest records
`toolchain.endianness`.

**A worked example, from `explore-output.txt` §2.** `h_0("ant") mod 6`:

```
SHA-256 input   "0" || "ant"  = 30616e74
digest          d3d063292b9f2163c3cb847a8601a69f359e88fbd6345229be5f1c28ee7f7233
lo              0x9fa601867a84cbc363219f2b2963d0d3
hi              0x33727fee281c5fbe295234d6fb889e35
N               23270258785608834855485564551447774929263175659695773196027245351691792666835
r1 = hi mod 6   1
d2              29950628048966831043
r2 = d2 mod 6   3
d3              62483397712841789651
r3 = d3 mod 6   5     <- the bucket
```

`conformance_test.cc` also checks the reference against the NIST CAVP vector
that the reference's own test uses, for every upper bound from 1 to 999.

**Seeds.** `CreateHashFunctions` uses `absl::StrCat(i)`, so the per-function
seeds are the ASCII strings `"0"`, `"1"`, `"2"` (`hash_family.cc:36`). In
production `WrapWithSeed` prepends a 16-byte session seed, giving
`session_seed || ASCII(i)` (`hash_family.h:48`,
`cuckoo_hashing_sparse_dpf_pir_server.h:111`). The `CK-seeded` scenario shows
that form.

**FarmHash.** `farm_hash_family.cc` exists and the reference's own unit tests
use it, but `hash_family_config.proto` exposes `HASH_FAMILY_SHA256` as the only
production family and `CreateHashFamilyFromConfig` rejects anything else and an
empty seed (`hash_family_config.cc:31-43`). This project therefore records
SHA-256 only, and uses FarmHash only where the upstream tests do.

---

## 3. Production parameters

From `cuckoo_hashing_sparse_dpf_pir_server.cc` and
`cuckoo_hashed_dpf_pir_database.cc`.

| Parameter | Value | Anchor |
|---|---|---|
| k | 3 (`kNumHashFunctions`) | server `.cc:38` |
| Buckets | `int64(1.5 * num_elements)`, which truncates. Five records give seven buckets. | server `.cc:39,71-73` |
| `max_relocations` | the number of records | database `.cc:141-144` |
| `max_stash_size` | not set, so unlimited | database `.cc:141-144` |
| Session seed | 16 bytes from `RAND_bytes` | server `.cc:65-66` |
| Seed fingerprint | `SHA256HashFunction("")(seed, INT_MAX)`. The comment says "the first 31 bits". The code says `mod INT_MAX`, which is not the same thing. | server `.cc:127-130` |
| Lookup | all k indices, duplicates not removed | client `.cc:138-141` |
| The stash in production | **never read.** The builder copies only `GetTable()` into the served database (`database .cc:154-166`), so a key on the stash is not in the database at all. The parameters are chosen to make that outcome negligible, and nothing checks for it. | database `.cc:154-166` |

Unit-test constants, used as the "reference test preset":
`kNumBuckets=100, kNumHashFunctions=3, kMaxRelocations=50, kMaxStashSize=3`
(`cuckoo_hash_table_test.cc:42-45`).

---

## 4. The two other structures

**`MultipleChoiceHashTable`** (`multiple_choice_hash_table.cc:57-72`)

- `vector<vector<string>>`, with the insertion order kept.
- All k hashes are computed up front, in the fixed order `i = 0 .. k-1`. The
  least loaded candidate wins. The test on line 62 is a strict `<`, so **the
  first minimum keeps the choice**. Checked in `conformance_test.cc`, with a
  concrete tie: `"ant"` at m=6, k=2 has `h_0 = 5` and `h_1 = 0`, both empty, and
  the element goes to bucket 5.
- Optional `max_bucket_size`, which must be positive. A full least-loaded
  candidate gives `INTERNAL "Cannot insert element: maximum bucket size
  reached"`, checked **before** any mutation (`.cc:66-70`).
- No eviction, no stash, no random numbers. The convenience overload defaults to
  `num_hash_functions = 2` (`.h:51`).

**`SimpleHashTable`** (`simple_hash_table.cc:55-70`)

- One copy per hash function, in every candidate bucket. Default k = 1 (`.h:53`).
- Two loops: the first measures every candidate, the second appends to all of
  them, so an error leaves the table untouched.
- **Confirmed quirk.** The first loop reads each bucket's size before anything is
  appended. When two hash functions name the same bucket, that bucket is
  measured twice at its old size, so a bucket one below the limit accepts two
  more elements and ends above it. Concrete case from `explore-output.txt` §12
  and `conformance_test.cc`: at m=2, `"bee"` has `h_0 = h_1 = 1`. With
  `max_bucket_size = 2` and one element already in bucket 1, inserting `"bee"`
  returns OK and leaves bucket 1 holding three. The same happens at m=3, 4, 5,
  6, 8, 9 and beyond with other words. Recorded as `SH-overflow`, at m=6 with
  `"dog"` (`h_0 = h_1 = 0`).

---

## 5. The index mapping: the one part that needed care

`cuckoo_hash_table.cc:71` writes

```cpp
int hash = hash_functions_[random_hash_function_(rng_)](current_element, num_buckets_);
```

`random_hash_function_` is `absl::uniform_int_distribution<int>(0, k-1)` and
`rng_` is a default-constructed `std::mt19937_64`. The Mersenne Twister is fully
specified by the C++ standard. The mapping from a raw word to an index is an
implementation detail of abseil, and the reference pins abseil **20240722.0**
in `MODULE.bazel`.

The plan for this project guessed `j = floor(raw * k / 2^64)`. **That is wrong.**
Reading the pinned abseil source:

- `uniform_int_distribution<int>` derives its unsigned type from the digits of
  `unsigned int` (`absl/random/internal/traits.h`, `make_unsigned_bits`), so the
  arithmetic is **32-bit**, not 64-bit.
- `FastUniformBits<uint32_t>` over a generator whose range is the whole of
  `uint64_t` takes the simplified loop with one iteration and no shift
  (`absl/random/internal/fast_uniform_bits.h`). That is a plain narrowing cast:
  **the low 32 bits of one word**.
- `Generate` masks when the range is a power of two, and otherwise multiplies by
  `k`, keeps the high 32 bits, and redraws while the low 32 bits of the product
  are below `2^32 mod k` (`absl/random/uniform_int_distribution.h`).

So, for `k` hash functions:

```
bits = low 32 bits of one mt19937_64 word
if k is a power of two:  j = bits & (k - 1)                     -- never redraws
else:                    j = floor(bits * k / 2^32),
                         redrawing while (bits * k) mod 2^32 < 2^32 mod k
```

For k = 2 the mask path applies and `j` is the lowest bit. For k = 3 the
threshold is `2^32 mod 3 = 1`, so a redraw happens only when the low 32 bits are
exactly zero, once in about four billion draws.

Reading this as 64-bit arithmetic gives a different index for almost every draw
and therefore a different table, so the derivation is not trusted anywhere:

- `tools/cxx/rng_vectors.cc` asserts the closed form against the real abseil for
  k = 2 to 8, and writes the draws to `notes/rng-golden.txt`.
- `tools/cxx/conformance_test.cc` repeats that assertion over 20000 draws per k.
- `tools/04_verify.py` replays the golden file through the Python implementation.
- `docs/selftest.html` replays a subset through the browser implementation.
- Every trace records the raw word or words and the resulting index, so the site
  never recomputes either.

`std::mt19937_64` at the default seed produces `14514284786278117030` as its
first word. Both the C++ harness and the Python model assert that.

---

## 6. The reference's own tests

**They run, and they pass at the pin.** Console log and per-test XML are in
[`notes/reference-test-run/`](reference-test-run/).

```
$ ./tools/07_run_reference_tests.sh
//pir/hashing:cuckoo_hash_table_test              PASSED in 0.7s
//pir/hashing:farm_hash_family_test               PASSED in 0.2s
//pir/hashing:hash_family_config_test             PASSED in 0.2s
//pir/hashing:hash_family_test                    PASSED in 0.4s
//pir/hashing:multiple_choice_hash_table_test     PASSED in 0.2s
//pir/hashing:sha256_hash_family_test             PASSED in 0.2s
//pir/hashing:simple_hash_table_test              PASSED in 0.1s

Executed 7 out of 7 tests: 7 tests pass.
```

Bazel 7.4.1 through bazelisk, pinned by `BAZEL_VERSION` in `tools/env.sh`
because the reference carries no `.bazelversion` of its own. The output base and
the convenience symlinks go outside the checkout, so the pinned tree stays
clean. `.github/workflows/reference-tests.yml` runs the same command on demand.

### Every upstream test, mapped

The 7 targets hold **29** `TEST()` cases. `tools/cxx/conformance_test.cc`
re-expresses **25** of them against the same unmodified sources, so the
behavior is still checked on a machine with no Bazel.
`tools/12_check_mapping.py` reads the `TEST()` names straight out of the pinned
sources, runs the conformance suite for the ids it actually executed, and fails
on any gap. The table it writes is
[`notes/test-mapping.md`](test-mapping.md); it is generated, not maintained by
hand, so it cannot drift.

```
$ python3 tools/12_check_mapping.py
[12] 29 upstream tests, 25 re-expressed, 4 waived with a reason,
     8 extra checks. No gaps.
```

The four waived cases are `hash_family_config_test.cc`. That file drives a
factory that reads a `HashFamilyConfig` protobuf. Building it pulls protobuf
and its code generator into the CMake shim. No shipped byte goes
through that code path: every trace names its hash family directly. They are
covered by the archived Bazel run above.

The 8 extra checks have no upstream counterpart. They lock the behavior this
site teaches, so that a re-pin of the reference is a reviewed act: the index
mapping against golden draws, quirks Q1, Q2, Q4, Q5 and Q8, the
`MultipleChoiceHashTable` tie-break, the `SimpleHashTable` capacity breach, and
the production constants.

---

## 6a. What this build replaced, exactly

The reference builds with Bazel against the versions its `MODULE.bazel` pins.
The trace generator is built by a CMake shim instead, so the substitutions have
to be on the record. Every value below is read out of the real
`CMakeCache.txt` by `tools/03_finalize.py` and lands in
`docs/data/manifest.json` under `toolchain`.

| | the reference | this build | does it change a byte |
|---|---|---|---|
| abseil | 20240722.0, fetched by bzlmod | 20240722.0, the release archive, sha256 `f50e5ac3…`, built by `tools/01_build.sh` into `.work/absl-install` | no: same version, and the index mapping is checked against golden draws |
| SHA-256 | BoringSSL 0.20240930.0 | OpenSSL 3.0.17, `/usr/lib/x86_64-linux-gnu/libcrypto.so` | no: same `SHA256_Init`/`Update`/`Final` API and the same digest, checked against the NIST CAVP vector for every bound from 1 to 999 |
| FarmHash | `0d859a81…` via bzlmod | the same commit, sha256 `470e8774…`, compiled into the shim | no: used only where the upstream tests use it |
| protobuf | 29.1 | not built | no: `hash_family_config.cc` is the only consumer and no trace uses it |
| compiler | whatever the runner has | `/usr/bin/c++`, g++ 13.3.0 | no |
| flags | `--cxxopt=-std=c++17` | `-O3 -DNDEBUG -std=c++17 -Wno-deprecated-declarations` | no |

**Which abseil was compiled against.** This is the load-bearing one: the golden
draws prove the mapping, but only if the mapping came from the pinned tree.
`tools/cxx/CMakeLists.txt` takes `absl` through `find_package` with
`CMAKE_PREFIX_PATH` set to `.work/absl-install`, and the resolved path is
recorded in the manifest as `toolchain.abseilCmakeDir`:

```
<repo>/.work/absl-install/lib/cmake/absl
```

There is no system abseil on the build host, and `find_package(absl REQUIRED)`
fails rather than falling back. `tools/00_fetch_reference.sh` checks the release
archive's sha256 before unpacking it, and reads `MODULE.bazel` back to make
sure the reference still pins that same version.

**Pin survival.** Both upstreams live on servers this project does not control.
[`notes/reference-sources.tar.gz`](reference-sources.tar.gz) holds the 29 files
of `pir/hashing/`, the 4 production files the site quotes, `MODULE.bazel`, and
the four abseil headers that define the index mapping, with both Apache-2.0
licenses and a NOTICE. It is 31 KB, byte-reproducible, and
`tools/15_archive_pins.py --check` rebuilds and compares it. Details in
[`notes/reference-sources.md`](reference-sources.md).

---

## 7. Answers to the remaining worksheet questions

**Does `absl::uint128` have the little-endian layout the code assumes?**
Yes on this host, and it is asserted rather than assumed:
`reference_wrap.h::ComputeLadder` performs the reference's `std::copy` and then
builds the same two values arithmetically, and aborts if they differ. Every
recorded byte was produced with that assert passing.

**What does `int64(1.5 * n)` give at small n?** From `explore-output.txt` §13:
n = 1 gives 1, n = 2 gives 3, n = 3 gives 4, n = 4 gives 6, n = 5 gives 7,
n = 7 gives 10, n = 10 gives 15, n = 100 gives 150. The product truncates, so
n = 5 gives seven buckets, not eight.

**Is m = 1 with k >= 2 legal, and what happens?** Legal: validation only rejects
`num_buckets <= 0`. From `explore-output.txt` §8, at m = 1, k = 2 and a budget of
4, the first element lands in bucket 0 and every later element walks its whole
budget against the same occupied bucket and then goes on the stash. Recorded as
`CK-degenerate`.

**Is `max_stash_size = 0` legal?** Yes. Validation rejects a negative value only.
With a limit of zero, the first element that runs out of budget fails
immediately.

**What surprised the implementer?** Four things, and each one became a tour step
or a callout.

1. The hash function is drawn again on every attempt, including the first, so
   the code never looks for an empty candidate. Nearly every description of
   cuckoo hashing says the opposite. Tour step 6.
2. The unsigned type of the index distribution is 32-bit, so it uses half of
   each generator word. Reading it as 64-bit produces a plausible, wrong table.
   Tour step 6, and §5 above.
3. The production layer never reads the stash, so an element the walk pushed
   there is silently missing from the served database. Nothing checks for it.
   Callouts on the lookup page and the variants page.
4. `SimpleHashTable` can exceed its own `max_bucket_size` when one element names
   the same bucket twice. Recorded as `SH-overflow`.

---

## 8. The chain of evidence

1. **The recorder checks itself.** `trace_gen.cc` recomputes each digest and each
   division and asserts the result equals the reference's return value. A shadow
   `mt19937_64` plus `uniform_int_distribution` predicts which hash function the
   table will use and asserts it matches. A shadow table is compared against
   `GetTable()` and `GetStash()` after every insert. Any disagreement calls
   `abort()`, so the failure mode is no data.
2. **A second implementation.** `tools/04_verify.py` re-derives every field of
   every trace in Python, from hashlib, a hand-written Mersenne Twister and a
   transcription of the abseil mapping. Current result: **47369 checks, 0
   failures** across 19 scenarios.
3. **A third implementation.** `docs/js/engine/` reproduces all 19 traces in the
   browser, field for field, and `docs/selftest.html` reports it: **13541
   checks, 0 failures**. The sandbox, the lab and the comparison panel each run
   the same check against one recorded trace before they draw anything, and
   they say so on the badge if it does not pass.
4. **The reference's own tests.** 7 targets, 29 cases, all green at the pin
   under Bazel 7.4.1. Archived in `notes/reference-test-run/`.
5. **Behavior tests without Bazel.** `tools/cxx/conformance_test.cc`: **58
   checks, 0 failures**, covering 25 of the 29 upstream cases plus 8 checks of
   its own. `tools/12_check_mapping.py` proves the coverage has no gaps.
6. **Byte reproducibility.** Two clean checkouts run `./tools/06_all.sh`
   independently and produce identical trees. The regeneration workflow fails
   on any difference from what is committed.

Every count above is printed by the program that produced it. None is copied
by hand.
