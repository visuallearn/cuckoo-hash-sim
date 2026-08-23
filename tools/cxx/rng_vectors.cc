// Golden vectors for the one component with real divergence risk: how a raw
// mt19937_64 word becomes a hash-function index.
//
// pir/hashing/cuckoo_hash_table.cc:71 writes
//     hash_functions_[random_hash_function_(rng_)](...)
// where rng_ is a default-constructed std::mt19937_64 (so seed 5489) and
// random_hash_function_ is absl::uniform_int_distribution<int>(0, k-1). The
// mapping is an implementation detail of abseil, so it is captured here from
// the pinned abseil rather than restated from memory. tools/04_verify.py and
// docs/js/engine/* are checked against this file.
//
// The program also asserts a closed form of the mapping, read out of
// absl/random/uniform_int_distribution.h and absl/random/internal/
// fast_uniform_bits.h at 20240722.0:
//
//   bits = low 32 bits of one mt19937_64 word
//          (FastUniformBits<uint32_t> over a URBG whose range is the whole of
//           uint64_t takes the "simplified loop" path with one iteration and no
//           shift, so it is a plain narrowing cast)
//   if k is a power of two:  j = bits & (k-1)                 -- no rejection
//   else:                    j = floor(bits * k / 2^32),
//                            redrawing while (bits*k) mod 2^32 < 2^32 mod k
//
// unsigned_type is uint32_t, not uint64_t, because uniform_int_distribution<int>
// derives it from the digits of `unsigned int`. Getting that wrong changes every
// index, so the assert below is the point of this program.
#include <cinttypes>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <random>
#include <string>
#include <vector>

#include "absl/random/uniform_int_distribution.h"
#include "reference_wrap.h"

using cuckoo_tools::ShadowRng;
using cuckoo_tools::ShadowUrbg;

namespace {

// The closed form, written out independently of abseil.
int PredictIndex(int k, const std::vector<uint64_t>& raws, size_t* consumed) {
  const uint32_t R = static_cast<uint32_t>(k - 1);
  const uint32_t Lim = static_cast<uint32_t>(k);
  size_t i = 0;
  uint32_t bits = static_cast<uint32_t>(raws.at(i++));
  if ((R & Lim) == 0) {
    *consumed = i;
    return static_cast<int>(bits & R);
  }
  const uint32_t threshold = static_cast<uint32_t>((0x100000000ULL) % Lim);
  uint64_t product = static_cast<uint64_t>(bits) * Lim;
  while (static_cast<uint32_t>(product) < threshold) {
    bits = static_cast<uint32_t>(raws.at(i++));
    product = static_cast<uint64_t>(bits) * Lim;
  }
  *consumed = i;
  return static_cast<int>(product >> 32);
}

}  // namespace

int main(int argc, char** argv) {
  const int count = (argc > 1) ? std::atoi(argv[1]) : 10000;
  std::printf("# golden absl::uniform_int_distribution<int>(0,k-1) draws\n");
  std::printf("# generator: default-constructed std::mt19937_64 (seed 5489)\n");
  std::printf("# abseil: 20240722.0   compiler: %s\n",
#if defined(__GNUC__) && !defined(__clang__)
              "gcc " __VERSION__
#else
              "other"
#endif
  );
  std::printf("# columns: k index j nraw raw0 [raw1 ...]\n");

  // Independently confirm what the reference's own constructor computes: the
  // low 32 bits of the first word of the mt19937_64 stream at seed 5489.
  {
    std::mt19937_64 g;
    uint64_t first = g();
    std::printf("# mt19937_64(5489) first word: %" PRIu64 "\n", first);
    if (first != 14514284786278117030ULL) {
      std::fprintf(stderr, "FATAL: std::mt19937_64 default seed stream is not the "
                           "standard one (first word %" PRIu64 ")\n", first);
      return 1;
    }
  }

  int mismatches = 0;
  for (int k = 2; k <= 8; k++) {
    ShadowRng rng(k);
    for (int n = 0; n < count; n++) {
      cuckoo_tools::DrawRecord d = rng.Draw();
      size_t consumed = 0;
      int predicted = PredictIndex(k, d.raws, &consumed);
      if (predicted != d.j || consumed != d.raws.size()) {
        if (++mismatches < 10) {
          std::fprintf(stderr,
                       "MISMATCH k=%d n=%d: abseil j=%d over %zu word(s), "
                       "closed form j=%d over %zu word(s)\n",
                       k, n, d.j, d.raws.size(), predicted, consumed);
        }
      }
      std::printf("%d %d %d %zu", k, n, d.j, d.raws.size());
      for (uint64_t r : d.raws) std::printf(" %" PRIu64, r);
      std::printf("\n");
    }
  }
  if (mismatches) {
    std::fprintf(stderr, "FATAL: %d mismatch(es) between abseil and the closed form\n",
                 mismatches);
    return 1;
  }
  std::fprintf(stderr, "[rng_vectors] %d draws per k for k=2..8; closed form agrees everywhere\n",
               count);
  return 0;
}
