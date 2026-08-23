// Phase 0. Run the reference and look at what it does, before any simulator
// work starts. The output is archived in notes/explore-output.txt and every
// claim in notes/FIDELITY.md is answered from it.
//
// This program links the unmodified reference. It patches nothing and mocks
// nothing.
#include <cstdio>
#include <memory>
#include <string>
#include <vector>

#include "absl/status/status.h"
#include "absl/status/statusor.h"
#include "absl/strings/str_cat.h"
#include "absl/types/optional.h"
#include "pir/hashing/cuckoo_hash_table.h"
#include "pir/hashing/multiple_choice_hash_table.h"
#include "pir/hashing/sha256_hash_family.h"
#include "pir/hashing/simple_hash_table.h"
#include "reference_wrap.h"

using distributed_point_functions::CuckooHashTable;
using distributed_point_functions::HashFunction;
using distributed_point_functions::MultipleChoiceHashTable;
using distributed_point_functions::SHA256HashFamily;
using distributed_point_functions::SimpleHashTable;

namespace {

const std::vector<std::string> kPool = {
    "ant", "bee", "cat", "dog", "eel", "fox", "gnu", "hen",
    "ibis", "jay", "koi", "lynx", "mole", "newt", "owl", "pig"};

void Rule(const char* title) {
  std::printf("\n================ %s ================\n", title);
}

std::string ShowTable(const CuckooHashTable& t) {
  std::string s = "[";
  const auto& tab = t.GetTable();
  for (size_t i = 0; i < tab.size(); i++) {
    if (i) s += ", ";
    s += tab[i] ? *tab[i] : "_";
  }
  s += "]  stash=[";
  const auto& st = t.GetStash();
  for (size_t i = 0; i < st.size(); i++) { if (i) s += ", "; s += st[i]; }
  return s + "]";
}

std::string ShowBuckets(const std::vector<std::vector<std::string>>& tab) {
  std::string s;
  for (size_t i = 0; i < tab.size(); i++) {
    s += absl::StrCat(i, ":{");
    for (size_t j = 0; j < tab[i].size(); j++) { if (j) s += ","; s += tab[i][j]; }
    s += "} ";
  }
  return s;
}

void RunCuckoo(int m, int k, int budget, absl::optional<int> stash,
               const std::vector<std::string>& elems) {
  auto r = CuckooHashTable::Create(SHA256HashFamily{}, m, k, budget, stash);
  if (!r.ok()) {
    std::printf("  Create failed: %s\n", std::string(r.status().message()).c_str());
    return;
  }
  auto& t = **r;
  std::printf("  m=%d k=%d budget=%d stash=%s\n", m, k, budget,
              stash ? std::to_string(*stash).c_str() : "unlimited");
  for (const auto& e : elems) {
    absl::Status s = t.Insert(e);
    std::printf("    insert %-5s %-9s %s\n", e.c_str(),
                s.ok() ? "OK" : absl::StatusCodeToString(s.code()).c_str(),
                ShowTable(t).c_str());
    if (!s.ok()) std::printf("      message: \"%s\"\n", std::string(s.message()).c_str());
  }
}

}  // namespace

