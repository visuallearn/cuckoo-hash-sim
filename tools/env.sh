# Shared configuration for the trace-generation pipeline. Sourced, not executed.
# Single place where every pinned version lives. A moved pin is a hard failure,
# never a silent change of ground truth.

# --- the reference implementation ------------------------------------------
DPF_URL="https://github.com/google/distributed_point_functions.git"
# The repository publishes no tags for this tree, so the commit is the pin.
DPF_COMMIT="859cafa71fc1e139c7b76d4d4c0f23438688a8ad"

# --- the versions the reference itself pins, read from its MODULE.bazel -----
# tools/00_fetch_reference.sh asserts these against the fetched MODULE.bazel.
ABSL_VERSION="20240722.0"
ABSL_SHA256="f50e5ac311a81382da7fa75b97310e4b9006474f9560ac46f54a9967f07d4ae3"
BORINGSSL_VERSION="0.20240930.0"
PROTOBUF_VERSION="29.1"
GOOGLETEST_VERSION="1.15.2"

# The reference carries no .bazelversion, so tools/07_run_reference_tests.sh
# pins the launcher here. 7.4.1 is the release current when the reference was
# pinned; a newer Bazel may change bzlmod resolution.
BAZEL_VERSION="7.4.1"

# FarmHash, used by the reference's own unit tests. The commit and archive hash
# come from the reference's MODULE.bazel http_archive rule.
FARMHASH_COMMIT="0d859a811870d10f53a594927d0d0b97573ad06d"
FARMHASH_SHA256="470e87745d1393cc2793f49e9bfbd2c2cf282feeeb0c367f697996fa7e664fc5"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK_DIR="${REPO_ROOT}/.work"
DPF_DIR="${WORK_DIR}/dpf"
ABSL_SRC="${WORK_DIR}/absl-src"
ABSL_BUILD="${WORK_DIR}/absl-build"
ABSL_PREFIX="${WORK_DIR}/absl-install"
FARMHASH_DIR="${WORK_DIR}/farmhash"
CXX_BUILD="${WORK_DIR}/build"

DATA_DIR="${REPO_ROOT}/docs/data"
TRACE_DIR="${DATA_DIR}/traces"
SOURCE_DIR="${DATA_DIR}/source"
NOTES_DIR="${REPO_ROOT}/notes"

# The eight files of the reference module that this project treats as ground
# truth. Their sha256 sums are recorded in notes/pins.json.
HASHING_REL="pir/hashing"
HASHING_FILES=(
  cuckoo_hash_table.h cuckoo_hash_table.cc
  hash_family.h hash_family.cc
  sha256_hash_family.h sha256_hash_family.cc
  multiple_choice_hash_table.h multiple_choice_hash_table.cc
  simple_hash_table.h simple_hash_table.cc
  farm_hash_family.h farm_hash_family.cc
  hash_family_config.h hash_family_config.cc hash_family_config.proto
  cuckoo_hash_table_test.cc multiple_choice_hash_table_test.cc
  simple_hash_table_test.cc sha256_hash_family_test.cc hash_family_test.cc
)
# Files that show how production wires the table up.
PROD_FILES=(
  pir/cuckoo_hashing_sparse_dpf_pir_server.h
  pir/cuckoo_hashing_sparse_dpf_pir_server.cc
  pir/cuckoo_hashed_dpf_pir_database.cc
  pir/cuckoo_hashing_sparse_dpf_pir_client.cc
)

JOBS="${JOBS:-$(nproc)}"
