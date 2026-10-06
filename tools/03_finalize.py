#!/usr/bin/env python3
"""Assemble docs/data/manifest.json from the pins, the scenario index and the
recorded toolchain. Every number the site shows can be traced from here back to
a commit, a file and a line.
"""
from __future__ import annotations

import ctypes
import hashlib
import json
import os
import platform
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DATA = REPO / "docs" / "data"
PINS = REPO / "notes" / "pins.json"
# Authored content. Everything else under docs/data/ is generated, and keeping
# the one hand-written file outside that tree is what lets a clean checkout
# rebuild docs/data/ from nothing.
CONTENT = REPO / "content"
PREDICATES = REPO / "tools" / "scenario-predicates.json"
CMAKE_CACHE = REPO / ".work" / "build" / "CMakeCache.txt"

# The plan named seventeen scenarios. Nineteen files ship. This says why, so the
# difference is a decision on the record rather than a discrepancy.
PLAN_RECONCILIATION = {
    "planScenarioIds": 17,
    "traceFiles": 19,
    "oneToOne": [
        "CK-first-contact", "CK-classroom", "CK-chain", "CK-pingpong",
        "CK-duplicate", "CK-stash", "CK-stash-full", "CK-budget-zero",
        "CK-degenerate", "CK-test-preset", "MC-least-loaded", "MC-bucket-full",
        "SH-fanout", "SH-overflow",
    ],
    "split": {
        "CK-order-matters": {
            "files": ["CK-order-a", "CK-order-b"],
            "why": "The plan describes one scenario holding two orders of the "
                   "same four words. Two orders are two runs of the reference, "
                   "so they are two recordings. The tour puts them side by side.",
        },
    },
    "foldedIn": {
        "LK-hit": {
            "into": "CK-classroom",
            "why": "A lookup is an operation on a finished table, not a "
                   "separate build. Looking for \"cat\" is operation 4 of "
                   "CK-classroom.",
        },
        "LK-miss": {
            "into": "CK-classroom",
            "why": "Looking for \"yak\", which the table does not hold, is "
                   "operation 5 of CK-classroom.",
        },
    },
    "added": {
        "CK-dense": "A table filled to within one bucket of full, so the walk "
                    "lengthening with the load factor can be watched rather "
                    "than only plotted.",
        "CK-production": "The production recipe at a size a person can follow: "
                         "k = 3, buckets = int64(1.5 x n), budget = n.",
        "CK-seeded": "The same recipe with the 16-byte session seed the server "
                     "generates, so the seeded form of the hash is on the "
                     "record and not only described.",
    },
    "provenanceNote": "All nineteen are reference recordings: each one comes "
                      "from a program that links the unmodified pir/hashing "
                      "sources. The one extension, textbook mode on the "
                      "variants page, ships no trace at all; it runs in the "
                      "browser and is badged.",
}

# The extension is listed apart from the reference data, and it has no trace.
EXTENSIONS = {
    "textbook-mode": {
        "where": "#/variants",
        "what": "Pagh and Rodler's construction: look at every candidate, and "
                "on failure make new hash functions and build again.",
        "isReference": False,
        "traceFile": None,
        "computedBy": "docs/js/engine/cuckoo.js runTextbook, in the browser",
        "badge": "textbook, not the Google reference",
    },
}

TOUR_DEFAULT = "CK-classroom"


def sh(*args: str) -> str:
    try:
        return subprocess.run(args, check=True, capture_output=True, text=True).stdout.strip()
    except Exception:
        return "unknown"


def linked_openssl(lib: str) -> str:
    """OpenSSL_version(OPENSSL_VERSION) from the libcrypto CMake linked."""
    try:
        crypto = ctypes.CDLL(lib)
        crypto.OpenSSL_version.restype = ctypes.c_char_p
        crypto.OpenSSL_version.argtypes = [ctypes.c_int]
        return crypto.OpenSSL_version(0).decode()
    except Exception:
        return "unknown"


def copy_authored() -> None:
    """Copy the hand-written content into the generated tree."""
    for name in ("tour.json",):
        src = CONTENT / name
        if not src.is_file():
            print(f"[03] FATAL: {src} is missing", file=sys.stderr)
            raise SystemExit(1)
        # Parse first: a broken tour file should fail here, not in a browser.
        json.loads(src.read_text())
        (DATA / name).write_text(src.read_text(), encoding="utf-8")
        print(f"[03] copied authored content/{name}")


def cmake_setting(key: str) -> str:
    """Read what the build really used, not what the script meant to ask for."""
    if not CMAKE_CACHE.is_file():
        return "unknown"
    for line in CMAKE_CACHE.read_text().splitlines():
        if "=" not in line:
            continue
        # A cache line is NAME:TYPE=VALUE.
        name = line.split("=", 1)[0].split(":", 1)[0]
        if name == key:
            return line.split("=", 1)[1]
    return "unknown"


