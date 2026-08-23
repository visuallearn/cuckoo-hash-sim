#!/usr/bin/env python3
"""An independent second implementation of the reference, in Python.

Nothing here calls the C++. The Mersenne Twister is written from the standard's
own description, the index mapping is transcribed from abseil 20240722.0, and
the digest comes from hashlib rather than from OpenSSL or BoringSSL. Two
implementations that agree on every byte of every trace is the evidence this
project offers for "the same as the reference".

Sources, all at the pinned commits:
  pir/hashing/cuckoo_hash_table.cc          Insert, lines 67-90
  pir/hashing/sha256_hash_family.cc         operator(), lines 59-87
  pir/hashing/hash_family.cc                CreateHashFunctions, line 36
  pir/hashing/multiple_choice_hash_table.cc Insert, lines 57-72
  pir/hashing/simple_hash_table.cc          Insert, lines 55-70
  absl/random/uniform_int_distribution.h    Generate
  absl/random/internal/fast_uniform_bits.h  FastUniformBits, simplified loop
"""
from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from typing import Callable, Iterable, Optional

MASK64 = (1 << 64) - 1
MASK32 = (1 << 32) - 1


# --------------------------------------------------------------------- mt19937_64

class MT19937_64:
    """std::mt19937_64. Default-constructed means seed 5489, per the standard."""

    N = 312
    M = 156
    A = 0xB5026F5AA96619E9
    UPPER = 0xFFFFFFFF80000000  # the high 64 - 31 bits
    LOWER = 0x000000007FFFFFFF  # the low 31 bits
    F = 6364136223846793005

    def __init__(self, seed: int = 5489):
        self.mt = [0] * self.N
        self.mt[0] = seed & MASK64
        for i in range(1, self.N):
            prev = self.mt[i - 1]
            self.mt[i] = (self.F * (prev ^ (prev >> 62)) + i) & MASK64
        self.index = self.N

    def _twist(self) -> None:
        for i in range(self.N):
            x = (self.mt[i] & self.UPPER) | (self.mt[(i + 1) % self.N] & self.LOWER)
            xa = x >> 1
            if x & 1:
                xa ^= self.A
            self.mt[i] = self.mt[(i + self.M) % self.N] ^ xa
        self.index = 0

    def __call__(self) -> int:
        if self.index >= self.N:
            self._twist()
        y = self.mt[self.index]
        self.index += 1
        y ^= (y >> 29) & 0x5555555555555555
        y ^= (y << 17) & 0x71D67FFFEDA60000
        y &= MASK64
        y ^= (y << 37) & 0xFFF7EEE000000000
        y &= MASK64
        y ^= y >> 43
        return y & MASK64


@dataclass
class Draw:
    raws: list[int]
    j: int


class UniformIndex:
    """absl::uniform_int_distribution<int>(0, k-1) over a std::mt19937_64.

    unsigned_type comes from the digits of `unsigned int`, so it is uint32_t and
    the arithmetic is 32-bit. FastUniformBits<uint32_t> over a generator whose
    range covers the whole of uint64_t takes the simplified loop with one
    iteration and no shift, which is a plain narrowing cast: the low 32 bits of
    one word. Reading that as 64-bit changes every index, so tools/cxx/
    rng_vectors.cc captures golden draws from the real abseil and
    tools/04_verify.py replays them through this class.
    """

    def __init__(self, k: int, rng: Optional[MT19937_64] = None):
        if k < 1:
            raise ValueError("k must be positive")
        self.k = k
        self.rng = rng if rng is not None else MT19937_64()
        self.R = k - 1
        self.Lim = k
        self.threshold = (1 << 32) % self.Lim

    def draw(self) -> Draw:
        raws = [self.rng()]
        bits = raws[-1] & MASK32
        if (self.R & self.Lim) == 0:
            # A power-of-two range takes the low bits and never redraws.
            return Draw(raws, bits & self.R)
        product = bits * self.Lim
        while (product & MASK32) < self.threshold:
            raws.append(self.rng())
            bits = raws[-1] & MASK32
            product = bits * self.Lim
        return Draw(raws, product >> 32)


# ------------------------------------------------------------------------ hashing

@dataclass
class Ladder:
    digest: bytes
    lo: int
    hi: int
    n: int
    r1: int
    d2: int
    r2: int
    d3: int
    r3: int

    @property
    def bucket(self) -> int:
        return self.r3


