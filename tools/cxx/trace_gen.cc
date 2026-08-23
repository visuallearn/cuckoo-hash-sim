// Record traces from the unmodified reference implementation.
//
// Every value the website shows is written here, by a program that links the
// real pir/hashing sources. The browser recomputes none of it.
//
// The instrumentation is decoration from the outside (see reference_wrap.h for
// why no patch is needed) and it checks itself three ways: a recomputed digest
// and division ladder per hash, a shadow mt19937_64 that must predict the same
// hash-function index as the table's private one, and a shadow table that must
// equal GetTable()/GetStash() after every Insert. Any disagreement aborts.
//
// Usage: trace_gen <scenarios.txt> <out-dir>
#include <cinttypes>
#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <iostream>
#include <map>
#include <memory>
#include <set>
#include <sstream>
#include <string>
#include <utility>
#include <vector>

#include "absl/status/status.h"
#include "absl/status/statusor.h"
#include "absl/strings/str_cat.h"
#include "absl/strings/string_view.h"
#include "absl/types/optional.h"
#include "json_writer.h"
#include "pir/hashing/cuckoo_hash_table.h"
#include "pir/hashing/hash_family.h"
#include "pir/hashing/multiple_choice_hash_table.h"
#include "pir/hashing/sha256_hash_family.h"
#include "pir/hashing/simple_hash_table.h"
#include "reference_wrap.h"

using cuckoo_tools::Json;
using cuckoo_tools::Ladder;
using distributed_point_functions::CuckooHashTable;
using distributed_point_functions::HashFunction;
using distributed_point_functions::MultipleChoiceHashTable;
using distributed_point_functions::SHA256HashFamily;
using distributed_point_functions::SimpleHashTable;

namespace {

constexpr int kSchemaVersion = 1;
// Above this many buckets a trace stores state changes per micro-step and a full
// snapshot per operation, instead of a full snapshot per micro-step. Every
// teaching scenario is far below the threshold and carries both, so the
// self-test can compare the two representations against each other.
constexpr int kFullSnapshotMaxBuckets = 24;

const char* kCuckooFile = "pir/hashing/cuckoo_hash_table.cc";
const char* kSha256File = "pir/hashing/sha256_hash_family.cc";
const char* kMchtFile = "pir/hashing/multiple_choice_hash_table.cc";
const char* kSimpleFile = "pir/hashing/simple_hash_table.cc";
const char* kClientFile = "pir/cuckoo_hashing_sparse_dpf_pir_client.cc";
const char* kDatabaseFile = "pir/cuckoo_hashed_dpf_pir_database.cc";

struct Scenario {
  std::string id;
  std::string structure;  // cuckoo | multiple_choice | simple
  int numBuckets = 0;
  int k = 0;
  int maxRelocations = 0;
  absl::optional<int> maxStashSize;
  absl::optional<int> maxBucketSize;
  std::string familySeedHex;  // "" = the bare family, seeds "0","1","2"
  std::vector<std::string> elements;
  std::vector<std::string> lookups;
  std::string title;
  std::string teaches;
};

// ---------------------------------------------------------------- text parsing

std::vector<std::string> Split(const std::string& s, char sep) {
  std::vector<std::string> out;
  std::string cur;
  for (char c : s) {
    if (c == sep) { out.push_back(cur); cur.clear(); }
    else cur += c;
  }
  out.push_back(cur);
  return out;
}

std::string Trim(const std::string& s) {
  size_t a = s.find_first_not_of(" \t\r\n");
  if (a == std::string::npos) return "";
  size_t b = s.find_last_not_of(" \t\r\n");
  return s.substr(a, b - a + 1);
}

std::vector<std::string> SplitCsv(const std::string& s) {
  std::vector<std::string> out;
  if (Trim(s).empty() || Trim(s) == "-") return out;
  for (const auto& p : Split(s, ',')) {
    std::string t = Trim(p);
    if (!t.empty()) out.push_back(t);
  }
  return out;
}

absl::optional<int> ParseOpt(const std::string& s) {
  std::string t = Trim(s);
  if (t.empty() || t == "-") return absl::nullopt;
  return std::atoi(t.c_str());
}

std::string FromHex(const std::string& hex) {
  CK_CHECK(hex.size() % 2 == 0, "odd hex length %zu", hex.size());
  std::string out;
  for (size_t i = 0; i < hex.size(); i += 2) {
    out += static_cast<char>(std::stoi(hex.substr(i, 2), nullptr, 16));
  }
  return out;
}

std::vector<Scenario> ReadScenarios(const std::string& path) {
  std::ifstream in(path);
  CK_CHECK(in.good(), "cannot open %s", path.c_str());
  std::vector<Scenario> out;
  std::string line;
  int lineno = 0;
  while (std::getline(in, line)) {
    lineno++;
    std::string t = Trim(line);
    if (t.empty() || t[0] == '#') continue;
    auto f = Split(t, '|');
    CK_CHECK(f.size() == 12, "%s:%d has %zu fields, expected 12", path.c_str(), lineno,
             f.size());
    Scenario s;
    s.id = Trim(f[0]);
    s.structure = Trim(f[1]);
    s.numBuckets = std::atoi(Trim(f[2]).c_str());
    s.k = std::atoi(Trim(f[3]).c_str());
    s.maxRelocations = std::atoi(Trim(f[4]).c_str());
    s.maxStashSize = ParseOpt(f[5]);
    s.maxBucketSize = ParseOpt(f[6]);
    s.familySeedHex = Trim(f[7]);
    s.elements = SplitCsv(f[8]);
    s.lookups = SplitCsv(f[9]);
    s.title = Trim(f[10]);
    s.teaches = Trim(f[11]);
    out.push_back(std::move(s));
  }
  return out;
}

// ---------------------------------------------------------------- the recorder

class Recorder {
 public:
  Recorder(const Scenario& sc, std::vector<std::string> seeds)
      : sc_(sc), seeds_(std::move(seeds)),
        full_snapshots_(sc.numBuckets <= kFullSnapshotMaxBuckets) {}