def main() -> int:
    DATA.mkdir(parents=True, exist_ok=True)
    copy_authored()
    pins = json.loads(PINS.read_text())
    index = json.loads((DATA / "scenario-index.json").read_text())
    predicates = json.loads(PREDICATES.read_text())["scenarios"] \
        if PREDICATES.is_file() else {}

    for entry in index:
        p = DATA / entry["file"]
        data = p.read_bytes()
        entry["sha256"] = hashlib.sha256(data).hexdigest()
        entry["bytes"] = len(data)
        # Every shipped trace is a recording of the reference. Say so per file,
        # so a reader never has to infer it.
        entry["provenance"] = "reference"
        if entry["id"] in predicates:
            entry["contains"] = predicates[entry["id"]]

    env = REPO / "tools" / "env.sh"
    envtext = env.read_text()

    def pin(key: str) -> str:
        for line in envtext.splitlines():
            if line.startswith(f"{key}="):
                return line.split("=", 1)[1].strip().strip('"')
        return "unknown"

    gcc = sh("g++", "-dumpfullversion")
    # Ask the library the build links, not the `openssl` first on PATH. A conda
    # install shadows the system binary with a different version, which made the
    # manifest name a library that never touched a trace, and differ in CI.
    openssl = linked_openssl(cmake_setting("OPENSSL_CRYPTO_LIBRARY"))
    # Not the wall clock. Everything under docs/data/ is a function of the
    # pinned inputs, and a timestamp that moves on its own would break that:
    # two clean checkouts would produce different bytes, and the diff gate in
    # continuous integration would have nothing to say. The date that matters
    # is the reference's, and it comes from the pinned commit.
    ref_date = sh("git", "-C", str(REPO / ".work" / "dpf"),
                  "show", "-s", "--format=%cI", pins["commit"])

    manifest = {
        "schemaVersion": 1,
        "derivedFrom": {
            "referenceCommit": pins["commit"],
            "referenceCommitDate": ref_date,
            "note": (
                "There is no build timestamp here on purpose. Every byte under "
                "docs/data/ is a function of the pinned inputs, so two clean "
                "checkouts produce the same tree and the continuous-integration "
                "diff has something to prove."
            ),
        },
        "reference": {
            "repo": pins["repo"],
            "commit": pins["commit"],
            "commitShort": pins["commitShort"],
            "license": pins["license"],
            "module": "pir/hashing",
            "note": pins["note"],
            "files": pins["files"],
        },
        "toolchain": {
            "abseil": pin("ABSL_VERSION"),
            "abseilSha256": pin("ABSL_SHA256"),
            "boringsslPinnedByReference": pin("BORINGSSL_VERSION"),
            "protobufPinnedByReference": pin("PROTOBUF_VERSION"),
            "googletestPinnedByReference": pin("GOOGLETEST_VERSION"),
            "farmhashCommit": pin("FARMHASH_COMMIT"),
            "abseilBuiltFrom": (
                "the pinned source archive, built by tools/01_build.sh into "
                ".work/absl-install. No system abseil is used, and the CMake "
                "shim fails if it cannot find that one."
            ),
            "abseilCmakeDir": cmake_setting("absl_DIR").replace(str(REPO), "<repo>"),
            "compiler": f"g++ {gcc}",
            "compilerPath": cmake_setting("CMAKE_CXX_COMPILER"),
            "buildType": cmake_setting("CMAKE_BUILD_TYPE"),
            "cxxFlags": (cmake_setting("CMAKE_CXX_FLAGS_RELEASE")
                         + " -std=c++17 -Wno-deprecated-declarations").strip(),
            "sha256Provider": openssl,
            "sha256Library": cmake_setting("OPENSSL_CRYPTO_LIBRARY"),
            "bazelForUpstreamTests": pin("BAZEL_VERSION"),
            "sha256Note": (
                "The reference builds against BoringSSL. This build uses OpenSSL's "
                "SHA256_Init/Update/Final, which has the same API and produces the "
                "same digest. tools/cxx/conformance_test.cc checks the digest "
                "against the NIST CAVP vector that the reference's own test uses."
            ),
            "host": f"{platform.system()} {platform.machine()}",
            "endianness": sys.byteorder,
        },
        "algorithm": {
            "rng": "std::mt19937_64, default-constructed, so seed 5489",
            "indexMapping": (
                "absl::uniform_int_distribution<int>(0, k-1). Its unsigned type is "
                "uint32_t, so it uses the low 32 bits of one Mersenne Twister word. "
                "A power-of-two k masks; any other k multiplies by k, keeps the high "
                "32 bits, and redraws while the low 32 bits are below 2^32 mod k."
            ),
            "hash": (
                "SHA-256 of the seed followed by the input. The 32 bytes are read as "
                "one little-endian 256-bit integer, then reduced by three divisions "
                "in base 2^64."
            ),
            "production": {
                "numHashFunctions": 3,
                "bucketsPerElement": 1.5,
                "bucketsFormula": "int64(1.5 * num_elements), which truncates",
                "maxRelocations": "num_records",
                "maxStashSize": None,
                "sessionSeedBytes": 16,
                "stashNote": (
                    "The database builder copies only GetTable() into the served "
                    "database, so a key on the stash cannot be retrieved. The "
                    "parameters are chosen so the stash stays empty."
                ),
            },
        },
        "scenarios": index,
        "planReconciliation": PLAN_RECONCILIATION,
        "extensions": EXTENSIONS,
        "default": {"route": "tour", "scenario": TOUR_DEFAULT},
        "source": {
            "code": "source/code.json",
            "license": "source/LICENSE-dpf.txt",
        },
        "rngGolden": "rng-golden.json",
    }

    out = DATA / "manifest.json"
    out.write_text(json.dumps(manifest, indent=1) + "\n", encoding="utf-8")
    total = sum(e["bytes"] for e in index)
    print(f"[03] manifest.json: {len(index)} scenarios, {total // 1024} KiB of traces")
    return 0


if __name__ == "__main__":
    sys.exit(main())
