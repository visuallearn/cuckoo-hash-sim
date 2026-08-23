#!/usr/bin/env python3
"""Record the sha256 of every reference file this project treats as ground truth.

notes/pins.json is the anchor the manifest, the code panel and the About page all
quote. Regenerating it is cheap; changing it should never be quiet, so it is a
committed file and CI diffs it.
"""
from __future__ import annotations

import hashlib
import json
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DPF = REPO / ".work" / "dpf"
OUT = REPO / "notes" / "pins.json"

HASHING = "pir/hashing"
HASHING_FILES = [
    "cuckoo_hash_table.h", "cuckoo_hash_table.cc",
    "hash_family.h", "hash_family.cc",
    "sha256_hash_family.h", "sha256_hash_family.cc",
    "multiple_choice_hash_table.h", "multiple_choice_hash_table.cc",
    "simple_hash_table.h", "simple_hash_table.cc",
    "farm_hash_family.h", "farm_hash_family.cc",
    "hash_family_config.h", "hash_family_config.cc", "hash_family_config.proto",
    "cuckoo_hash_table_test.cc", "multiple_choice_hash_table_test.cc",
    "simple_hash_table_test.cc", "sha256_hash_family_test.cc", "hash_family_test.cc",
    "BUILD",
]
PROD_FILES = [
    "pir/cuckoo_hashing_sparse_dpf_pir_server.h",
    "pir/cuckoo_hashing_sparse_dpf_pir_server.cc",
    "pir/cuckoo_hashed_dpf_pir_database.cc",
    "pir/cuckoo_hashing_sparse_dpf_pir_client.cc",
    "MODULE.bazel",
]


def die(msg: str) -> None:
    print(f"[00b] FATAL: {msg}", file=sys.stderr)
    raise SystemExit(1)


def main() -> None:
    if not (DPF / ".git").is_dir():
        die("run tools/00_fetch_reference.sh first")
    commit = subprocess.run(["git", "-C", str(DPF), "rev-parse", "HEAD"],
                            check=True, capture_output=True, text=True).stdout.strip()

    files = {}
    for rel in [f"{HASHING}/{n}" for n in HASHING_FILES] + PROD_FILES:
        p = DPF / rel
        if not p.is_file():
            die(f"{rel} is missing from the pinned tree")
        data = p.read_bytes()
        files[rel] = {
            "sha256": hashlib.sha256(data).hexdigest(),
            "bytes": len(data),
            "permalink": f"https://github.com/google/distributed_point_functions/blob/{commit}/{rel}",
        }

    doc = {
        "repo": "https://github.com/google/distributed_point_functions",
        "commit": commit,
        "commitShort": commit[:12],
        "license": "Apache-2.0",
        "note": (
            "Google's open-source cuckoo hashing lives here, not in "
            "google/private-join-and-compute. See notes/FIDELITY.md section 0."
        ),
        "files": files,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(doc, indent=1, sort_keys=True) + "\n", encoding="utf-8")
    print(f"[00b] recorded {len(files)} file hashes at {commit[:12]}")


if __name__ == "__main__":
    main()