  bool full_snapshots() const { return full_snapshots_; }
  const std::vector<std::string>& seeds() const { return seeds_; }
  std::map<std::string, int>& counts() { return counts_; }

  // Hash functions handed to the reference. Each one wraps the real
  // SHA256HashFunction and reports every call.
  std::vector<HashFunction> MakeFunctions() {
    std::vector<HashFunction> out;
    out.reserve(seeds_.size());
    for (size_t j = 0; j < seeds_.size(); j++) {
      HashFunction real = SHA256HashFamily{}(seeds_[j]);
      out.push_back([this, j, real = std::move(real)](absl::string_view in,
                                                      int bound) -> int {
        return this->OnCall(static_cast<int>(j), in, bound, real(in, bound));
      });
    }
    return out;
  }

  // ---- cuckoo -------------------------------------------------------------
  void BeginCuckooInsert(const std::string& element) {
    mode_ = Mode::kCuckoo;
    iter_ = 0;
    placed_ = false;
    walker_ = element;
    steps_ = Json();
    steps_.BeginArr();
  }

  // Finishes the operation and appends it to ops_.
  void EndCuckooInsert(const std::string& element, const absl::Status& status,
                       const CuckooHashTable& table) {
    if (!placed_) {
      // cuckoo_hash_table.cc:84-89. The budget is gone; either the element goes
      // on the stash or a bounded stash is already full.
      if (status.ok()) {
        Step("stash_push", [&](Json& j) {
          j.KS("element", walker_);
          j.KI("stashIndexAfter", static_cast<int>(shadow_stash_.size()));
        }, kCuckooFile, 87);
        shadow_stash_.push_back(walker_);
        Snapshot();
        EndStep();
      } else {
        Step("stash_overflow_error", [&](Json& j) {
          j.KS("element", walker_);
          j.KS("statusCode", absl::StatusCodeToString(status.code()));
          j.KS("message", std::string(status.message()));
        }, kCuckooFile, 85);
        Snapshot();
        EndStep();
      }
    }
    steps_.EndArr();

    // The shadow must equal the real table, or nothing here is trustworthy.
    AssertCuckooShadow(table);

    ops_.BeginObj();
    ops_.KS("op", "insert");
    ops_.KS("arg", element);
    ops_.KS("status", status.ok() ? "ok" : "error");
    ops_.KS("statusCode", absl::StatusCodeToString(status.code()));
    if (!status.ok()) ops_.KS("message", std::string(status.message()));
    ops_.KI("relocationsUsed", iter_);
    ops_.KI("maxRelocations", sc_.maxRelocations);
    WriteTable(ops_, "tableBefore", op_table_before_);
    WriteStash(ops_, "stashBefore", op_stash_before_);
    WriteTable(ops_, "tableAfter", shadow_table_);
    WriteStash(ops_, "stashAfter", shadow_stash_);
    ops_.KRaw("steps", steps_.str());
    ops_.EndObj();
    op_table_before_ = shadow_table_;
    op_stash_before_ = shadow_stash_;
    op_count_++;
  }

