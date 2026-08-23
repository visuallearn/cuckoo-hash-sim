#!/usr/bin/env python3
"""Archive the exact sources the traces were recorded from.

The pins name a commit and a release tarball. Both live on someone else's
servers. If either disappears, or a history is rewritten, the claim "these are
the reference's values" becomes uncheckable. So the sources go in the
repository: the pir/hashing module, the two abseil headers that define how a
Mersenne Twister word becomes a hash-function index, and the licenses.

The archive is small (about 100 KB) and its own hash is recorded, so a reader
can verify it against notes/pins.json without fetching anything.

Usage:  python3 tools/15_archive_pins.py [--check]
"""
from __future__ import annotations

import hashlib
import io
import json
import sys
import tarfile
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DPF = REPO / ".work" / "dpf"
ABSL = REPO / ".work" / "absl-src"
PINS = REPO / "notes" / "pins.json"
OUT = REPO / "notes" / "reference-sources.tar.gz"
MANIFEST = REPO / "notes" / "reference-sources.md"

# The module the traces come from. Everything under pir/hashing/, plus the
# production wiring that the site quotes.
DPF_FILES = [
    "pir/hashing/BUILD",
    "pir/hashing/cuckoo_hash_table.h", "pir/hashing/cuckoo_hash_table.cc",
    "pir/hashing/hash_family.h", "pir/hashing/hash_family.cc",
    "pir/hashing/sha256_hash_family.h", "pir/hashing/sha256_hash_family.cc",
    "pir/hashing/multiple_choice_hash_table.h",
    "pir/hashing/multiple_choice_hash_table.cc",
    "pir/hashing/simple_hash_table.h", "pir/hashing/simple_hash_table.cc",
    "pir/hashing/farm_hash_family.h", "pir/hashing/farm_hash_family.cc",
    "pir/hashing/hash_family_config.h", "pir/hashing/hash_family_config.cc",
    "pir/hashing/hash_family_config.proto",
    "pir/hashing/cuckoo_hash_table_test.cc",
    "pir/hashing/multiple_choice_hash_table_test.cc",
    "pir/hashing/simple_hash_table_test.cc",
    "pir/hashing/sha256_hash_family_test.cc",
    "pir/hashing/hash_family_test.cc",
    "pir/hashing/farm_hash_family_test.cc",
    "pir/hashing/hash_family_config_test.cc",
    "pir/cuckoo_hashing_sparse_dpf_pir_server.h",
    "pir/cuckoo_hashing_sparse_dpf_pir_server.cc",
    "pir/cuckoo_hashed_dpf_pir_database.cc",
    "pir/cuckoo_hashing_sparse_dpf_pir_client.cc",
    "MODULE.bazel",
    "LICENSE",
]

# The two headers that define the index mapping, and abseil's license. These
# are load-bearing: the mapping is the one place where the library version
# decides the shape of every table.
ABSL_FILES = [
    "absl/random/uniform_int_distribution.h",
    "absl/random/internal/fast_uniform_bits.h",
    "absl/random/internal/traits.h",
    "absl/random/internal/wide_multiply.h",
    "LICENSE",
]

NOTICE = """Third-party sources, archived so this repository's claims stay
checkable if the upstream servers change.

  distributed_point_functions/   Copyright 2023 Google LLC
                                 Apache License 2.0, full text at
                                 distributed_point_functions/LICENSE
                                 github.com/google/distributed_point_functions
                                 at commit {dpf_commit}

  abseil-cpp/                    Copyright 2017 The Abseil Authors
                                 Apache License 2.0, full text at
                                 abseil-cpp/LICENSE
                                 github.com/abseil/abseil-cpp release {absl}

Neither project endorses this one. The files are unmodified.
"""


def die(msg: str) -> None:
    print(f"[15] FATAL: {msg}", file=sys.stderr)
    raise SystemExit(1)


def absl_version() -> str:
    for line in (REPO / "tools" / "env.sh").read_text().splitlines():
        if line.startswith("ABSL_VERSION="):
            return line.split("=", 1)[1].strip().strip('"')
    return "unknown"


