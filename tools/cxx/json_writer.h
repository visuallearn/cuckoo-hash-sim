// A very small JSON writer. The trace files are the product this project ships,
// so the writer stays in one place, escapes properly, and refuses to emit a
// malformed document: every container must be closed before str() is read.
#ifndef CUCKOO_TOOLS_JSON_WRITER_H_
#define CUCKOO_TOOLS_JSON_WRITER_H_

#include <cstdint>
#include <cstdio>
#include <string>
#include <vector>

namespace cuckoo_tools {

class Json {
 public:
  Json& BeginObj() { Sep(); out_ += '{'; open_.push_back(true); return *this; }
  Json& EndObj() { Close('}'); return *this; }
  Json& BeginArr() { Sep(); out_ += '['; open_.push_back(true); return *this; }
  Json& EndArr() { Close(']'); return *this; }

  Json& Key(const std::string& k) {
    Sep();
    Escape(k);
    out_ += ':';
    pending_key_ = true;
    return *this;
  }

  Json& Str(const std::string& v) { Sep(); Escape(v); return *this; }
  Json& Int(int64_t v) { Sep(); out_ += std::to_string(v); return *this; }
  Json& UInt(uint64_t v) { Sep(); out_ += std::to_string(v); return *this; }
  Json& Bool(bool v) { Sep(); out_ += (v ? "true" : "false"); return *this; }
  Json& Null() { Sep(); out_ += "null"; return *this; }
  // For values already formatted as JSON (a big integer rendered as a decimal
  // string of digits, for example).
  Json& Raw(const std::string& v) { Sep(); out_ += v; return *this; }

  Json& KS(const std::string& k, const std::string& v) { return Key(k).Str(v); }
  Json& KI(const std::string& k, int64_t v) { return Key(k).Int(v); }
  Json& KU(const std::string& k, uint64_t v) { return Key(k).UInt(v); }
  Json& KB(const std::string& k, bool v) { return Key(k).Bool(v); }
  Json& KN(const std::string& k) { return Key(k).Null(); }
  Json& KRaw(const std::string& k, const std::string& v) { return Key(k).Raw(v); }

  const std::string& str() const {
    if (!open_.empty()) {
      std::fprintf(stderr, "json_writer: %zu container(s) left open\n", open_.size());
      std::abort();
    }
    return out_;
  }

 private:
  void Sep() {
    if (pending_key_) { pending_key_ = false; return; }
    if (open_.empty()) return;
    if (open_.back()) open_.back() = false;
    else out_ += ',';
  }
  void Close(char c) {
    if (open_.empty()) { std::fprintf(stderr, "json_writer: unbalanced close\n"); std::abort(); }
    open_.pop_back();
    out_ += c;
  }
  void Escape(const std::string& v) {
    out_ += '"';
    for (unsigned char c : v) {
      switch (c) {
        case '"': out_ += "\\\""; break;
        case '\\': out_ += "\\\\"; break;
        case '\n': out_ += "\\n"; break;
        case '\r': out_ += "\\r"; break;
        case '\t': out_ += "\\t"; break;
        default:
          if (c < 0x20 || c == 0x7f) {
            char buf[8];
            std::snprintf(buf, sizeof(buf), "\\u%04x", c);
            out_ += buf;
          } else {
            out_ += static_cast<char>(c);
          }
      }
    }
    out_ += '"';
  }

  std::string out_;
  std::vector<bool> open_;
  bool pending_key_ = false;
};

}  // namespace cuckoo_tools

#endif  // CUCKOO_TOOLS_JSON_WRITER_H_