  // ---- multiple choice ----------------------------------------------------
  void BeginMchtInsert(const std::string& element) {
    mode_ = Mode::kMcht;
    steps_ = Json();
    steps_.BeginArr();
    mcht_hashes_.clear();
    mcht_smallest_ = 0;
    walker_ = element;
  }

  void EndMchtInsert(const std::string& element, const absl::Status& status,
                     const MultipleChoiceHashTable& table) {
    CK_CHECK(mcht_hashes_.size() == seeds_.size(),
             "%s: %zu hash calls for k=%zu", element.c_str(), mcht_hashes_.size(),
             seeds_.size());
    // multiple_choice_hash_table.cc:62-64. The first minimum wins: the test is a
    // strict <, so a later candidate with an equal count does not displace it.
    Step("choose", [&](Json& j) {
      j.KI("bucket", mcht_smallest_);
      j.Key("candidates").BeginArr();
      for (size_t i = 0; i < mcht_hashes_.size(); i++) {
        j.BeginObj();
        j.KI("j", static_cast<int>(i));
        j.KI("bucket", mcht_hashes_[i]);
        j.KI("size", static_cast<int>(shadow_buckets_[mcht_hashes_[i]].size()));
        j.KB("chosen", mcht_hashes_[i] == mcht_smallest_);
        j.EndObj();
      }
      j.EndArr();
    }, kMchtFile, 62);
    EndStep();

    if (status.ok()) {
      shadow_buckets_[mcht_smallest_].push_back(element);
      Step("append", [&](Json& j) {
        j.KI("bucket", mcht_smallest_);
        j.KS("element", element);
      }, kMchtFile, 70);
      SnapshotBuckets();
      EndStep();
    } else {
      Step("bucket_full_error", [&](Json& j) {
        j.KI("bucket", mcht_smallest_);
        j.KS("element", element);
        j.KS("statusCode", absl::StatusCodeToString(status.code()));
        j.KS("message", std::string(status.message()));
      }, kMchtFile, 67);
      SnapshotBuckets();
      EndStep();
    }
    steps_.EndArr();
    AssertBucketShadow(table.GetTable());
    WriteBucketOp("insert", element, status);
  }

  // ---- simple hashing -----------------------------------------------------
  void BeginSimpleInsert(const std::string& element) {
    mode_ = Mode::kSimple;
    steps_ = Json();
    steps_.BeginArr();
    mcht_hashes_.clear();
    walker_ = element;
  }

  void EndSimpleInsert(const std::string& element, const absl::Status& status,
                       const SimpleHashTable& table) {
    if (status.ok()) {
      // simple_hash_table.cc:66-68. Every candidate takes a copy, so an element
      // whose candidates coincide gets two copies in one bucket.
      for (size_t i = 0; i < mcht_hashes_.size(); i++) {
        int b = mcht_hashes_[i];
        shadow_buckets_[b].push_back(element);
        Step("append", [&](Json& j) {
          j.KI("j", static_cast<int>(i));
          j.KI("bucket", b);
          j.KS("element", element);
        }, kSimpleFile, 67);
        SnapshotBuckets();
        EndStep();
      }
    } else {
      int b = mcht_hashes_.empty() ? -1 : mcht_hashes_.back();
      Step("bucket_full_error", [&](Json& j) {
        j.KI("bucket", b);
        j.KS("element", element);
        j.KS("statusCode", absl::StatusCodeToString(status.code()));
        j.KS("message", std::string(status.message()));
      }, kSimpleFile, 60);
      SnapshotBuckets();
      EndStep();
    }
    steps_.EndArr();
    AssertBucketShadow(table.GetTable());
    WriteBucketOp("insert", element, status);
  }

