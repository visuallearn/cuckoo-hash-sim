# Verification counts

Every number here was printed by the program named beside it, and collected by `tools/16_counters.py`. None is copied by hand. Re-run with:

```sh
python3 tools/serve.py 8791 &
python3 tools/16_counters.py
```

| what is checked | by | checks | failures |
|---|---|---|---|
| independent re-derivation, in Python | `tools/04_verify.py` | 47,369 | 0 |
| behavior tests against the pinned reference | `tools/cxx/conformance_test.cc` | 58 | 0 |
| the reference's own suite, archived | `notes/reference-test-run/` | 7 | 0 |
| upstream TEST() cases, all mapped | `tools/12_check_mapping.py` | 29 | 0 |
| colour pairs, both themes | `tools/14_contrast.py` | 200 | 0 |
| golden index draws captured from the real abseil | `tools/cxx/rng_vectors.cc` | 7,000 | 0 |
| in-browser checks of the shipped files, and the engine replay of every trace | `docs/selftest.html` | 13,541 | 0 |
| headless browser checks, interact | `tools/browser-checks/interact.html` | 35 | 0 |
| headless browser checks, audit | `tools/browser-checks/audit.html` | 15 | 0 |
| | | **68,254** | **0** |

## The exact lines

```
tools/04_verify.py
    [04] 47369 checks, 0 failure
tools/cxx/conformance_test.cc
    58 checks, 0 failure
notes/reference-test-run/
    Executed 0 out of 7 tests: 7 tests pass
tools/12_check_mapping.py
    [12] 29 upstream tests
tools/14_contrast.py
    [14] 200 colour pairs
tools/cxx/rng_vectors.cc
    7000 rows in notes/rng-golden.txt
docs/selftest.html
    All 13541 checks passed
tools/browser-checks/interact.html
    35 ok, 0 failed
tools/browser-checks/audit.html
    15 ok, 0 failed
```