def sha256_ladder(seed: bytes, data: bytes, upper_bound: int) -> Ladder:
    """SHA256HashFunction::operator(), statement for statement."""
    if upper_bound <= 0:
        raise ValueError("upper_bound must be positive")
    digest = hashlib.sha256(seed + data).digest()
    # The reference copies raw bytes into two absl::uint128 on a little-endian
    # host, which reads digest[0..15] as `lo` and digest[16..31] as `hi`.
    lo = int.from_bytes(digest[0:16], "little")
    hi = int.from_bytes(digest[16:32], "little")
    n = (hi << 128) | lo
    r1 = hi % upper_bound
    d2 = (r1 << 64) | (lo >> 64)
    r2 = d2 % upper_bound
    d3 = (r2 << 64) | (lo & MASK64)
    r3 = d3 % upper_bound
    if r3 != n % upper_bound:
        raise AssertionError("the ladder does not equal one 256-bit reduction")
    return Ladder(digest, lo, hi, n, r1, d2, r2, d3, r3)


def per_function_seeds(k: int, family_seed: bytes = b"") -> list[bytes]:
    """hash_family.cc:36 uses absl::StrCat(i); hash_family.h:48 prepends a seed."""
    return [family_seed + str(i).encode("ascii") for i in range(k)]


def make_hash(seed: bytes) -> Callable[[bytes, int], int]:
    def h(data: bytes, upper_bound: int) -> int:
        return sha256_ladder(seed, data, upper_bound).bucket
    return h


# ---------------------------------------------------------------- the structures

class CreateError(Exception):
    pass


@dataclass
class Event:
    kind: str
    data: dict


@dataclass
class CuckooResult:
    status: str            # "ok" | "error"
    status_code: str       # "OK" | "INTERNAL"
    message: str
    events: list[Event]
    relocations_used: int


class CuckooHashTable:
    """pir/hashing/cuckoo_hash_table.cc."""

    def __init__(self, seeds: list[bytes], num_buckets: int, max_relocations: int,
                 max_stash_size: Optional[int] = None):
        if num_buckets <= 0:
            raise CreateError("num_buckets must be positive")
        if len(seeds) < 2:
            raise CreateError("hash_functions.size() must be at least 2")
        if max_relocations < 0:
            raise CreateError("max_relocations must be non-negative")
        if max_stash_size is not None and max_stash_size < 0:
            raise CreateError("max_stash_size must be non-negative")
        self.seeds = seeds
        self.k = len(seeds)
        self.m = num_buckets
        self.max_relocations = max_relocations
        self.max_stash_size = max_stash_size
        self.table: list[Optional[bytes]] = [None] * num_buckets
        self.stash: list[bytes] = []
        self.index = UniformIndex(self.k)

    def insert(self, element: bytes) -> CuckooResult:
        events: list[Event] = []
        current = element
        placed = False
        i = 0
        for i in range(self.max_relocations):
            d = self.index.draw()
            events.append(Event("draw", {"i": i, "j": d.j, "raws": list(d.raws)}))
            L = sha256_ladder(self.seeds[d.j], current, self.m)
            events.append(Event("hash", {"i": i, "j": d.j, "input": current, "ladder": L,
                                         "bucket": L.bucket}))
            b = L.bucket
            if self.table[b] is not None:
                outgoing = self.table[b]
                events.append(Event("evict", {"i": i, "bucket": b, "incoming": current,
                                              "outgoing": outgoing}))
                current, self.table[b] = self.table[b], current
            else:
                events.append(Event("place", {"i": i, "bucket": b, "element": current}))
                self.table[b] = current
                placed = True
                break
        used = (i + 1) if (self.max_relocations > 0 and placed) else \
               (self.max_relocations if self.max_relocations > 0 else 0)
        if placed:
            return CuckooResult("ok", "OK", "", events, used)
        if self.max_stash_size is not None and len(self.stash) >= self.max_stash_size:
            events.append(Event("stash_overflow_error", {"element": current}))
            return CuckooResult("error", "INTERNAL", "Cannot insert element: stash is full",
                                events, self.max_relocations)
        events.append(Event("stash_push", {"element": current,
                                           "stash_index_after": len(self.stash)}))
        self.stash.append(current)
        return CuckooResult("ok", "OK", "", events, self.max_relocations)