  // ---- lookup -------------------------------------------------------------
  // The reference table has no Lookup. This is the client's code path:
  // cuckoo_hashing_sparse_dpf_pir_client.cc:137-142 computes all k indices for a
  // query, without removing duplicates.
  void RecordLookup(const std::string& query,
                    const std::vector<HashFunction>& plain) {
    mode_ = Mode::kLookup;
    steps_ = Json();
    steps_.BeginArr();
    bool hit = false;
    int hitBucket = -1;
    std::vector<int> buckets;
    for (size_t j = 0; j < plain.size(); j++) {
      int b = plain[j](query, sc_.numBuckets);
      Ladder L = cuckoo_tools::ComputeLadder(seeds_[j], query, sc_.numBuckets);
      CK_CHECK(L.bucket == b, "lookup ladder %d != %d", L.bucket, b);
      buckets.push_back(b);
      WriteHashStep(static_cast<int>(j), query, L, b, /*iter=*/-1, kClientFile, 140);
      const auto& slot = shadow_table_[b];
      bool match = slot.has_value() && *slot == query;
      Step("probe", [&](Json& jj) {
        jj.KI("j", static_cast<int>(j));
        jj.KI("bucket", b);
        if (slot.has_value()) jj.KS("occupant", *slot); else jj.KN("occupant");
        jj.KB("match", match);
      }, kClientFile, 140);
      EndStep();
      if (match && !hit) { hit = true; hitBucket = b; }
    }
    // The production PIR layer never reads the stash (the database builder only
    // copies GetTable()), so a stashed key is unreachable there. A teaching
    // lookup shows the scan anyway, and the site says which is which.
    int stashIndex = -1;
    for (size_t i = 0; i < shadow_stash_.size(); i++) {
      if (shadow_stash_[i] == query) { stashIndex = static_cast<int>(i); break; }
    }
    Step("stash_scan", [&](Json& jj) {
      jj.KI("stashSize", static_cast<int>(shadow_stash_.size()));
      jj.KI("foundAt", stashIndex);
    }, kDatabaseFile, 155);
    EndStep();
    Step("result", [&](Json& jj) {
      jj.KB("foundInTable", hit);
      jj.KI("bucket", hitBucket);
      jj.KB("foundInStash", stashIndex >= 0);
      jj.KI("probes", static_cast<int>(plain.size()));
    }, kClientFile, 140);
    EndStep();
    steps_.EndArr();

    ops_.BeginObj();
    ops_.KS("op", "lookup");
    ops_.KS("arg", query);
    ops_.KS("status", "ok");
    ops_.KS("statusCode", "OK");
    ops_.KB("foundInTable", hit);
    ops_.KI("bucket", hitBucket);
    ops_.KB("foundInStash", stashIndex >= 0);
    ops_.Key("candidateBuckets").BeginArr();
    for (int b : buckets) ops_.Int(b);
    ops_.EndArr();
    WriteTable(ops_, "tableBefore", shadow_table_);
    WriteStash(ops_, "stashBefore", shadow_stash_);
    WriteTable(ops_, "tableAfter", shadow_table_);
    WriteStash(ops_, "stashAfter", shadow_stash_);
    ops_.KRaw("steps", steps_.str());
    ops_.EndObj();
    op_count_++;
  }

  // ---- setup / output -----------------------------------------------------
  void InitCuckoo() {
    shadow_table_.assign(sc_.numBuckets, absl::nullopt);
    shadow_stash_.clear();
    op_table_before_ = shadow_table_;
    op_stash_before_ = shadow_stash_;
    shadow_rng_ = std::make_unique<cuckoo_tools::ShadowRng>(sc_.k);
    ops_ = Json();
    ops_.BeginArr();
  }

  void InitBuckets() {
    shadow_buckets_.assign(sc_.numBuckets, {});
    op_buckets_before_ = shadow_buckets_;
    ops_ = Json();
    ops_.BeginArr();
  }

