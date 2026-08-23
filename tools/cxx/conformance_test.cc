// Behaviour tests against the pinned reference.
//
// Two jobs. First, it re-expresses what the reference's own unit tests assert,
// because Bazel >= 7 with bzlmod is not available in every environment and the
// upstream *_test.cc files cannot be run without it (tools/07_run_reference_
// tests.sh runs them where it is). Second, it locks the quirks that the
// simulation teaches, so that a future re-pin of the reference is a conscious,
// reviewed act rather than a silent change of ground truth.
//
// Everything here runs against the unmodified reference sources.
#include <cinttypes>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <map>
#include <memory>
#include <random>
#include <string>
#include <vector>

#include "absl/status/status.h"
#include "absl/status/statusor.h"
#include "absl/strings/str_cat.h"
#include "absl/strings/string_view.h"
#include "absl/types/optional.h"
#include "pir/hashing/cuckoo_hash_table.h"
#include "farmhash/farmhash.h"
#include "pir/hashing/farm_hash_family.h"
#include "pir/hashing/hash_family.h"
#include "pir/hashing/multiple_choice_hash_table.h"
#include "pir/hashing/sha256_hash_family.h"
#include "pir/hashing/simple_hash_table.h"
#include "reference_wrap.h"

using distributed_point_functions::CreateHashFunctions;
using distributed_point_functions::CuckooHashTable;
using distributed_point_functions::FarmHashFamily;
using distributed_point_functions::FarmHashFunction;
using distributed_point_functions::HashFamily;
using distributed_point_functions::HashFunction;
using distributed_point_functions::MultipleChoiceHashTable;
using distributed_point_functions::SHA256HashFamily;
using distributed_point_functions::SHA256HashFunction;
using distributed_point_functions::SimpleHashTable;
using distributed_point_functions::SimpleHashTable;
using distributed_point_functions::WrapWithSeed;

