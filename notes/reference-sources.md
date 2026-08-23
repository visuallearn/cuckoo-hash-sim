# Archived reference sources

`reference-sources.tar.gz` holds the exact files the traces were recorded from. The pins name a commit and a release tarball, and both live on someone else's servers; this copy means the claims here stay checkable if either changes.

- **sha256** `84e1d62dd6f0435c2b2333802130d109625ccd2968dc5e468bbebb9705339236`
- **bytes** 31347
- **members** 35
- distributed_point_functions at `859cafa71fc1e139c7b76d4d4c0f23438688a8ad`, Apache 2.0
- abseil-cpp 20240722.0, Apache 2.0

Both licenses are inside the archive, with a NOTICE naming each project. The files are unmodified.

```sh
tar tzf notes/reference-sources.tar.gz
sha256sum notes/reference-sources.tar.gz
python3 tools/15_archive_pins.py --check   # rebuild and compare
```

## Why these files

The `pir/hashing/` module and its tests are the algorithm. The four `pir/cuckoo_hashing_*` files are the production wiring the site quotes. `MODULE.bazel` records the dependency versions the reference itself pins.

The four abseil headers are the load-bearing part. `uniform_int_distribution.h` and `fast_uniform_bits.h` decide how a Mersenne Twister word becomes a hash-function index, and that decision fixes the shape of every table on this site. `traits.h` is where the unsigned type turns out to be 32 bits wide, and `wide_multiply.h` is the multiply the mapping uses.

## Contents

```
NOTICE
distributed_point_functions/pir/hashing/BUILD
distributed_point_functions/pir/hashing/cuckoo_hash_table.h
distributed_point_functions/pir/hashing/cuckoo_hash_table.cc
distributed_point_functions/pir/hashing/hash_family.h
distributed_point_functions/pir/hashing/hash_family.cc
distributed_point_functions/pir/hashing/sha256_hash_family.h
distributed_point_functions/pir/hashing/sha256_hash_family.cc
distributed_point_functions/pir/hashing/multiple_choice_hash_table.h
distributed_point_functions/pir/hashing/multiple_choice_hash_table.cc
distributed_point_functions/pir/hashing/simple_hash_table.h
distributed_point_functions/pir/hashing/simple_hash_table.cc
distributed_point_functions/pir/hashing/farm_hash_family.h
distributed_point_functions/pir/hashing/farm_hash_family.cc
distributed_point_functions/pir/hashing/hash_family_config.h
distributed_point_functions/pir/hashing/hash_family_config.cc
distributed_point_functions/pir/hashing/hash_family_config.proto
distributed_point_functions/pir/hashing/cuckoo_hash_table_test.cc
distributed_point_functions/pir/hashing/multiple_choice_hash_table_test.cc
distributed_point_functions/pir/hashing/simple_hash_table_test.cc
distributed_point_functions/pir/hashing/sha256_hash_family_test.cc
distributed_point_functions/pir/hashing/hash_family_test.cc
distributed_point_functions/pir/hashing/farm_hash_family_test.cc
distributed_point_functions/pir/hashing/hash_family_config_test.cc
distributed_point_functions/pir/cuckoo_hashing_sparse_dpf_pir_server.h
distributed_point_functions/pir/cuckoo_hashing_sparse_dpf_pir_server.cc
distributed_point_functions/pir/cuckoo_hashed_dpf_pir_database.cc
distributed_point_functions/pir/cuckoo_hashing_sparse_dpf_pir_client.cc
distributed_point_functions/MODULE.bazel
distributed_point_functions/LICENSE
abseil-cpp/absl/random/uniform_int_distribution.h
abseil-cpp/absl/random/internal/fast_uniform_bits.h
abseil-cpp/absl/random/internal/traits.h
abseil-cpp/absl/random/internal/wide_multiply.h
abseil-cpp/LICENSE
```