  std::string Finish(const std::vector<HashFunction>& plain) {
    ops_.EndArr();
    Json t;
    t.BeginObj();
    t.KI("schemaVersion", kSchemaVersion);
    t.KS("id", sc_.id);
    t.KS("structure", sc_.structure);
    t.KS("title", sc_.title);
    t.KS("teaches", sc_.teaches);
    t.KS("snapshots", full_snapshots_ ? "full" : "op");

    t.Key("params").BeginObj();
    t.KI("numBuckets", sc_.numBuckets);
    t.KI("numHashFunctions", sc_.k);
    t.KI("maxRelocations", sc_.maxRelocations);
    if (sc_.maxStashSize) t.KI("maxStashSize", *sc_.maxStashSize); else t.KN("maxStashSize");
    if (sc_.maxBucketSize) t.KI("maxBucketSize", *sc_.maxBucketSize); else t.KN("maxBucketSize");
    t.KS("hashFamily", "SHA256");
    t.KS("familySeedHex", sc_.familySeedHex);
    t.Key("perFunctionSeedsHex").BeginArr();
    for (const auto& s : seeds_) t.Str(cuckoo_tools::ToHex(s));
    t.EndArr();
    t.Key("perFunctionSeeds").BeginArr();
    for (const auto& s : seeds_) t.Str(s);
    t.EndArr();
    t.KS("rng", sc_.structure == "cuckoo"
                    ? "std::mt19937_64 default-constructed (seed 5489)"
                    : "none");
    t.EndObj();

    t.Key("elements").BeginArr();
    for (const auto& e : sc_.elements) t.Str(e);
    t.EndArr();

    // The full candidate set of every element and every query, computed outside
    // the run so the site can draw all k arrows before the walk chooses one.
    std::set<std::string> all(sc_.elements.begin(), sc_.elements.end());
    all.insert(sc_.lookups.begin(), sc_.lookups.end());
    t.Key("candidates").BeginObj();
    for (const auto& e : all) {
      t.Key(e).BeginArr();
      for (size_t j = 0; j < plain.size(); j++) t.Int(plain[j](e, sc_.numBuckets));
      t.EndArr();
    }
    t.EndObj();

    t.KRaw("ops", ops_.str());

    if (sc_.structure == "cuckoo") {
      WriteTable(t, "finalTable", shadow_table_);
      WriteStash(t, "finalStash", shadow_stash_);
    } else {
      WriteBuckets(t, "finalBuckets", shadow_buckets_);
    }

    t.Key("eventCounts").BeginObj();
    for (const auto& [k, v] : counts_) t.KI(k, v);
    t.EndObj();
    t.KI("opCount", op_count_);
    t.KI("microStepCount", micro_count_);
    t.EndObj();
    return t.str();
  }

 private:
  enum class Mode { kNone, kCuckoo, kMcht, kSimple, kLookup };

  // The one entry point every hash-function call goes through.
  int OnCall(int j, absl::string_view input, int bound, int real_result) {
    CK_CHECK(bound == sc_.numBuckets, "unexpected upper bound %d", bound);
    if (mode_ == Mode::kCuckoo) {
      CK_CHECK(std::string(input) == walker_,
               "walker drift: table has %s, shadow has %s",
               std::string(input).c_str(), walker_.c_str());
      // cuckoo_hash_table.cc:71. The index is drawn first, then that one hash
      // function runs. Predict the draw and check it against the index that was
      // actually called.
      cuckoo_tools::DrawRecord d = shadow_rng_->Draw();
      CK_CHECK(d.j == j,
               "shadow rng predicted hash function %d, the table used %d "
               "(abseil's uniform_int_distribution changed?)",
               d.j, j);
      WriteDrawStep(d, j);
    }

    Ladder L = cuckoo_tools::ComputeLadder(seeds_[j], input, bound);
    CK_CHECK(L.bucket == real_result,
             "recomputed bucket %d != the reference's %d for h_%d(%s)", L.bucket,
             real_result, j, std::string(input).c_str());

    if (mode_ == Mode::kMcht) {
      // multiple_choice_hash_table.cc:61-64, in order i = 0 .. k-1.
      CK_CHECK(static_cast<size_t>(j) == mcht_hashes_.size(),
               "MCHT called hash %d out of order", j);
      WriteHashStep(j, std::string(input), L, real_result, /*iter=*/-1, kMchtFile, 61);
      if (j == 0 || shadow_buckets_[real_result].size() <
                        shadow_buckets_[mcht_smallest_].size()) {
        mcht_smallest_ = real_result;
      }
      mcht_hashes_.push_back(real_result);
      return real_result;
    }

    if (mode_ == Mode::kSimple) {
      WriteHashStep(j, std::string(input), L, real_result, /*iter=*/-1, kSimpleFile, 58);
      mcht_hashes_.push_back(real_result);
      // simple_hash_table.cc:59. The check reads the bucket size before any
      // element of this insert has been appended.
      Step("capacity_check", [&](Json& jj) {
        jj.KI("j", j);
        jj.KI("bucket", real_result);
        jj.KI("size", static_cast<int>(shadow_buckets_[real_result].size()));
        if (sc_.maxBucketSize) jj.KI("maxBucketSize", *sc_.maxBucketSize);
        else jj.KN("maxBucketSize");
        jj.KB("full", sc_.maxBucketSize.has_value() &&
                          shadow_buckets_[real_result].size() >=
                              static_cast<size_t>(*sc_.maxBucketSize));
      }, kSimpleFile, 59);
      EndStep();
      return real_result;
    }

    // Cuckoo. The reference reads table_[hash] next, so mirror that here and
    // stay exactly in step.
    WriteHashStep(j, std::string(input), L, real_result, iter_, kSha256File, 59);
    if (shadow_table_[real_result].has_value()) {
      std::string outgoing = *shadow_table_[real_result];
      Step("evict", [&](Json& jj) {
        jj.KI("i", iter_);
        jj.KI("bucket", real_result);
        jj.KS("incoming", walker_);
        jj.KS("outgoing", outgoing);
      }, kCuckooFile, 75);
      std::swap(walker_, *shadow_table_[real_result]);
      Snapshot();
      EndStep();
    } else {
      Step("place", [&](Json& jj) {
        jj.KI("i", iter_);
        jj.KI("bucket", real_result);
        jj.KS("element", walker_);
      }, kCuckooFile, 78);
      shadow_table_[real_result] = walker_;
      walker_.clear();
      placed_ = true;
      Snapshot();
      EndStep();
    }
    iter_++;
    return real_result;
  }

