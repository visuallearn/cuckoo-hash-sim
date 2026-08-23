#!/usr/bin/env bash
# Behaviour tests against the pinned reference. These lock the quirks the site
# teaches, so a re-pin of the reference is a conscious, reviewed act.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
. "${REPO_ROOT}/tools/env.sh"
[[ -x "${CXX_BUILD}/conformance_test" ]] \
    || { echo "[05] FATAL: run tools/01_build.sh first" >&2; exit 1; }
"${CXX_BUILD}/conformance_test" | tee "${NOTES_DIR}/conformance-output.txt"
