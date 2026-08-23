#!/usr/bin/env bash
# Phase 0. Run the reference and look at what it does. The output is archived in
# notes/explore-output.txt and notes/FIDELITY.md answers every question from it.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
. "${REPO_ROOT}/tools/env.sh"
[[ -x "${CXX_BUILD}/explore" ]] || { echo "[09] FATAL: run tools/01_build.sh first" >&2; exit 1; }
"${CXX_BUILD}/explore" | tee "${NOTES_DIR}/explore-output.txt"
