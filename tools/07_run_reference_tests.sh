#!/usr/bin/env bash
# Run the reference's own unit tests with its own build system, and archive the
# result into notes/reference-test-run/.
#
# The reference needs Bazel 7 or later with bzlmod. bazelisk is a single static
# binary that fetches the right one, so this script prefers it and falls back to
# whatever `bazel` is on PATH. USE_BAZEL_VERSION pins the launcher, because the
# reference carries no .bazelversion of its own.
#
# Where no usable Bazel exists the script says so and stops without failing the
# pipeline. tools/cxx/conformance_test.cc re-expresses 25 of the 29 upstream
# cases against the same unmodified sources, and tools/12_check_mapping.py
# proves that mapping has no gaps.
set -uo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
. "${REPO_ROOT}/tools/env.sh"

ARCHIVE="${NOTES_DIR}/reference-test-run"

# Building the reference under Bazel pulls protobuf and its code generator, so a
# cold run takes several minutes. Set SKIP_REFERENCE_TESTS=1 while iterating on
# something else. Continuous integration never sets it.
if [[ "${SKIP_REFERENCE_TESTS:-0}" == "1" ]]; then
    echo "[07] SKIP_REFERENCE_TESTS=1, so the upstream suite is not run."
    echo "[07] The archived result in notes/reference-test-run/ still stands."
    exit 0
fi
: "${USE_BAZEL_VERSION:=${BAZEL_VERSION}}"
export USE_BAZEL_VERSION

BZL=""
for cand in "${HOME}/.local/bin/bazelisk" bazelisk bazel; do
    command -v "${cand}" > /dev/null 2>&1 && { BZL="${cand}"; break; }
done
if [[ -z "${BZL}" ]]; then
    echo "[07] no bazel and no bazelisk on PATH. Skipping the upstream suite."
    echo "[07] Install one with:"
    echo "[07]   curl -sSL -o ~/.local/bin/bazelisk \\"
    echo "[07]     https://github.com/bazelbuild/bazelisk/releases/download/v1.25.0/bazelisk-linux-amd64"
    echo "[07]   chmod +x ~/.local/bin/bazelisk"
    echo "[07] tools/05_conformance.sh and tools/12_check_mapping.py cover 25 of the 29."
    exit 0
fi

# A `bazel` that predates bzlmod cannot build this tree at all.
if [[ "$(basename "${BZL}")" == "bazel" ]]; then
    ver="$(cd "${DPF_DIR}" && bazel --batch version 2>/dev/null | awk '/^Build label:/{print $3}')"
    if [[ -z "${ver}" || "${ver%%.*}" -lt 7 ]]; then
        echo "[07] bazel ${ver:-unknown} predates bzlmod, and no bazelisk is installed."
        echo "[07] Skipping. tools/05_conformance.sh covers 25 of the 29 upstream cases."
        exit 0
    fi
fi

echo "[07] running the reference's own suite with ${BZL} (bazel ${USE_BAZEL_VERSION})"
mkdir -p "${ARCHIVE}"
cd "${DPF_DIR}"
# Keep the pinned checkout clean: the output base and the convenience symlinks
# both go outside the tree.
"${BZL}" --output_base="${WORK_DIR}/bazel-out" test \
    --symlink_prefix="${WORK_DIR}/bazel-sym/" \
    --test_output=summary --test_tag_filters=-benchmark \
    //pir/hashing/... 2>&1 | tee "${ARCHIVE}/bazel-test-console.txt"
status="${PIPESTATUS[0]}"

# Archive the per-test XML so the result is auditable without re-running.
find "${WORK_DIR}/bazel-out" -path '*pir/hashing*' \
     \( -name 'test.xml' -o -name 'test.log' \) 2>/dev/null |
while read -r f; do
    # bazel writes test.log read-only, so plain cp cannot overwrite last run's
    # copy. install sets the mode as it writes.
    install -m 644 "$f" "${ARCHIVE}/$(echo "$f" | sed 's|.*/pir/hashing/||; s|/|_|g')"
done

if [[ "${status}" -ne 0 ]]; then
    echo "[07] FATAL: the reference's own suite did not pass at the pin" >&2
    exit 1
fi
echo "[07] OK: archived to notes/reference-test-run/"
