# Build the reference's hashing module, unmodified, plus the harnesses that
# record traces from it.
#
# Bazel >= 7 with bzlmod is the reference's own build system. Where that is not
# available this shim compiles the same six translation units against abseil at
# the version MODULE.bazel pins, and OpenSSL's SHA-256 in place of BoringSSL's.
# The two provide the same SHA256_Init/Update/Final API and the same digest, and
# tools/cxx/conformance_test.cc checks the digest against a NIST CAVP vector.
cmake_minimum_required(VERSION 3.16)
project(cuckoo_reference_harness CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
if(NOT CMAKE_BUILD_TYPE)
  set(CMAKE_BUILD_TYPE Release)
endif()

find_package(absl REQUIRED)
find_package(OpenSSL REQUIRED)

if(NOT DEFINED DPF_DIR)
  message(FATAL_ERROR "pass -DDPF_DIR=<path to the pinned reference checkout>")
endif()
if(NOT DEFINED FARMHASH_DIR)
  message(FATAL_ERROR "pass -DFARMHASH_DIR=<path to the farmhash sources>")
endif()

# farm_hash_family.h includes "farmhash/farmhash.h", so the include root is the
# directory that contains the farmhash/ directory.
add_library(farmhash STATIC "${FARMHASH_DIR}/farmhash.cc")
target_include_directories(farmhash PUBLIC "${WORK_DIR}")
set_source_files_properties("${FARMHASH_DIR}/farmhash.cc" PROPERTIES COMPILE_OPTIONS "-w")

# Exactly the reference's own sources. Nothing here is generated or edited.
add_library(pir_hashing STATIC
  "${DPF_DIR}/pir/hashing/hash_family.cc"
  "${DPF_DIR}/pir/hashing/sha256_hash_family.cc"
  "${DPF_DIR}/pir/hashing/cuckoo_hash_table.cc"
  "${DPF_DIR}/pir/hashing/multiple_choice_hash_table.cc"
  "${DPF_DIR}/pir/hashing/simple_hash_table.cc"
  "${DPF_DIR}/pir/hashing/farm_hash_family.cc"
)
target_include_directories(pir_hashing PUBLIC "${DPF_DIR}" "${WORK_DIR}")
# OpenSSL 3 marks SHA256_Init/Update/Final deprecated. The reference calls them,
# and BoringSSL does not deprecate them, so the warning says nothing about this
# code and would bury a real one.
target_compile_options(pir_hashing PUBLIC -Wno-deprecated-declarations)
target_link_libraries(pir_hashing PUBLIC
  farmhash
  OpenSSL::Crypto
  absl::any_invocable
  absl::memory
  absl::optional
  absl::span
  absl::status
  absl::statusor
  absl::strings
  absl::str_format
  absl::int128
  absl::random_distributions
)

foreach(prog explore trace_gen conformance_test rng_vectors)
  add_executable(${prog} "${CMAKE_CURRENT_SOURCE_DIR}/${prog}.cc")
  target_link_libraries(${prog} PRIVATE pir_hashing)
  target_include_directories(${prog} PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}")
endforeach()