class MultipleChoiceHashTable:
    """pir/hashing/multiple_choice_hash_table.cc."""

    def __init__(self, seeds: list[bytes], num_buckets: int,
                 max_bucket_size: Optional[int] = None):
        if num_buckets <= 0:
            raise CreateError("num_buckets must be positive")
        if len(seeds) < 2:
            raise CreateError("hash_functions.size() must be at least 2")
        if max_bucket_size is not None and max_bucket_size <= 0:
            raise CreateError("max_bucket_size must be positive")
        self.seeds = seeds
        self.m = num_buckets
        self.max_bucket_size = max_bucket_size
        self.table: list[list[bytes]] = [[] for _ in range(num_buckets)]

    def insert(self, element: bytes) -> CuckooResult:
        events: list[Event] = []
        hashes: list[int] = []
        smallest = 0
        for i, seed in enumerate(self.seeds):
            L = sha256_ladder(seed, element, self.m)
            hashes.append(L.bucket)
            events.append(Event("hash", {"j": i, "input": element, "ladder": L,
                                         "bucket": L.bucket,
                                         "size": len(self.table[L.bucket])}))
            # Line 62: a strict <, so the first minimum keeps the choice.
            if i == 0 or len(self.table[hashes[i]]) < len(self.table[smallest]):
                smallest = hashes[i]
        events.append(Event("choose", {"bucket": smallest, "candidates": list(hashes)}))
        if self.max_bucket_size is not None and len(self.table[smallest]) >= self.max_bucket_size:
            events.append(Event("bucket_full_error", {"bucket": smallest, "element": element}))
            return CuckooResult("error", "INTERNAL",
                                "Cannot insert element: maximum bucket size reached", events, 0)
        events.append(Event("append", {"bucket": smallest, "element": element}))
        self.table[smallest].append(element)
        return CuckooResult("ok", "OK", "", events, 0)


class SimpleHashTable:
    """pir/hashing/simple_hash_table.cc."""

    def __init__(self, seeds: list[bytes], num_buckets: int,
                 max_bucket_size: Optional[int] = None):
        if num_buckets <= 0:
            raise CreateError("num_buckets must be positive")
        if not seeds:
            raise CreateError("hash_functions must not be empty")
        if max_bucket_size is not None and max_bucket_size <= 0:
            raise CreateError("max_bucket_size must be positive")
        self.seeds = seeds
        self.m = num_buckets
        self.max_bucket_size = max_bucket_size
        self.table: list[list[bytes]] = [[] for _ in range(num_buckets)]

    def insert(self, element: bytes) -> CuckooResult:
        events: list[Event] = []
        hashes: list[int] = []
        # First loop: every candidate is measured before anything is appended, so
        # a bucket named twice by one element is measured twice at its old size.
        for i, seed in enumerate(self.seeds):
            L = sha256_ladder(seed, element, self.m)
            hashes.append(L.bucket)
            size = len(self.table[L.bucket])
            events.append(Event("hash", {"j": i, "input": element, "ladder": L,
                                         "bucket": L.bucket, "size": size}))
            full = self.max_bucket_size is not None and size >= self.max_bucket_size
            events.append(Event("capacity_check", {"j": i, "bucket": L.bucket,
                                                   "size": size, "full": full}))
            if full:
                events.append(Event("bucket_full_error", {"bucket": L.bucket,
                                                          "element": element}))
                return CuckooResult("error", "INTERNAL",
                                    "Cannot insert element: maximum bucket size reached",
                                    events, 0)
        for i, b in enumerate(hashes):
            events.append(Event("append", {"j": i, "bucket": b, "element": element}))
            self.table[b].append(element)
        return CuckooResult("ok", "OK", "", events, 0)


# ------------------------------------------------------------------------- lookup

def lookup(seeds: list[bytes], table: list[Optional[bytes]], stash: list[bytes],
           query: bytes, num_buckets: int) -> dict:
    """The client's probe: all k indices, no duplicate removal.

    pir/cuckoo_hashing_sparse_dpf_pir_client.cc:137-142.
    """
    buckets = [sha256_ladder(s, query, num_buckets).bucket for s in seeds]
    hit_bucket = -1
    for b in buckets:
        if table[b] is not None and table[b] == query and hit_bucket < 0:
            hit_bucket = b
    stash_index = stash.index(query) if query in stash else -1
    return {
        "buckets": buckets,
        "foundInTable": hit_bucket >= 0,
        "bucket": hit_bucket,
        "foundInStash": stash_index >= 0,
        "stashIndex": stash_index,
    }
