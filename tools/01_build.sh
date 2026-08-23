#!/usr/bin/env bash
# Build abseil at the pinned version, then the reference's hashing module and the
# harnesses, out of tree. Idempotent.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
. "${REPO_ROOT}/tools/env.sh"

[[ -d "${DPF_DIR}/.git" ]] || { echo "[01] FATAL: run tools/00_fetch_reference.sh first" >&2; exit 1; }

if [[ ! -f "${ABSL_PREFIX}/lib/cmake/absl/abslConfig.cmake" ]]; then
    echo "[01] building abseil ${ABSL_VERSION}"
    cmake -S "${ABSL_SRC}" -B "${ABSL_BUILD}" \
        -DCMAKE_BUILD_TYPE=Release -DCMAKE_CXX_STANDARD=17 \
        -DABSL_PROPAGATE_CXX_STD=ON -DABSL_BUILD_TESTING=OFF -DBUILD_TESTING=OFF \
        -DCMAKE_POSITION_INDEPENDENT_CODE=ON \
        -DCMAKE_INSTALL_PREFIX="${ABSL_PREFIX}" > "${WORK_DIR}/absl-cmake.log"
    cmake --build "${ABSL_BUILD}" -j "${JOBS}" > "${WORK_DIR}/absl-build.log"
    cmake --install "${ABSL_BUILD}" > "${WORK_DIR}/absl-install.log"
fi
echo "[01] abseil ${ABSL_VERSION} at ${ABSL_PREFIX}"

cmake -S "${REPO_ROOT}/tools/cxx" -B "${CXX_BUILD}" \
    -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_PREFIX_PATH="${ABSL_PREFIX}" \
    -DDPF_DIR="${DPF_DIR}" \
    -DFARMHASH_DIR="${FARMHASH_DIR}" \
    -DWORK_DIR="${WORK_DIR}" > "${WORK_DIR}/harness-cmake.log"
cmake --build "${CXX_BUILD}" -j "${JOBS}"
echo "[01] OK"