  // ---- step writing -------------------------------------------------------
  template <typename F>
  void Step(const char* kind, F&& fill, const char* file, int line) {
    steps_.BeginObj();
    steps_.KI("s", micro_count_);
    steps_.KS("kind", kind);
    fill(steps_);
    steps_.Key("codeLoc").BeginObj();
    steps_.KS("file", file);
    steps_.KI("line", line);
    steps_.EndObj();
    counts_[kind]++;
    micro_count_++;
  }
  void EndStep() { steps_.EndObj(); }

  void WriteDrawStep(const cuckoo_tools::DrawRecord& d, int j) {
    Step("draw", [&](Json& jj) {
      jj.KI("i", iter_);
      jj.KI("j", j);
      jj.KI("k", sc_.k);
      jj.Key("raw").BeginArr();
      for (uint64_t r : d.raws) jj.Str(std::to_string(r));
      jj.EndArr();
      jj.Key("rawHex").BeginArr();
      for (uint64_t r : d.raws) jj.Str("0x" + cuckoo_tools::U64Hex(r));
      jj.EndArr();
      uint32_t bits = static_cast<uint32_t>(d.raws.back());
      jj.KU("bits32", bits);
      jj.KI("redraws", static_cast<int>(d.raws.size()) - 1);
      const uint32_t R = static_cast<uint32_t>(sc_.k - 1);
      const uint32_t Lim = static_cast<uint32_t>(sc_.k);
      if ((R & Lim) == 0) {
        jj.KS("mapKind", "mask");
        jj.KS("mapFormula",
              absl::StrCat("bits32 & ", sc_.k - 1, " = ", d.j));
        jj.KN("product");
        jj.KI("rejectThreshold", 0);
      } else {
        uint64_t product = static_cast<uint64_t>(bits) * Lim;
        jj.KS("mapKind", "multiply-shift");
        jj.KS("mapFormula",
              absl::StrCat("floor(", bits, " * ", sc_.k, " / 2^32) = ", d.j));
        jj.KS("product", std::to_string(product));
        jj.KU("productLow32", static_cast<uint32_t>(product));
        jj.KU("rejectThreshold", 0x100000000ULL % Lim);
      }
    }, kCuckooFile, 71);
    EndStep();
  }

  void WriteHashStep(int j, const std::string& input, const Ladder& L, int bucket,
                     int iter, const char* file, int line) {
    Step("hash", [&](Json& jj) {
      if (iter >= 0) jj.KI("i", iter);
      jj.KI("j", j);
      jj.KS("input", input);
      jj.KS("seed", seeds_[j]);
      jj.KS("seedHex", cuckoo_tools::ToHex(seeds_[j]));
      jj.KS("preimageHex", cuckoo_tools::ToHex(seeds_[j] + input));
      jj.KS("digestHex", L.digestHex);
      jj.KS("loHex", L.loHex);
      jj.KS("hiHex", L.hiHex);
      jj.KS("nDec", L.nDec);
      jj.KI("m", sc_.numBuckets);
      jj.Key("ladder").BeginObj();
      jj.KI("r1", L.r1);
      jj.KI("r1Line", 80);
      jj.KS("d2", L.d2Dec);
      jj.KS("d2Hex", L.d2Hex);
      jj.KI("r2", L.r2);
      jj.KI("r2Line", 83);
      jj.KS("d3", L.d3Dec);
      jj.KS("d3Hex", L.d3Hex);
      jj.KI("r3", L.r3);
      jj.KI("r3Line", 86);
      jj.EndObj();
      jj.KI("bucket", bucket);
    }, file, line);
    EndStep();
  }

