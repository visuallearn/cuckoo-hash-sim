#!/usr/bin/env python3
"""Slice the pristine reference source into JSON for the code panel.

The text comes from `git show <pin>:<path>`, so it is the upstream file and
nothing else. Every range is found by anchor text and then asserted against the
line numbers the traces point at, so an upstream change fails here rather than
mis-highlighting code for a reader.
"""
from __future__ import annotations

import hashlib
import json
import shutil
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DPF = REPO / ".work" / "dpf"
OUT = REPO / "docs" / "data" / "source"
PINS = REPO / "notes" / "pins.json"

# name -> (path, opening anchor, closing line text, expected first line, expected last)
EXTRACTS = {
    "cuckoo_insert": (
        "pir/hashing/cuckoo_hash_table.cc",
        "absl::Status CuckooHashTable::Insert(absl::string_view input) {",
        "}", 67, 90,
        "CuckooHashTable::Insert",
        "The whole algorithm. One hash function is drawn per attempt, and only "
        "that one bucket is looked at.",
    ),
    "cuckoo_create": (
        "pir/hashing/cuckoo_hash_table.cc",
        "absl::StatusOr<std::unique_ptr<CuckooHashTable>> CuckooHashTable::Create(",
        "}", 47, 65,
        "CuckooHashTable::Create",
        "What the parameters must be. Two hash functions is the minimum, and a "
        "relocation budget of zero is legal.",
    ),
    "sha256_hash": (
        "pir/hashing/sha256_hash_family.cc",
        "int SHA256HashFunction::operator()(absl::string_view input,",
        "}", 59, 87,
        "SHA256HashFunction::operator()",
        "The digest becomes one 256-bit little-endian integer, then three "
        "divisions in base 2^64 reduce it.",
    ),
    "hash_family": (
        "pir/hashing/hash_family.cc",
        "absl::StatusOr<std::vector<HashFunction>> CreateHashFunctions(",
        "}", 27, 39,
        "CreateHashFunctions",
        "Where the per-function seeds come from: the decimal index, as text.",
    ),
    "mcht_insert": (
        "pir/hashing/multiple_choice_hash_table.cc",
        "absl::Status MultipleChoiceHashTable::Insert(absl::string_view input) {",
        "}", 57, 72,
        "MultipleChoiceHashTable::Insert",
        "All k buckets are measured, in order, and the least loaded one wins. "
        "Nothing is ever evicted.",
    ),
    "simple_insert": (
        "pir/hashing/simple_hash_table.cc",
        "absl::Status SimpleHashTable::Insert(absl::string_view input) {",
        "}", 55, 70,
        "SimpleHashTable::Insert",
        "Two loops: every candidate is measured first, then every candidate "
        "takes a copy.",
    ),
    "client_probe": (
        "pir/cuckoo_hashing_sparse_dpf_pir_client.cc",
        "absl::StatusOr<std::tuple<DpfPirRequest::PlainRequest,",
        "}", 132, 165,
        "CuckooHashingSparseDpfPirClient::CreatePlainRequests",
        "The client side of a lookup. Every hash function is used, and equal "
        "indices are not removed.",
    ),
    "database_build": (
        "pir/cuckoo_hashed_dpf_pir_database.cc",
        "CuckooHashedDpfPirDatabase::Builder::Build() {",
        "}", 117, 181,
        "CuckooHashedDpfPirDatabase::Builder::Build",
        "How production builds the table. Only GetTable() is copied into the "
        "served database, so anything on the stash becomes unreachable.",
    ),
    "server_params": (
        "pir/cuckoo_hashing_sparse_dpf_pir_server.cc",
        "CuckooHashingSparseDpfPirServer::GenerateParams(const PirConfig& config) {",
        "}", 51, 75,
        "CuckooHashingSparseDpfPirServer::GenerateParams",
        "The production parameters: three hash functions, 1.5 buckets per "
        "element, and a fresh 16-byte session seed.",
    ),
}

# Lines the traces point at, with a substring that must be on that line.
LINE_ANCHORS = {
    "pir/hashing/cuckoo_hash_table.cc": {
        71: "int hash = hash_functions_[random_hash_function_(rng_)](current_element,",
        75: "std::swap(current_element, *table_[hash]);",
        78: "table_[hash] = std::move(current_element);",
        85: 'return absl::InternalError("Cannot insert element: stash is full");',
        87: "stash_.push_back(std::move(current_element));",
    },
    "pir/hashing/sha256_hash_family.cc": {
        59: "int SHA256HashFunction::operator()(absl::string_view input,",
        80: "auto remainder1 = static_cast<uint64_t>(dividend1 % upper_bound);",
        83: "auto remainder2 = static_cast<uint64_t>(dividend2 % upper_bound);",
        86: "return static_cast<int>(dividend3 % upper_bound);",
    },
    "pir/hashing/multiple_choice_hash_table.cc": {
        61: "hashes[i] = hash_functions_[i](input, num_buckets_);",
        62: "if (i == 0 || table_[hashes[i]].size() < table_[smallest_bucket].size()) {",
        67: "return absl::InternalError(",
        70: "table_[smallest_bucket].push_back(std::string(input));",
    },
    "pir/hashing/simple_hash_table.cc": {
        58: "hashes[i] = hash_functions_[i](input, num_buckets_);",
        59: "if (max_bucket_size_ && table_[hashes[i]].size() >= *max_bucket_size_) {",
        60: "return absl::InternalError(",
        67: "table_[hashes[i]].push_back(std::string(input));",
    },
    "pir/cuckoo_hashing_sparse_dpf_pir_client.cc": {
        139: "for (int j = 0; j < hash_functions_.size(); ++j) {",
        140: "indices.push_back(hash_functions_[j](query[i], num_buckets_));",
    },
    "pir/cuckoo_hashed_dpf_pir_database.cc": {
        149: "DPF_RETURN_IF_ERROR(cuckoo_hasher->Insert(key));",
        155: "cuckoo_hasher->GetTable();",
    },
    "pir/cuckoo_hashing_sparse_dpf_pir_server.cc": {
        70: "params.set_num_hash_functions(kNumHashFunctions);",
        71: "params.set_num_buckets(",
    },
}