def build() -> bytes:
    if not DPF.is_dir() or not ABSL.is_dir():
        die("run tools/00_fetch_reference.sh first")
    pins = json.loads(PINS.read_text())
    commit = pins["commit"]

    buf = io.BytesIO()
    # A fixed mtime and a sorted member list, so the archive is byte-identical
    # on every run and the commit diff stays empty.
    with tarfile.open(fileobj=buf, mode="w:gz", compresslevel=9,
                      format=tarfile.GNU_FORMAT) as tar:
        def add(arcname: str, data: bytes) -> None:
            info = tarfile.TarInfo(arcname)
            info.size = len(data)
            info.mtime = 0
            info.mode = 0o644
            info.uid = info.gid = 0
            info.uname = info.gname = "root"
            tar.addfile(info, io.BytesIO(data))

        add("NOTICE", NOTICE.format(dpf_commit=commit, absl=absl_version()).encode())
        for rel in DPF_FILES:
            src = DPF / rel
            if not src.is_file():
                die(f"{rel} is missing from the pinned checkout")
            data = src.read_bytes()
            want = pins["files"].get(rel, {}).get("sha256")
            if want and hashlib.sha256(data).hexdigest() != want:
                die(f"{rel} does not match notes/pins.json")
            add(f"distributed_point_functions/{rel}", data)
        for rel in ABSL_FILES:
            src = ABSL / rel
            if not src.is_file():
                die(f"abseil {rel} is missing")
            add(f"abseil-cpp/{rel}", src.read_bytes())
    # gzip writes an mtime into its own header; zero it so the bytes are stable.
    raw = bytearray(buf.getvalue())
    raw[4:8] = b"\x00\x00\x00\x00"
    return bytes(raw)


def main() -> int:
    data = build()
    digest = hashlib.sha256(data).hexdigest()
    pins = json.loads(PINS.read_text())

    members = ["NOTICE"] + [f"distributed_point_functions/{r}" for r in DPF_FILES] \
        + [f"abseil-cpp/{r}" for r in ABSL_FILES]
    doc = [
        "# Archived reference sources",
        "",
        "`reference-sources.tar.gz` holds the exact files the traces were "
        "recorded from. The pins name a commit and a release tarball, and both "
        "live on someone else's servers; this copy means the claims here stay "
        "checkable if either changes.",
        "",
        f"- **sha256** `{digest}`",
        f"- **bytes** {len(data)}",
        f"- **members** {len(members)}",
        f"- distributed_point_functions at `{pins['commit']}`, Apache 2.0",
        f"- abseil-cpp {absl_version()}, Apache 2.0",
        "",
        "Both licenses are inside the archive, with a NOTICE naming each "
        "project. The files are unmodified.",
        "",
        "```sh",
        "tar tzf notes/reference-sources.tar.gz",
        "sha256sum notes/reference-sources.tar.gz",
        "python3 tools/15_archive_pins.py --check   # rebuild and compare",
        "```",
        "",
        "## Why these files",
        "",
        "The `pir/hashing/` module and its tests are the algorithm. The four "
        "`pir/cuckoo_hashing_*` files are the production wiring the site "
        "quotes. `MODULE.bazel` records the dependency versions the reference "
        "itself pins.",
        "",
        "The four abseil headers are the load-bearing part. "
        "`uniform_int_distribution.h` and `fast_uniform_bits.h` decide how a "
        "Mersenne Twister word becomes a hash-function index, and that "
        "decision fixes the shape of every table on this site. "
        "`traits.h` is where the unsigned type turns out to be 32 bits wide, "
        "and `wide_multiply.h` is the multiply the mapping uses.",
        "",
        "## Contents",
        "",
        "```",
    ] + members + ["```", ""]

    text = "\n".join(doc)

    if "--check" in sys.argv:
        if not OUT.is_file():
            die("notes/reference-sources.tar.gz is missing")
        if OUT.read_bytes() != data:
            die("notes/reference-sources.tar.gz differs from a fresh archive")
        if MANIFEST.read_text() != text:
            die("notes/reference-sources.md is out of date")
        print(f"[15] the archive matches: {len(data)} bytes, sha256 {digest[:16]}...")
        return 0

    OUT.write_bytes(data)
    MANIFEST.write_text(text, encoding="utf-8")
    print(f"[15] wrote notes/reference-sources.tar.gz "
          f"({len(data)} bytes, {len(members)} members)")
    print(f"[15] sha256 {digest}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