  void Snapshot() {
    if (!full_snapshots_) return;
    WriteTable(steps_, "tableAfter", shadow_table_);
    WriteStash(steps_, "stashAfter", shadow_stash_);
  }

  void SnapshotBuckets() {
    if (!full_snapshots_) return;
    WriteBuckets(steps_, "bucketsAfter", shadow_buckets_);
  }

  static void WriteTable(Json& j, const char* key,
                         const std::vector<absl::optional<std::string>>& t) {
    j.Key(key).BeginArr();
    for (const auto& s : t) { if (s) j.Str(*s); else j.Null(); }
    j.EndArr();
  }
  static void WriteStash(Json& j, const char* key, const std::vector<std::string>& s) {
    j.Key(key).BeginArr();
    for (const auto& e : s) j.Str(e);
    j.EndArr();
  }
  static void WriteBuckets(Json& j, const char* key,
                           const std::vector<std::vector<std::string>>& b) {
    j.Key(key).BeginArr();
    for (const auto& bucket : b) {
      j.BeginArr();
      for (const auto& e : bucket) j.Str(e);
      j.EndArr();
    }
    j.EndArr();
  }

  void WriteBucketOp(const char* op, const std::string& arg,
                     const absl::Status& status) {
    ops_.BeginObj();
    ops_.KS("op", op);
    ops_.KS("arg", arg);
    ops_.KS("status", status.ok() ? "ok" : "error");
    ops_.KS("statusCode", absl::StatusCodeToString(status.code()));
    if (!status.ok()) ops_.KS("message", std::string(status.message()));
    WriteBuckets(ops_, "bucketsBefore", op_buckets_before_);
    WriteBuckets(ops_, "bucketsAfter", shadow_buckets_);
    ops_.KRaw("steps", steps_.str());
    ops_.EndObj();
    op_buckets_before_ = shadow_buckets_;
    op_count_++;
  }

  void AssertCuckooShadow(const CuckooHashTable& table) {
    const auto& real = table.GetTable();
    CK_CHECK(real.size() == shadow_table_.size(), "table size %zu != %zu",
             real.size(), shadow_table_.size());
    for (size_t i = 0; i < real.size(); i++) {
      CK_CHECK(real[i].has_value() == shadow_table_[i].has_value() &&
                   (!real[i] || *real[i] == *shadow_table_[i]),
               "slot %zu: reference has %s, shadow has %s", i,
               real[i] ? real[i]->c_str() : "empty",
               shadow_table_[i] ? shadow_table_[i]->c_str() : "empty");
    }
    const auto& rs = table.GetStash();
    CK_CHECK(rs.size() == shadow_stash_.size(), "stash size %zu != %zu", rs.size(),
             shadow_stash_.size());
    for (size_t i = 0; i < rs.size(); i++) {
      CK_CHECK(rs[i] == shadow_stash_[i], "stash %zu: %s != %s", i, rs[i].c_str(),
               shadow_stash_[i].c_str());
    }
  }

  void AssertBucketShadow(const std::vector<std::vector<std::string>>& real) {
    CK_CHECK(real.size() == shadow_buckets_.size(), "bucket count %zu != %zu",
             real.size(), shadow_buckets_.size());
    for (size_t i = 0; i < real.size(); i++) {
      CK_CHECK(real[i] == shadow_buckets_[i], "bucket %zu differs", i);
    }
  }

  const Scenario& sc_;
  std::vector<std::string> seeds_;
  bool full_snapshots_;

  Mode mode_ = Mode::kNone;
  Json steps_;
  Json ops_;
  int micro_count_ = 0;
  int op_count_ = 0;
  std::map<std::string, int> counts_;

  // cuckoo shadow
  std::vector<absl::optional<std::string>> shadow_table_;
  std::vector<std::string> shadow_stash_;
  std::vector<absl::optional<std::string>> op_table_before_;
  std::vector<std::string> op_stash_before_;
  std::unique_ptr<cuckoo_tools::ShadowRng> shadow_rng_;
  std::string walker_;
  int iter_ = 0;
  bool placed_ = false;

