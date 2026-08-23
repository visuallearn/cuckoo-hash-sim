// Instrumentation that wraps the *unmodified* reference implementation.
//
// The reference needs no patching: CuckooHashTable::Create accepts an injected
// std::vector<HashFunction>, and GetTable()/GetStash() are public. So everything
// here is decoration from the outside. Nothing in pir/hashing/ is edited, and
// the objects under test are the real ones.
//
// Three shadows make every generated file self-checked:
//   * the hash wrapper recomputes the digest and the division ladder itself and
//     asserts its own bucket equals the value the real hash function returned;
//   * a shadow mt19937_64 + absl::uniform_int_distribution runs in lock step
//     with the private rng_ inside the table and asserts it predicts the same
//     hash-function index;
//   * a shadow table replays place/swap and is compared against GetTable() and
//     GetStash() after every Insert.
// Any disagreement aborts. The failure mode is "no data", never "wrong data".
#ifndef CUCKOO_TOOLS_REFERENCE_WRAP_H_
#define CUCKOO_TOOLS_REFERENCE_WRAP_H_

#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <algorithm>
#include <random>
#include <sstream>
#include <string>
#include <vector>

#include "absl/numeric/int128.h"
#include "absl/random/uniform_int_distribution.h"
#include "absl/strings/str_cat.h"
#include "absl/strings/string_view.h"
#include "openssl/sha.h"
#include "pir/hashing/hash_family.h"
#include "pir/hashing/sha256_hash_family.h"