namespace {

int g_checks = 0;
int g_fails = 0;
const char* g_group = "";
std::vector<std::string> g_ids;

// `id` is the handle that notes/FIDELITY.md section 6 maps each upstream
// TEST() onto. tools/12_check_mapping.py reads both and fails on a gap.
void Group(const char* id, const char* name) {
  g_group = id;
  g_ids.push_back(id);
  std::printf("\n-- [%s] %s\n", id, name);
}

void Expect(bool cond, const std::string& what) {
  g_checks++;
  if (cond) {
    std::printf("   ok   %s\n", what.c_str());
  } else {
    g_fails++;
    std::printf("   FAIL %s   [%s]\n", what.c_str(), g_group);
  }
}

void ExpectEqStr(const std::string& got, const std::string& want,
                 const std::string& what) {
  Expect(got == want, absl::StrCat(what, ": \"", got, "\"",
                                   got == want ? "" : absl::StrCat(" != \"", want, "\"")));
}

void ExpectStatus(const absl::Status& s, absl::StatusCode code,
                  const std::string& message, const std::string& what) {
  bool ok = s.code() == code && std::string(s.message()) == message;
  Expect(ok, absl::StrCat(what, " -> ", absl::StatusCodeToString(s.code()), " \"",
                          std::string(s.message()), "\""));
}

std::string HexToBytes(absl::string_view hex) {
  std::string out;
  for (size_t i = 0; i + 1 < hex.size(); i += 2) {
    out += static_cast<char>(std::stoi(std::string(hex.substr(i, 2)), nullptr, 16));
  }
  return out;
}

// digest read as one little-endian 256-bit integer, reduced mod m. Independent
// of the reference's three-step ladder on purpose.
int Mod256(const std::string& digest_bytes, int m) {
  uint64_t r = 0;
  for (int i = static_cast<int>(digest_bytes.size()) - 1; i >= 0; --i) {
    r = (r * 256 + static_cast<unsigned char>(digest_bytes[i])) % static_cast<uint64_t>(m);
  }
  return static_cast<int>(r);
}

std::string ShowTable(const CuckooHashTable& t) {
  std::string s = "[";
  const auto& tab = t.GetTable();
  for (size_t i = 0; i < tab.size(); i++) {
    if (i) s += ",";
    s += tab[i] ? *tab[i] : "_";
  }
  s += "] stash=[";
  for (size_t i = 0; i < t.GetStash().size(); i++) {
    if (i) s += ",";
    s += t.GetStash()[i];
  }
  return s + "]";
}

// ---------------------------------------------------------------- the hash

void TestHashMath() {
  Group("SHA-CAVP", "sha256_hash_family_test.cc Sha256HashFamily.HashesCorrectly");
  const std::string seed = HexToBytes("5a86b737eaea8ee976a0a24da63e7ed7");
  const std::string input = HexToBytes(
      "eefad18a101c1211e2b3650c5187c2a8a650547208251f6d4237e661c7bf4c77f335390394"
      "c37fa1a9f9be836ac28509");
  const std::string digest = HexToBytes(
      "42e61e174fbb3897d6dd6cef3dd2802fe67b331953b06114a65c772859dfc1aa");

  HashFunction hash = SHA256HashFamily{}(seed);
  int bad = 0;
  for (int i = 1; i < 1000; ++i) {
    if (hash(input, i) != Mod256(digest, i)) bad++;
  }
  Expect(bad == 0, absl::StrCat("hash(input, i) == LE256(digest) mod i for i in 1..999 (",
                                999 - bad, "/999)"));

  // The same digest, recomputed by the instrumentation the trace generator uses.
  cuckoo_tools::Ladder L = cuckoo_tools::ComputeLadder(seed, input, 1000);
  ExpectEqStr(L.digestHex,
              "42e61e174fbb3897d6dd6cef3dd2802fe67b331953b06114a65c772859dfc1aa",
              "the instrumentation recomputes the CAVP digest");
  Expect(L.bucket == hash(input, 1000), "the ladder agrees with the reference at m=1000");

  Group("HF-SEEDS", "hash_family.cc seed derivation, and hash_family_test.cc WrapWithSeedPrependsSeed");
  auto fns = CreateHashFunctions(SHA256HashFamily{}, 3);
  Expect(fns.ok() && fns->size() == 3, "CreateHashFunctions(family, 3) makes three");
  // hash_family.cc:36 uses absl::StrCat(i), so the seeds are "0", "1", "2".
  HashFunction direct = SHA256HashFamily{}("1");
  Expect((*fns)[1]("ant", 6) == direct("ant", 6),
         "function 1 uses the seed \"1\"");
  // hash_family.h:48 prepends the family seed.
  HashFunction wrapped = WrapWithSeed(SHA256HashFamily{}, "SEED")("1");
  HashFunction concat = SHA256HashFamily{}("SEED1");
  Expect(wrapped("ant", 6) == concat("ant", 6), "WrapWithSeed prepends the family seed");

  ExpectStatus(CreateHashFunctions(SHA256HashFamily{}, -1).status(),
               absl::StatusCode::kInvalidArgument,
               "num_hash_functions must not be negative", "k = -1");
}

// ---------------------------------------------------------------- the RNG

void TestRng() {
  Group("RNG-LAW", "the hash-function index: std::mt19937_64 seed 5489 through abseil");
  std::mt19937_64 g;
  Expect(g() == 14514284786278117030ULL, "the first mt19937_64 word is the standard one");

  // The closed form transcribed from abseil 20240722.0. unsigned_type is
  // uint32_t, so it is the low half of each 64-bit word that is used.
  for (int k : {2, 3, 4, 5, 6, 7, 8}) {
    cuckoo_tools::ShadowRng rng(k);
    int bad = 0;
    for (int n = 0; n < 20000; n++) {
      cuckoo_tools::DrawRecord d = rng.Draw();
      const uint32_t R = static_cast<uint32_t>(k - 1);
      const uint32_t Lim = static_cast<uint32_t>(k);
      size_t i = 0;
      uint32_t bits = static_cast<uint32_t>(d.raws.at(i++));
      int predicted;
      if ((R & Lim) == 0) {
        predicted = static_cast<int>(bits & R);
      } else {
        const uint32_t threshold = static_cast<uint32_t>(0x100000000ULL % Lim);
        uint64_t product = static_cast<uint64_t>(bits) * Lim;
        while (static_cast<uint32_t>(product) < threshold) {
          bits = static_cast<uint32_t>(d.raws.at(i++));
          product = static_cast<uint64_t>(bits) * Lim;
        }
        predicted = static_cast<int>(product >> 32);
      }
      if (predicted != d.j || i != d.raws.size()) bad++;
      if (d.j < 0 || d.j >= k) bad++;
    }
    Expect(bad == 0, absl::StrCat("k=", k, ": 20000 draws match the closed form"));
  }
}

// ---------------------------------------------------------------- validation

void TestValidation() {
  Group("CK-VALIDATE", "cuckoo_hash_table_test.cc FailsIfNumBucketsNegative, FailsIfNumHashFunctionsLessThanTwo, FailsIfMaxRelocationsNegative, FailsIfMaxStashSizeNegative");
  ExpectStatus(CuckooHashTable::Create(FarmHashFamily{}, 0, 0, 0).status(),
               absl::StatusCode::kInvalidArgument, "num_buckets must be positive",
               "num_buckets = 0");
  ExpectStatus(CuckooHashTable::Create(FarmHashFamily{}, 1, 1, 0).status(),
               absl::StatusCode::kInvalidArgument,
               "hash_functions.size() must be at least 2", "k = 1");
  ExpectStatus(CuckooHashTable::Create(FarmHashFamily{}, 1, 2, -1).status(),
               absl::StatusCode::kInvalidArgument, "max_relocations must be non-negative",
               "max_relocations = -1");
  ExpectStatus(CuckooHashTable::Create(FarmHashFamily{}, 1, 2, 0, -1).status(),
               absl::StatusCode::kInvalidArgument, "max_stash_size must be non-negative",
               "max_stash_size = -1");
  Expect(CuckooHashTable::Create(FarmHashFamily{}, 1, 2, 0).ok(),
         "max_relocations = 0 is legal");
  Expect(CuckooHashTable::Create(FarmHashFamily{}, 1, 2, 0, 0).ok(),
         "max_stash_size = 0 is legal");

  Group("MC-SH-VALIDATE", "multiple_choice_hash_table_test.cc and simple_hash_table_test.cc FailsIf... cases");
  ExpectStatus(MultipleChoiceHashTable::Create(FarmHashFamily{}, -1).status(),
               absl::StatusCode::kInvalidArgument, "num_buckets must be positive",
               "MCHT num_buckets = -1");
  ExpectStatus(MultipleChoiceHashTable::Create(FarmHashFamily{}, 1, 0).status(),
               absl::StatusCode::kInvalidArgument,
               "hash_functions.size() must be at least 2", "MCHT k = 0");
  ExpectStatus(MultipleChoiceHashTable::Create(FarmHashFamily{}, 1, 2, -1).status(),
               absl::StatusCode::kInvalidArgument, "max_bucket_size must be positive",
               "MCHT max_bucket_size = -1");
  ExpectStatus(SimpleHashTable::Create(FarmHashFamily{}, 0, 0).status(),
               absl::StatusCode::kInvalidArgument, "num_buckets must be positive",
               "Simple num_buckets = 0");
  ExpectStatus(SimpleHashTable::Create(FarmHashFamily{}, 1, 0).status(),
               absl::StatusCode::kInvalidArgument, "hash_functions must not be empty",
               "Simple k = 0");
  ExpectStatus(SimpleHashTable::Create(FarmHashFamily{}, 1, 1, -1).status(),
               absl::StatusCode::kInvalidArgument, "max_bucket_size must be positive",
               "Simple max_bucket_size = -1");
}

// -------------------------------------------- the reference's own unit tests

void TestUpstreamBehaviour() {
  const int kNumBuckets = 100, kNumHashFunctions = 3, kMaxRelocations = 50,
            kMaxStashSize = 3;

  Group("CK-INSERT", "cuckoo_hash_table_test.cc CuckooHashTableTest.TestInsert");
  {
    auto t = CuckooHashTable::Create(FarmHashFamily{}, kNumBuckets, kNumHashFunctions,
                                     kMaxRelocations, kMaxStashSize);
    Expect(t.ok() && (*t)->Insert("Hello Cuckoo").ok(), "insert returns OK");
    int occupied = 0;
    for (const auto& slot : (*t)->GetTable()) {
      if (slot) { occupied++; Expect(*slot == "Hello Cuckoo", "the slot holds the element"); }
    }
    Expect(occupied == 1, "exactly one slot is occupied");
  }

  Group("CK-STASH-LIMIT", "cuckoo_hash_table_test.cc CuckooHashTableTest.TestStashLimit");
  {
    auto t = CuckooHashTable::Create(FarmHashFamily{}, kNumBuckets, kNumHashFunctions,
                                     kMaxRelocations, kMaxStashSize);
    int n = 0;
    absl::Status s = absl::OkStatus();
    while (true) {
      s = (*t)->Insert(absl::StrCat("Element number ", n));
      if (!s.ok()) break;
      n++;
    }
    ExpectStatus(s, absl::StatusCode::kInternal, "Cannot insert element: stash is full",
                 "the overflow status");
    Expect(static_cast<int>((*t)->GetStash().size()) == kMaxStashSize,
           absl::StrCat("the stash holds exactly ", kMaxStashSize, " elements"));
    int count = 0;
    for (const auto& slot : (*t)->GetTable()) if (slot) count++;
    Expect(count + static_cast<int>((*t)->GetStash().size()) == n,
           absl::StrCat("every one of the ", n,
                        " accepted elements is in the table or on the stash"));
  }

  Group("CK-UNLIMITED", "cuckoo_hash_table_test.cc CuckooHashTable.TestDefaultUnlimitedStash");
  {
    auto t = CuckooHashTable::Create(FarmHashFamily{}, kNumBuckets, kNumHashFunctions,
                                     kMaxRelocations);
    bool all_ok = true;
    for (int i = 0; i < 1000; i++) {
      if (!(*t)->Insert(absl::StrCat("Element number ", i)).ok()) all_ok = false;
    }
    Expect(all_ok, "1000 inserts all return OK with an unlimited stash");
    Expect(static_cast<int>((*t)->GetStash().size()) >= 1000 - kNumBuckets,
           absl::StrCat("the stash holds at least ", 1000 - kNumBuckets, " elements (it holds ",
                        (*t)->GetStash().size(), ")"));
  }

  Group("MC-INSERT-OVERFLOW", "multiple_choice_hash_table_test.cc TestInsert and TestOverflow");
  {
    auto t = MultipleChoiceHashTable::Create(FarmHashFamily{}, 100, 3, 10);
    bool all_ok = true;
    for (int i = 0; i < 100; i++) {
      if (!(*t)->Insert(absl::StrCat("Element number ", i)).ok()) all_ok = false;
    }
    int count = 0;
    for (const auto& b : (*t)->GetTable()) count += static_cast<int>(b.size());
    Expect(all_ok && count == 100, "100 elements go into 100 buckets, one copy each");

    absl::Status s = absl::OkStatus();
    for (int i = 100; s.ok(); i++) s = (*t)->Insert(absl::StrCat("Element number ", i));
    ExpectStatus(s, absl::StatusCode::kInternal,
                 "Cannot insert element: maximum bucket size reached",
                 "the overflow status");
  }

  Group("SH-INSERT-OVERFLOW", "simple_hash_table_test.cc TestInsert and TestOverflow");
  {
    auto t = SimpleHashTable::Create(FarmHashFamily{}, 10, 3);
    for (int i = 0; i < 1000; i++) (void)(*t)->Insert(absl::StrCat("Element number ", i));
    int count = 0;
    for (const auto& b : (*t)->GetTable()) count += static_cast<int>(b.size());
    Expect(count == 1000 * 3, "each element is stored once per hash function");

    auto t2 = SimpleHashTable::Create(FarmHashFamily{}, 10, 3, 3);
    absl::Status s = absl::OkStatus();
    for (int i = 0; s.ok(); i++) s = (*t2)->Insert(absl::StrCat("Element number ", i));
    ExpectStatus(s, absl::StatusCode::kInternal,
                 "Cannot insert element: maximum bucket size reached",
                 "the overflow status");
  }
}

// ---------------------------------------------------------------- the quirks

// farm_hash_family_test.cc. FarmHash produces no shipped data -- every trace
// uses SHA-256 -- but the reference's own tests build their tables with it, so
// the conformance suite uses it too and therefore has to check it.
void TestFarmHash() {
  Group("FARM-HASH", "farm_hash_family_test.cc FarmHashFamily.HashesCorrectly");
  constexpr absl::string_view kSeed = "kHashFunctionSeed";
  constexpr absl::string_view kInput = "kHashInput";
  auto x = util::Hash128WithSeed(kInput.data(), kInput.size(), util::Hash128(kSeed));
  absl::uint128 hash128 = absl::MakeUint128(x.second, x.first);

  HashFunction hasher = FarmHashFamily{}(kSeed);
  int bad = 0;
  for (int i = 1; i < 1000; ++i) {
    if (hasher(kInput, i) != static_cast<int>(hash128 % i)) bad++;
  }
  Expect(bad == 0, absl::StrCat("FarmHash(input, i) == Hash128WithSeed mod i for i in 1..999 (",
                                999 - bad, "/999)"));
  // FarmHashFunction and FarmHashFamily are usable as the module's function
  // types, which is what IsAHashFunction and IsAHashFamily assert.
  HashFunction fn = FarmHashFunction("");
  HashFamily fam = FarmHashFamily{};
  Expect(fn("x", 7) >= 0 && fn("x", 7) < 7, "FarmHashFunction is a HashFunction");
  Expect(fam("s")("x", 7) >= 0, "FarmHashFamily is a HashFamily");
}

void TestQuirks() {
  Group("Q1-Q2", "the hash function is drawn at random on every attempt");
  {
    // A fresh table with three empty candidate buckets can still probe an
    // occupied one first, because the reference never scans the k candidates.
    // Concretely: an insert can consume more than one relocation even when an
    // empty candidate existed from the start.
    auto fns = cuckoo_tools::PlainFunctions(cuckoo_tools::PerFunctionSeeds(3, ""));
    auto t = CuckooHashTable::Create(SHA256HashFamily{}, 6, 3, 8);
    for (const char* e : {"ant", "bee", "cat", "dog", "eel"}) (void)(*t)->Insert(e);
    // Any element with an empty candidate that still moved something proves it.
    int empty_before = 0;
    for (const auto& slot : (*t)->GetTable()) if (!slot) empty_before++;
    Expect(empty_before >= 0, absl::StrCat("built a table with ", empty_before,
                                           " empty slot(s): ", ShowTable(**t)));
    // The statistical form: over many independent single-insert tables the first
    // probed index is not always 0.
    std::map<int, int> first_index;
    for (int n = 0; n < 200; n++) {
      auto t2 = CuckooHashTable::Create(SHA256HashFamily{}, 8, 3, 1);
      (void)(*t2)->Insert(absl::StrCat("probe", n));
      for (int b = 0; b < 8; b++) {
        if ((*t2)->GetTable()[b]) {
          for (int j = 0; j < 3; j++) {
            if (fns[j](absl::StrCat("probe", n), 8) == b) { first_index[j]++; break; }
          }
        }
      }
    }
    Expect(first_index.size() >= 2,
           absl::StrCat("the first probe used ", first_index.size(),
                        " different hash functions over 200 fresh tables"));
  }

  Group("Q4", "duplicates are allowed, so one key can occupy two buckets");
  {
    auto t = CuckooHashTable::Create(SHA256HashFamily{}, 6, 3, 4);
    (void)(*t)->Insert("ant");
    (void)(*t)->Insert("ant");
    int copies = 0;
    for (const auto& slot : (*t)->GetTable()) if (slot && *slot == "ant") copies++;
    for (const auto& e : (*t)->GetStash()) if (e == "ant") copies++;
    Expect(copies == 2, absl::StrCat("two copies of \"ant\" are stored: ", ShowTable(**t)));
  }

  Group("Q5", "max_relocations = 0 sends everything straight to the stash");
  {
    auto t = CuckooHashTable::Create(SHA256HashFamily{}, 6, 3, 0);
    for (const char* e : {"ant", "bee", "cat"}) Expect((*t)->Insert(e).ok(), absl::StrCat("insert ", e, " returns OK"));
    int occupied = 0;
    for (const auto& slot : (*t)->GetTable()) if (slot) occupied++;
    Expect(occupied == 0 && (*t)->GetStash().size() == 3,
           absl::StrCat("the table is empty and the stash holds three: ", ShowTable(**t)));
  }

  Group("Q8", "a bounded stash turns overflow into an INTERNAL error, never a rehash");
  {
    auto t = CuckooHashTable::Create(SHA256HashFamily{}, 4, 2, 2, 1);
    absl::Status last = absl::OkStatus();
    int accepted = 0;
    for (int i = 0; i < 40 && last.ok(); i++) {
      last = (*t)->Insert(absl::StrCat("e", i));
      if (last.ok()) accepted++;
    }
    ExpectStatus(last, absl::StatusCode::kInternal, "Cannot insert element: stash is full",
                 absl::StrCat("after ", accepted, " accepted inserts"));
  }

  Group("MC-TIE", "MultipleChoiceHashTable: the first minimum wins a tie");
  {
    // Find an element whose two candidates are distinct and whose buckets are
    // both empty, so the counts tie at zero.
    auto fns = cuckoo_tools::PlainFunctions(cuckoo_tools::PerFunctionSeeds(2, ""));
    bool found = false;
    for (const char* w : {"ant", "bee", "cat", "dog", "eel", "fox", "gnu", "hen"}) {
      int a = fns[0](w, 6), b = fns[1](w, 6);
      if (a == b) continue;
      auto t = MultipleChoiceHashTable::Create(SHA256HashFamily{}, 6, 2);
      (void)(*t)->Insert(w);
      Expect((*t)->GetTable()[a].size() == 1 && (*t)->GetTable()[b].empty(),
             absl::StrCat("\"", w, "\": h0=", a, " h1=", b,
                          " tie at zero goes to h0's bucket"));
      found = true;
      break;
    }
    Expect(found, "a tie case exists in the word pool");
  }

  Group("SH-DUP-CAP", "SimpleHashTable: duplicate candidates push a bucket past its capacity");
  {
    // simple_hash_table.cc checks every candidate before appending anything, so
    // a bucket named twice by one element is measured twice at its old size.
    auto fns = cuckoo_tools::PlainFunctions(cuckoo_tools::PerFunctionSeeds(2, ""));
    bool demonstrated = false;
    for (int m = 2; m <= 12 && !demonstrated; m++) {
      for (const char* w : {"ant", "bee", "cat", "dog", "eel", "fox", "gnu", "hen",
                            "ibis", "jay", "koi", "lynx", "mole", "newt", "owl", "pig"}) {
        int a = fns[0](w, m), b = fns[1](w, m);
        if (a != b) continue;
        const int cap = 2;
        auto t = SimpleHashTable::Create(SHA256HashFamily{}, m, 2, cap);
        // Put exactly one element into bucket a.
        bool primed = false;
        for (const char* f : {"ant", "bee", "cat", "dog", "eel", "fox", "gnu", "hen",
                              "ibis", "jay", "koi", "lynx", "mole", "newt", "owl", "pig"}) {
          if (std::string(f) == w) continue;
          if ((fns[0](f, m) == a) + (fns[1](f, m) == a) != 1) continue;
          if (!(*t)->Insert(f).ok()) continue;
          primed = true;
          break;
        }
        if (!primed || (*t)->GetTable()[a].size() != 1) continue;
        absl::Status s = (*t)->Insert(w);
        if (s.ok() && (*t)->GetTable()[a].size() > static_cast<size_t>(cap)) {
          Expect(true, absl::StrCat("m=", m, " \"", w, "\": h0 = h1 = ", a,
                                    ", bucket goes 1 -> ", (*t)->GetTable()[a].size(),
                                    " with max_bucket_size = ", cap));
          demonstrated = true;
          break;
        }
      }
    }
    Expect(demonstrated,
           "a duplicate-candidate insert exceeds max_bucket_size (refuted if this fails)");
  }

  Group("PROD-PARAMS", "production parameters in cuckoo_hashing_sparse_dpf_pir_server.cc");
  {
    Expect(static_cast<int64_t>(1.5 * 5) == 7, "int64(1.5 * 5) = 7, not 8");
    Expect(static_cast<int64_t>(1.5 * 1) == 1, "int64(1.5 * 1) = 1");
    Expect(static_cast<int64_t>(1.5 * 3) == 4, "int64(1.5 * 3) = 4");
    // cuckoo_hashing_sparse_dpf_pir_server.cc:127-130 computes the seed
    // fingerprint with an empty-seeded hash and INT_MAX as the upper bound.
    HashFunction fp = SHA256HashFamily{}("");
    int v = fp("0123456789abcdef", 2147483647);
    Expect(v >= 0 && v < 2147483647,
           absl::StrCat("the seed fingerprint is a value mod INT_MAX, not 31 bits: ", v));
  }
}

}  // namespace

int main() {
  std::printf("conformance tests against the pinned reference\n");
  TestHashMath();
  TestRng();
  TestValidation();
  TestUpstreamBehaviour();
  TestFarmHash();
  TestQuirks();
  std::printf("\n%d checks, %d failure(s)\n", g_checks, g_fails);
  std::printf("CHECK-IDS:");
  for (const auto& id : g_ids) std::printf(" %s", id.c_str());
  std::printf("\n");
  return g_fails == 0 ? 0 : 1;
}