  // bucket shadow (multiple choice and simple hashing)
  std::vector<std::vector<std::string>> shadow_buckets_;
  std::vector<std::vector<std::string>> op_buckets_before_;
  std::vector<int> mcht_hashes_;
  int mcht_smallest_ = 0;
};

// ---------------------------------------------------------------- generation

std::string RunScenario(const Scenario& sc) {
  std::string family_seed = FromHex(sc.familySeedHex);
  auto seeds = cuckoo_tools::PerFunctionSeeds(sc.k, family_seed);
  auto plain = cuckoo_tools::PlainFunctions(seeds);
  Recorder rec(sc, seeds);

  if (sc.structure == "cuckoo") {
    rec.InitCuckoo();
    auto r = CuckooHashTable::Create(rec.MakeFunctions(), sc.numBuckets,
                                     sc.maxRelocations, sc.maxStashSize);
    CK_CHECK(r.ok(), "%s: Create failed: %s", sc.id.c_str(),
             std::string(r.status().message()).c_str());
    auto& table = **r;
    for (const auto& e : sc.elements) {
      rec.BeginCuckooInsert(e);
      absl::Status s = table.Insert(e);
      rec.EndCuckooInsert(e, s, table);
    }
    for (const auto& q : sc.lookups) rec.RecordLookup(q, plain);
  } else if (sc.structure == "multiple_choice") {
    rec.InitBuckets();
    auto r = MultipleChoiceHashTable::Create(rec.MakeFunctions(), sc.numBuckets,
                                             sc.maxBucketSize);
    CK_CHECK(r.ok(), "%s: Create failed: %s", sc.id.c_str(),
             std::string(r.status().message()).c_str());
    auto& table = **r;
    for (const auto& e : sc.elements) {
      rec.BeginMchtInsert(e);
      absl::Status s = table.Insert(e);
      rec.EndMchtInsert(e, s, table);
    }
  } else if (sc.structure == "simple") {
    rec.InitBuckets();
    auto r = SimpleHashTable::Create(rec.MakeFunctions(), sc.numBuckets,
                                     sc.maxBucketSize);
    CK_CHECK(r.ok(), "%s: Create failed: %s", sc.id.c_str(),
             std::string(r.status().message()).c_str());
    auto& table = **r;
    for (const auto& e : sc.elements) {
      rec.BeginSimpleInsert(e);
      absl::Status s = table.Insert(e);
      rec.EndSimpleInsert(e, s, table);
    }
  } else {
    CK_CHECK(false, "unknown structure %s", sc.structure.c_str());
  }
  return rec.Finish(plain);
}

}  // namespace

int main(int argc, char** argv) {
  if (argc != 3) {
    std::fprintf(stderr, "usage: trace_gen <scenarios.txt> <out-dir>\n");
    return 2;
  }
  const std::string scenarios_path = argv[1];
  const std::string out_dir = argv[2];

  auto scenarios = ReadScenarios(scenarios_path);
  CK_CHECK(!scenarios.empty(), "no scenarios in %s", scenarios_path.c_str());

  std::set<std::string> seen;
  Json index;
  index.BeginArr();
  for (const auto& sc : scenarios) {
    CK_CHECK(seen.insert(sc.id).second, "duplicate scenario id %s", sc.id.c_str());
    std::string json = RunScenario(sc);
    std::string path = out_dir + "/traces/" + sc.id + ".json";
    std::ofstream out(path, std::ios::binary);
    CK_CHECK(out.good(), "cannot write %s", path.c_str());
    out << json << "\n";
    out.close();

    index.BeginObj();
    index.KS("id", sc.id);
    index.KS("structure", sc.structure);
    index.KS("title", sc.title);
    index.KS("teaches", sc.teaches);
    index.KS("file", "traces/" + sc.id + ".json");
    index.KI("numBuckets", sc.numBuckets);
    index.KI("numHashFunctions", sc.k);
    index.KI("maxRelocations", sc.maxRelocations);
    if (sc.maxStashSize) index.KI("maxStashSize", *sc.maxStashSize);
    else index.KN("maxStashSize");
    if (sc.maxBucketSize) index.KI("maxBucketSize", *sc.maxBucketSize);
    else index.KN("maxBucketSize");
    index.KS("familySeedHex", sc.familySeedHex);
    index.KI("numElements", static_cast<int>(sc.elements.size()));
    index.KI("bytes", static_cast<int>(json.size()) + 1);
    index.EndObj();

    std::fprintf(stderr, "[trace_gen] %-18s %7zu bytes\n", sc.id.c_str(), json.size());
  }
  index.EndArr();
  std::string idx_path = out_dir + "/scenario-index.json";
  std::ofstream idx(idx_path, std::ios::binary);
  CK_CHECK(idx.good(), "cannot write %s", idx_path.c_str());
  idx << index.str() << "\n";
  std::fprintf(stderr, "[trace_gen] %zu scenario(s)\n", scenarios.size());
  return 0;
}
