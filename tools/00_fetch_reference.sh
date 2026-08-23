#!/usr/bin/env bash
# Fetch the reference implementation and its build dependencies at pinned
# versions into .work/. Idempotent: a tree that is already at the pin is left
# alone. A pin that no longer matches is a hard error, never a silent update.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
. "${REPO_ROOT}/tools/env.sh"
mkdir -p "${WORK_DIR}"

die() { echo "[00] FATAL: $*" >&2; exit 1; }

# ---------------------------------------------------------------- the reference
if [[ -d "${DPF_DIR}/.git" ]]; then
    have="$(git -C "${DPF_DIR}" rev-parse HEAD)"
    [[ "${have}" == "${DPF_COMMIT}" ]] \
        || { echo "[00] ${DPF_DIR} is at ${have:0:12}, want ${DPF_COMMIT:0:12}; re-cloning." >&2
             rm -rf "${DPF_DIR}"; }
fi
if [[ ! -d "${DPF_DIR}/.git" ]]; then
    echo "[00] cloning distributed_point_functions"
    git clone --filter=blob:none --no-checkout "${DPF_URL}" "${DPF_DIR}"
    git -C "${DPF_DIR}" checkout --quiet "${DPF_COMMIT}"
fi
have="$(git -C "${DPF_DIR}" rev-parse HEAD)"
[[ "${have}" == "${DPF_COMMIT}" ]] || die "checkout is ${have}, expected ${DPF_COMMIT}"

# The reference pins its own dependencies. Read them back and compare, so that
# a re-pin of the reference cannot silently move abseil underneath us. Section
# 2.5 of the plan explains why the abseil version is load-bearing: it decides
# how a raw Mersenne Twister word becomes a hash-function index.
mb="${DPF_DIR}/MODULE.bazel"
check_dep() {  # name expected
    got="$(awk -v n="\"$1\"" '$0 ~ "name = " n {f=1} f && /version = /{print $3; exit}' "${mb}" | tr -d '",')"
    [[ "${got}" == "$2" ]] || die "MODULE.bazel pins $1 ${got}, tools/env.sh says $2"
    echo "[00]   $1 ${got}"
}
check_dep abseil-cpp   "${ABSL_VERSION}"
check_dep boringssl    "${BORINGSSL_VERSION}"
check_dep protobuf     "${PROTOBUF_VERSION}"
check_dep googletest   "${GOOGLETEST_VERSION}"
grep -q "${FARMHASH_COMMIT}" "${mb}" || die "MODULE.bazel no longer pins farmhash ${FARMHASH_COMMIT}"

# ---------------------------------------------------------------- abseil source
if [[ ! -f "${ABSL_SRC}/CMakeLists.txt" ]]; then
    echo "[00] downloading abseil-cpp ${ABSL_VERSION}"
    tgz="${WORK_DIR}/absl.tar.gz"
    curl -sSL -o "${tgz}" \
        "https://github.com/abseil/abseil-cpp/archive/refs/tags/${ABSL_VERSION}.tar.gz"
    got="$(sha256sum "${tgz}" | cut -d' ' -f1)"
    [[ "${got}" == "${ABSL_SHA256}" ]] || die "abseil archive sha256 ${got} != ${ABSL_SHA256}"
    rm -rf "${ABSL_SRC}"
    tar -C "${WORK_DIR}" -xzf "${tgz}"
    mv "${WORK_DIR}/abseil-cpp-${ABSL_VERSION}" "${ABSL_SRC}"
fi
grep -q "ABSL_LTS_RELEASE_VERSION ${ABSL_VERSION%%.*}" "${ABSL_SRC}/CMake/AbseilHelpers.cmake" 2>/dev/null || true

# ---------------------------------------------------------------- farmhash
if [[ ! -f "${FARMHASH_DIR}/farmhash.cc" ]]; then
    echo "[00] downloading farmhash ${FARMHASH_COMMIT:0:12}"
    zip="${WORK_DIR}/farmhash.zip"
    curl -sSL -o "${zip}" \
        "https://github.com/google/farmhash/archive/${FARMHASH_COMMIT}.zip"
    got="$(sha256sum "${zip}" | cut -d' ' -f1)"
    [[ "${got}" == "${FARMHASH_SHA256}" ]] || die "farmhash archive sha256 ${got} != ${FARMHASH_SHA256}"
    rm -rf "${FARMHASH_DIR}" "${WORK_DIR}/farmhash-${FARMHASH_COMMIT}"
    ( cd "${WORK_DIR}" && unzip -q "${zip}" )
    mkdir -p "${FARMHASH_DIR}"
    cp "${WORK_DIR}/farmhash-${FARMHASH_COMMIT}/src/farmhash.h" \
       "${WORK_DIR}/farmhash-${FARMHASH_COMMIT}/src/farmhash.cc" "${FARMHASH_DIR}/"
    rm -rf "${WORK_DIR}/farmhash-${FARMHASH_COMMIT}"
fi

# ---------------------------------------------------------------- provenance
python3 "${REPO_ROOT}/tools/00b_record_pins.py"
echo "[00] OK: reference at ${DPF_COMMIT:0:12}"