def die(msg: str) -> None:
    print(f"[02] FATAL: {msg}", file=sys.stderr)
    raise SystemExit(1)


def git_show(rel: str) -> str:
    return subprocess.run(["git", "-C", str(DPF), "show", f"HEAD:{rel}"],
                          check=True, capture_output=True, text=True).stdout


def main() -> None:
    if not (DPF / ".git").is_dir():
        die("run tools/00_fetch_reference.sh first")
    pins = json.loads(PINS.read_text())
    commit = pins["commit"]
    head = subprocess.run(["git", "-C", str(DPF), "rev-parse", "HEAD"],
                          check=True, capture_output=True, text=True).stdout.strip()
    if head != commit:
        die(f"the checkout is at {head[:12]}, notes/pins.json says {commit[:12]}")

    files: dict[str, list[str]] = {}
    for rel in sorted({v[0] for v in EXTRACTS.values()} | set(LINE_ANCHORS)):
        text = git_show(rel)
        sha = hashlib.sha256(text.encode("utf-8")).hexdigest()
        want = pins["files"].get(rel, {}).get("sha256")
        if want and sha != want:
            die(f"{rel} sha256 {sha} != notes/pins.json {want}")
        files[rel] = text.split("\n")

    OUT.mkdir(parents=True, exist_ok=True)
    docs = {}
    for name, (rel, anchor, close, want_start, want_end, symbol, blurb) in EXTRACTS.items():
        lines = files[rel]
        text = "\n".join(lines)
        idx = text.find(anchor)
        if idx < 0:
            die(f"{name}: anchor not found in {rel}")
        if text.find(anchor, idx + 1) >= 0:
            die(f"{name}: anchor is not unique in {rel}")
        start = text.count("\n", 0, idx) + 1
        end = None
        for i in range(start, len(lines)):
            if lines[i] == close:
                end = i + 1
                break
        if end is None:
            die(f"{name}: no closing line {close!r}")
        if (start, end) != (want_start, want_end):
            die(f"{name}: found lines {start}-{end}, expected {want_start}-{want_end}. "
                "Upstream moved; update tools/02_extract_source.py and the trace "
                "line numbers in tools/cxx/trace_gen.cc together.")
        docs[name] = {
            "name": name,
            "symbol": symbol,
            "blurb": blurb,
            "file": rel,
            "commit": commit,
            "sourceSha256": pins["files"][rel]["sha256"],
            "permalink": f"https://github.com/google/distributed_point_functions/blob/"
                         f"{commit}/{rel}#L{start}-L{end}",
            "startLine": start,
            "endLine": end,
            "lines": [{"n": start + k, "t": lines[start - 1 + k]}
                      for k in range(end - start + 1)],
        }

    bad = []
    for rel, anchors in LINE_ANCHORS.items():
        for n, sub in sorted(anchors.items()):
            if sub not in files[rel][n - 1]:
                bad.append((rel, n, sub, files[rel][n - 1]))
    if bad:
        for rel, n, sub, got in bad:
            print(f"[02]   {rel}:{n}\n[02]     want {sub!r}\n[02]     got  {got!r}",
                  file=sys.stderr)
        die("the line numbers the traces point at no longer match the source")

    (OUT / "code.json").write_text(
        json.dumps({"commit": commit, "docs": docs,
                    "lineAnchors": {rel: {str(k): v for k, v in sorted(a.items())}
                                    for rel, a in LINE_ANCHORS.items()}},
                   separators=(",", ":")) + "\n", encoding="utf-8")

    lic = DPF / "LICENSE"
    if not lic.is_file():
        die("the reference LICENSE is missing; the excerpts may not be redistributed "
            "without it")
    shutil.copy2(lic, OUT / "LICENSE-dpf.txt")

    for name, d in docs.items():
        print(f"[02] {name:14s} {d['file']}:{d['startLine']}-{d['endLine']}")
    total = sum(len(a) for a in LINE_ANCHORS.values())
    print(f"[02] verified {total} trace line anchors across {len(LINE_ANCHORS)} files")
    print("[02] OK")


if __name__ == "__main__":
    main()