namespace cuckoo_tools {

#define CK_CHECK(cond, ...)                                              \
  do {                                                                   \
    if (!(cond)) {                                                       \
      std::fprintf(stderr, "FATAL %s:%d: %s\n  ", __FILE__, __LINE__, #cond); \
      std::fprintf(stderr, __VA_ARGS__);                                 \
      std::fprintf(stderr, "\n");                                        \
      std::abort();                                                      \
    }                                                                    \
  } while (0)

// ------------------------------------------------------------------ formatting

inline std::string ToHex(absl::string_view s) {
  static const char* kD = "0123456789abcdef";
  std::string out;
  out.reserve(s.size() * 2);
  for (unsigned char c : s) { out += kD[c >> 4]; out += kD[c & 0xf]; }
  return out;
}

inline std::string U128Dec(absl::uint128 v) {
  std::ostringstream os;
  os << v;
  return os.str();
}

inline std::string U64Hex(uint64_t v) {
  char buf[32];
  std::snprintf(buf, sizeof(buf), "%016llx", static_cast<unsigned long long>(v));
  return std::string(buf);
}

inline std::string U128Hex(absl::uint128 v) {
  return "0x" + U64Hex(absl::Uint128High64(v)) + U64Hex(absl::Uint128Low64(v));
}

// ------------------------------------------------------------------ hash math

// Every intermediate value of SHA256HashFunction::operator(), recomputed here so
// the trace can show the arithmetic. `bucket` is asserted against the real
// function's return value by the caller.
struct Ladder {
  std::string digestHex;      // the 32 bytes, in memory order
  std::string loHex, hiHex;   // the two absl::uint128 halves
  std::string nDec;           // the whole digest read as one 256-bit LE integer
  int r1 = 0;
  std::string d2Dec, d2Hex;
  int r2 = 0;
  std::string d3Dec, d3Hex;
  int r3 = 0;
  int bucket = 0;
};

// Decimal of hi*2^128 + lo, by long multiplication on a decimal digit vector.
// Only used for display, so clarity beats speed.
inline std::string U256Dec(absl::uint128 hi, absl::uint128 lo) {
  std::vector<uint8_t> d{0};  // little-endian decimal digits
  auto mul_add = [&d](uint32_t mul, uint32_t add) {
    uint32_t carry = add;
    for (size_t i = 0; i < d.size(); i++) {
      uint32_t v = d[i] * mul + carry;
      d[i] = static_cast<uint8_t>(v % 10);
      carry = v / 10;
    }
    while (carry) { d.push_back(static_cast<uint8_t>(carry % 10)); carry /= 10; }
  };
  // Feed the 256-bit value in 8-bit chunks, most significant first.
  for (int i = 15; i >= 0; --i) mul_add(256, static_cast<uint32_t>((hi >> (8 * i)) & 0xff));
  for (int i = 15; i >= 0; --i) mul_add(256, static_cast<uint32_t>((lo >> (8 * i)) & 0xff));
  std::string out;
  for (auto it = d.rbegin(); it != d.rend(); ++it) out += static_cast<char>('0' + *it);
  return out;
}

// Mirrors pir/hashing/sha256_hash_family.cc lines 59-87 statement for statement.
inline Ladder ComputeLadder(absl::string_view seed, absl::string_view input,
                            int upper_bound) {
  CK_CHECK(upper_bound > 0, "upper_bound=%d", upper_bound);
  SHA256_CTX ctx;
  SHA256_Init(&ctx);
  SHA256_Update(&ctx, seed.data(), seed.size());
  SHA256_Update(&ctx, input.data(), input.size());
  char hash[SHA256_DIGEST_LENGTH];
  SHA256_Final(reinterpret_cast<unsigned char*>(hash), &ctx);

  // The reference copies raw bytes into two absl::uint128. Do exactly that, then
  // rebuild the same values arithmetically and compare: the assert is what turns
  // "we assume the host is little-endian" into a checked fact.
  absl::uint128 hi, lo;
  constexpr size_t hi_offset = 16;
  std::copy(reinterpret_cast<unsigned char*>(&hash[hi_offset]),
            reinterpret_cast<unsigned char*>(&hash[hi_offset]) + hi_offset,
            reinterpret_cast<unsigned char*>(&hi));
  std::copy(reinterpret_cast<unsigned char*>(&hash[0]),
            reinterpret_cast<unsigned char*>(&hash[0]) + hi_offset,
            reinterpret_cast<unsigned char*>(&lo));

  absl::uint128 lo_le = 0, hi_le = 0;
  for (int i = 15; i >= 0; --i) {
    lo_le = (lo_le << 8) | static_cast<unsigned char>(hash[i]);
    hi_le = (hi_le << 8) | static_cast<unsigned char>(hash[16 + i]);
  }
  CK_CHECK(lo == lo_le && hi == hi_le,
           "absl::uint128 memory layout is not little-endian on this host; "
           "the reference's std::copy would produce different buckets here");

  absl::uint128 dividend1 = hi;
  auto remainder1 = static_cast<uint64_t>(dividend1 % upper_bound);
  absl::uint128 dividend2 = absl::MakeUint128(remainder1, absl::Uint128High64(lo));
  auto remainder2 = static_cast<uint64_t>(dividend2 % upper_bound);
  absl::uint128 dividend3 = absl::MakeUint128(remainder2, absl::Uint128Low64(lo));
  auto remainder3 = static_cast<uint64_t>(dividend3 % upper_bound);

  Ladder L;
  L.digestHex = ToHex(absl::string_view(hash, SHA256_DIGEST_LENGTH));
  L.loHex = U128Hex(lo);
  L.hiHex = U128Hex(hi);
  L.nDec = U256Dec(hi, lo);
  L.r1 = static_cast<int>(remainder1);
  L.d2Dec = U128Dec(dividend2);
  L.d2Hex = U128Hex(dividend2);
  L.r2 = static_cast<int>(remainder2);
  L.d3Dec = U128Dec(dividend3);
  L.d3Hex = U128Hex(dividend3);
  L.r3 = static_cast<int>(remainder3);
  L.bucket = static_cast<int>(remainder3);
  return L;
}

// ------------------------------------------------------------------ shadow RNG

// A std::mt19937_64 that records every word it hands out. Its min()/max() match
// std::mt19937_64 exactly, so absl::FastUniformBits takes the identical code
// path and the mapping to a hash-function index is the reference's mapping.
struct ShadowUrbg {
  using result_type = std::mt19937_64::result_type;
  static constexpr result_type(min)() { return (std::mt19937_64::min)(); }
  static constexpr result_type(max)() { return (std::mt19937_64::max)(); }
  result_type operator()() {
    result_type v = g();
    raws.push_back(v);
    return v;
  }
  std::mt19937_64 g;  // default-constructed, so seed 5489, exactly as the table
  std::vector<result_type> raws;
};

struct DrawRecord {
  std::vector<uint64_t> raws;  // every word consumed, including rejected ones
  int j = 0;
};

class ShadowRng {
 public:
  explicit ShadowRng(int k) : dist_(0, k - 1) {}
  DrawRecord Draw() {
    urbg_.raws.clear();
    DrawRecord r;
    r.j = dist_(urbg_);
    r.raws = urbg_.raws;
    return r;
  }

 private:
  ShadowUrbg urbg_;
  absl::uniform_int_distribution<int> dist_;
};

// ------------------------------------------------------------------ seeds

// hash_family.cc:36 -- the per-function seed is the ASCII decimal index.
// hash_family.h:48  -- WrapWithSeed prepends a session seed to each of those.
inline std::vector<std::string> PerFunctionSeeds(int k, absl::string_view family_seed) {
  std::vector<std::string> out;
  out.reserve(k);
  for (int i = 0; i < k; i++) out.push_back(absl::StrCat(family_seed, i));
  return out;
}

inline std::vector<distributed_point_functions::HashFunction> PlainFunctions(
    const std::vector<std::string>& seeds) {
  std::vector<distributed_point_functions::HashFunction> out;
  out.reserve(seeds.size());
  for (const auto& s : seeds) {
    out.push_back(distributed_point_functions::SHA256HashFamily{}(s));
  }
  return out;
}

}  // namespace cuckoo_tools

#endif  // CUCKOO_TOOLS_REFERENCE_WRAP_H_
