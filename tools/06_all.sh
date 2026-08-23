#!/usr/bin/env bash
# Rebuild every byte of docs/data/ from the pinned reference, and check it.
# Any failure anywhere stops the run.
#
# Inputs, committed and reviewed, that this script only checks:
#   content/tour.json                 the tour prose
#   tools/scenarios.txt               which words go into which run
#   tools/scenario-predicates.json    what each run was measured to contain
#
# Outputs, rebuilt from nothing every time:
#   docs/data/                        every trace, the manifest, the source slices
#   notes/pins.json                   the per-file hashes of the reference
#   notes/rng-golden.txt              golden index draws from the real abseil
#   notes/test-mapping.md             upstream tests mapped to conformance checks
#   notes/reference-sources.tar.gz    the archived reference sources
#   notes/reference-test-run/         the upstream suite's own output
#
# Two clean checkouts running this script produce identical outputs. That is
# what makes the diff gate in continuous integration mean something.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${REPO_ROOT}"

./tools/00_fetch_reference.sh
./tools/01_build.sh
python3 tools/02_extract_source.py
python3 tools/mine.py --check
./tools/03_generate.sh
python3 tools/04_verify.py
./tools/05_conformance.sh
./tools/07_run_reference_tests.sh
python3 tools/12_check_mapping.py
python3 tools/15_archive_pins.py
python3 tools/10_ste_check.py
python3 tools/14_contrast.py
python3 tools/11_stamp_assets.py

echo
echo "[06] everything is rebuilt and checked."
echo
echo "     The browser checks need a server and chromium, so run them separately:"
echo "       python3 tools/serve.py 8791 &"
echo "       python3 tools/08_browser_check.py 8791"
echo "       python3 tools/13_qa.py 8791        # needs tools/qa/node_modules"
echo "       python3 tools/16_counters.py       # collect every layer's own count"
