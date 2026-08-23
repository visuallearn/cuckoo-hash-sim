#!/usr/bin/env bash
# Record every trace from the pinned reference, then assemble the manifest.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
. "${REPO_ROOT}/tools/env.sh"

for b in trace_gen rng_vectors; do
    [[ -x "${CXX_BUILD}/${b}" ]] || { echo "[03] FATAL: ${b} missing. Run tools/01_build.sh." >&2; exit 1; }
done

mkdir -p "${TRACE_DIR}"
rm -f "${TRACE_DIR}"/*.json

echo "[03] recording traces from the reference"
"${CXX_BUILD}/trace_gen" "${REPO_ROOT}/tools/scenarios.txt" "${DATA_DIR}"

echo "[03] capturing golden index draws"
"${CXX_BUILD}/rng_vectors" 1000 > "${NOTES_DIR}/rng-golden.txt"
python3 - "${NOTES_DIR}/rng-golden.txt" "${DATA_DIR}/rng-golden.json" <<'PY'
import json, sys
src, dst = sys.argv[1], sys.argv[2]
rows = []
for line in open(src):
    if line.startswith("#"):
        continue
    f = line.split()
    k, n = int(f[0]), int(f[1])
    if k in (2, 3) and n < 256:
        rows.append({"k": k, "n": n, "j": int(f[2]), "raw": f[4:]})
open(dst, "w").write(json.dumps({
    "note": "Golden draws captured from abseil 20240722.0 by tools/cxx/rng_vectors.cc. "
            "docs/selftest.html replays them through the browser engine.",
    "generator": "std::mt19937_64 default-constructed (seed 5489)",
    "draws": rows,
}, separators=(",", ":")) + "\n")
print(f"[03] browser golden subset: {len(rows)} draws")
PY

python3 "${REPO_ROOT}/tools/03_finalize.py"
echo "[03] OK"