int main() {
  // ---------------------------------------------------------------- hash table
  Rule("1. h_j(x) for the classroom word pool, m = 6, k = 3, bare family");
  {
    auto seeds = cuckoo_tools::PerFunctionSeeds(3, "");
    auto fns = cuckoo_tools::PlainFunctions(seeds);
    std::printf("  seeds: \"%s\" \"%s\" \"%s\"\n", seeds[0].c_str(), seeds[1].c_str(),
                seeds[2].c_str());
    std::printf("  %-6s %5s %5s %5s   distinct\n", "word", "h0", "h1", "h2");
    for (const auto& w : kPool) {
      int a = fns[0](w, 6), b = fns[1](w, 6), c = fns[2](w, 6);
      int distinct = 1 + (b != a) + (c != a && c != b);
      std::printf("  %-6s %5d %5d %5d   %d\n", w.c_str(), a, b, c, distinct);
    }
  }

  Rule("2. the whole ladder for h_0(\"ant\") mod 6");
  {
    cuckoo_tools::Ladder L = cuckoo_tools::ComputeLadder("0", "ant", 6);
    auto fns = cuckoo_tools::PlainFunctions(cuckoo_tools::PerFunctionSeeds(3, ""));
    std::printf("  input to SHA-256 : \"0\" || \"ant\"  = %s\n",
                cuckoo_tools::ToHex("0ant").c_str());
    std::printf("  digest           : %s\n", L.digestHex.c_str());
    std::printf("  lo = LE(d[0..15]): %s\n", L.loHex.c_str());
    std::printf("  hi = LE(d[16..31]): %s\n", L.hiHex.c_str());
    std::printf("  N as one integer : %s\n", L.nDec.c_str());
    std::printf("  r1 = hi mod 6    : %d\n", L.r1);
    std::printf("  d2 = r1*2^64+hi64(lo) = %s\n", L.d2Dec.c_str());
    std::printf("  r2 = d2 mod 6    : %d\n", L.r2);
    std::printf("  d3 = r2*2^64+lo64(lo) = %s\n", L.d3Dec.c_str());
    std::printf("  r3 = d3 mod 6    : %d   <- the bucket\n", L.r3);
    std::printf("  real function    : %d\n", fns[0]("ant", 6));
  }

  Rule("3. classroom build, m = 6, k = 3, budget = 4");
  RunCuckoo(6, 3, 4, absl::nullopt, {"ant", "bee", "cat", "dog"});

  Rule("4. the same four words in other orders (quirk Q7)");
  RunCuckoo(6, 3, 4, absl::nullopt, {"dog", "cat", "bee", "ant"});
  RunCuckoo(6, 3, 4, absl::nullopt, {"bee", "ant", "dog", "cat"});
  RunCuckoo(6, 3, 4, absl::nullopt, {"cat", "dog", "ant", "bee"});

  Rule("5. the relocation budget (quirks Q5, Q6, Q8)");
  for (int budget : {0, 1, 2, 4, 50}) {
    RunCuckoo(6, 3, budget, absl::nullopt, {"ant", "bee", "cat", "dog"});
  }

  Rule("6. a bounded stash");
  RunCuckoo(4, 2, 2, 1, {"ant", "bee", "cat", "dog", "eel", "fox"});

  Rule("7. duplicates are allowed (quirk Q4)");
  RunCuckoo(6, 3, 4, absl::nullopt, {"ant", "ant", "ant"});

  Rule("8. degenerate: m = 1, k = 2");
  RunCuckoo(1, 2, 4, absl::nullopt, {"ant", "bee"});

  Rule("9. what Create rejects");
  {
    struct Case { const char* what; absl::Status s; };
    std::vector<Case> cases = {
        {"num_buckets = 0", CuckooHashTable::Create(SHA256HashFamily{}, 0, 2, 0).status()},
        {"k = 1", CuckooHashTable::Create(SHA256HashFamily{}, 4, 1, 0).status()},
        {"max_relocations = -1", CuckooHashTable::Create(SHA256HashFamily{}, 4, 2, -1).status()},
        {"max_stash_size = -1", CuckooHashTable::Create(SHA256HashFamily{}, 4, 2, 0, -1).status()},
        {"max_relocations = 0", CuckooHashTable::Create(SHA256HashFamily{}, 4, 2, 0).status()},
        {"max_stash_size = 0", CuckooHashTable::Create(SHA256HashFamily{}, 4, 2, 0, 0).status()},
    };
    for (const auto& c : cases) {
      std::printf("  %-22s -> %s %s\n", c.what,
                  absl::StatusCodeToString(c.s.code()).c_str(),
                  std::string(c.s.message()).c_str());
    }
  }

  // ------------------------------------------------------- multiple choice
  Rule("10. MultipleChoiceHashTable, m = 6");
  for (int k : {2, 3}) {
    for (absl::optional<int> cap : {absl::optional<int>(), absl::optional<int>(1),
                                    absl::optional<int>(2)}) {
      auto r = MultipleChoiceHashTable::Create(SHA256HashFamily{}, 6, k, cap);
      if (!r.ok()) { std::printf("  create failed\n"); continue; }
      auto& t = **r;
      std::printf("  k=%d cap=%s\n", k, cap ? std::to_string(*cap).c_str() : "unlimited");
      for (const auto& e : {"ant", "bee", "cat", "dog", "eel", "fox"}) {
        absl::Status s = t.Insert(e);
        std::printf("    insert %-4s %-9s %s\n", e,
                    s.ok() ? "OK" : absl::StatusCodeToString(s.code()).c_str(),
                    ShowBuckets(t.GetTable()).c_str());
        if (!s.ok()) { std::printf("      message: \"%s\"\n", std::string(s.message()).c_str()); break; }
      }
    }
  }

  // ------------------------------------------------------------ simple hash
  Rule("11. SimpleHashTable, m = 6");
  for (int k : {1, 2, 3}) {
    auto r = SimpleHashTable::Create(SHA256HashFamily{}, 6, k);
    auto& t = **r;
    std::printf("  k=%d\n", k);
    for (const auto& e : {"ant", "bee", "cat"}) {
      (void)t.Insert(e);
      std::printf("    after %-4s %s\n", e, ShowBuckets(t.GetTable()).c_str());
    }
  }

  Rule("12. SimpleHashTable capacity check with duplicate candidates");
  // The capacity check runs over every candidate before any push_back. When two
  // hash functions land on the same bucket, that bucket is measured twice at its
  // old size, so a bucket at max-1 accepts two more elements. Look for an m and
  // an element where two candidates coincide, then drive that bucket to max-1.
  {
    for (int m = 2; m <= 16; m++) {
      auto fns = cuckoo_tools::PlainFunctions(cuckoo_tools::PerFunctionSeeds(2, ""));
      bool shown = false;
      for (const auto& w : kPool) {
        if (shown) break;
        int a = fns[0](w, m), b = fns[1](w, m);
        if (a != b) continue;
        // Find fillers whose candidates both land on bucket a is not needed: any
        // element that puts one copy in a works, because k=2 pushes two copies.
        std::printf("  m=%d: \"%s\" has h0 = h1 = %d\n", m, w.c_str(), a);
        for (int cap = 2; cap <= 4; cap++) {
          auto r = SimpleHashTable::Create(SHA256HashFamily{}, m, 2, cap);
          auto& t = **r;
          // Fill bucket a to cap-1 using other words.
          int filled = 0;
          for (const auto& f : kPool) {
            if (f == w) continue;
            if (filled >= cap - 1) break;
            int fa = fns[0](f, m), fb = fns[1](f, m);
            int adds = (fa == a) + (fb == a);
            if (adds != 1) continue;
            if (!t.Insert(f).ok()) break;
            filled += adds;
          }
          if (filled != cap - 1) continue;
          size_t before = t.GetTable()[a].size();
          absl::Status s = t.Insert(w);
          size_t after = t.GetTable()[a].size();
          std::printf("    cap=%d bucket %d: %zu -> %zu on inserting \"%s\" (%s)%s\n",
                      cap, a, before, after, w.c_str(),
                      s.ok() ? "OK" : "error",
                      after > static_cast<size_t>(cap) ? "   <-- over capacity" : "");
          shown = true;
        }
      }
    }
  }

  Rule("13. production parameter arithmetic");
  for (int n : {1, 2, 3, 4, 5, 7, 10, 100}) {
    // cuckoo_hashing_sparse_dpf_pir_server.cc:71-73 assigns a double product to
    // an int64 proto field, so the value truncates.
    int64_t m = static_cast<int64_t>(1.5 * n);
    std::printf("  n=%-4d -> num_buckets = int64(1.5 * %d) = %ld, max_relocations = %d\n",
                n, n, static_cast<long>(m), n);
  }
  std::printf("\n[explore] done\n");
  return 0;
}
