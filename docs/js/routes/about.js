// Provenance. Where the reference is, what was pinned, how every number on the
// site was made, and how to make it again.

import { h, clear, panel } from '../dom.js';
import { state, on } from '../store.js';

function rows(pairs) {
  return h('table', { class: 'prov' }, h('tbody', {},
    ...pairs.map(([k, v]) => h('tr', {}, h('th', {}, k), h('td', {}, v)))));
}

export function mount(root) {
  clear(root);
  const host = h('div', { class: 'route-prose' });
  root.append(host);

  function render() {
    const m = state.manifest;
    const r = m.reference;
    const t = m.toolchain;
    clear(host);

    host.append(h('h1', {}, 'How this was made'));
    host.append(h('p', {},
      'Every number on this site was produced by a program that links Google’s '
      + 'cuckoo hashing sources without changing them. The browser holds no hashing '
      + 'code and no modular arithmetic on the path that draws the recorded runs. It '
      + 'reads values out of files and puts them on the screen.'));

    host.append(h('h2', {}, 'A correction to start with'));
    host.append(h('p', {},
      'Google’s open-source cuckoo hashing is often said to live in ',
      h('code', {}, 'google/private-join-and-compute'), '. It does not. A clone of '
      + 'that repository at commit 950c5e4 contains no file and no line that mentions '
      + 'cuckoo hashing. Its crypto directory holds the BigNum, Paillier, '
      + 'elliptic-curve commutative cipher, ElGamal and Camenisch-Shoup machinery for '
      + 'private intersection-sum, and none of that uses a cuckoo table.'));
    host.append(h('p', {},
      'The code is in the sibling repository for private information retrieval, ',
      h('a', { href: r.repo, rel: 'noopener' }, 'google/distributed_point_functions'),
      ', under ', h('code', {}, 'pir/hashing/'), '. The header guards there still read '
      + 'PRIVACY_PRIVATE_MEMBERSHIP_INTERNAL_HASHING, which shows the code came out of '
      + 'Google’s private-membership stack.'));

    host.append(h('h2', {}, 'What is pinned'));
    host.append(rows([
      ['repository', h('a', { href: r.repo, rel: 'noopener' }, r.repo)],
      ['commit', r.commit],
      ['license', r.license],
      ['module', r.module],
      ['abseil', `${t.abseil} (the version the reference itself pins)`],
      ['BoringSSL, pinned by the reference', t.boringsslPinnedByReference],
      ['protobuf, pinned by the reference', t.protobufPinnedByReference],
      ['googletest, pinned by the reference', t.googletestPinnedByReference],
      ['compiler used here', t.compiler],
      ['SHA-256 used here', t.sha256Provider],
      ['host', `${t.host}, ${t.endianness}-endian`],
      ['reference commit date', m.derivedFrom.referenceCommitDate],
    ]));
    host.append(h('div', { class: 'note' }, t.sha256Note));
    host.append(h('p', { class: 'hint' }, m.derivedFrom.note));

    host.append(h('h2', {}, 'The algorithm, in one place'));
    host.append(rows([
      ['random numbers', m.algorithm.rng],
      ['hash function index', m.algorithm.indexMapping],
      ['hash', m.algorithm.hash],
    ]));
    host.append(h('p', {},
      'The second row is the one that needed care. The distribution’s unsigned type '
      + 'comes from the width of an int, so it is 32 bits wide and it uses the low half '
      + 'of each 64-bit word. A 64-bit reading gives different indexes and therefore a '
      + 'different table. The project records golden draws from the real library and '
      + 'checks two other implementations against them.'));

    host.append(h('h2', {}, 'Three implementations, one answer'));
    host.append(h('p', {},
      'The claim this site makes is that its values are the reference’s values. The '
      + 'evidence is that three separate implementations agree on all of them.'));
    host.append(h('ol', {},
      h('li', {}, h('b', {}, 'The recorder checks itself. '),
        'It recomputes each digest and each division, and asserts the result equals '
        + 'what the reference returned. A shadow generator predicts which hash function '
        + 'the table will use, and a shadow table is compared against the real one '
        + 'after every insert. Any disagreement stops the run, so the failure mode is '
        + 'no data rather than wrong data.'),
      h('li', {}, h('b', {}, 'A second implementation, in Python. '),
        h('code', {}, 'tools/04_verify.py'), ' recomputes every field of every trace '
        + 'with hashlib, a Mersenne Twister written from the standard, and a '
        + 'transcription of the library mapping. It runs in continuous integration.'),
      h('li', {}, h('b', {}, 'A third implementation, in the browser. '),
        h('a', { href: 'selftest.html' }, 'The self-test page'),
        ' replays every trace through the port that the sandbox uses and compares the '
        + 'result field by field. The sandbox, the load-factor lab and the comparison '
        + 'panel each run the same check against one recorded trace before they draw '
        + 'anything, and they say so on the badge if it does not pass.')));
    host.append(h('p', {},
      h('a', { href: 'selftest.html' }, 'Run the self-test now')));

    host.append(h('h2', {}, 'Where each panel gets its numbers'));
    host.append(h('table', { class: 'prov' }, h('tbody', {},
      h('tr', {}, h('th', {}, h('span', { class: 'badge recorded' }, 'recorded from C++')),
        h('td', {}, 'The tour, the explorer, the hash page and the lookup page. Read '
          + 'from a file, never computed here.')),
      h('tr', {}, h('th', {}, h('span', { class: 'badge sandbox' }, 'computed in the browser')),
        h('td', {}, 'The sandbox, the load-factor lab, and the side-by-side comparison. '
          + 'A port of the reference, checked against every recorded trace.')),
      h('tr', {}, h('th', {}, h('span', { class: 'badge textbook' }, 'textbook')),
        h('td', {}, 'One panel on the variants page, which runs rules the reference '
          + 'does not have. It is an extension, not reference behavior.')))));

    host.append(h('h2', {}, 'The scenarios'));
    host.append(h('div', { class: 'panel-scroll' }, h('table', { class: 'filetab' },
      h('thead', {}, h('tr', {}, h('th', {}, 'id'), h('th', {}, 'structure'),
        h('th', {}, 'm'), h('th', {}, 'k'), h('th', {}, 'budget'),
        h('th', {}, 'bytes'), h('th', {}, 'sha256'))),
      h('tbody', {}, ...m.scenarios.map((sc) => h('tr', {},
        h('td', {}, h('a', { href: `#/table?s=${sc.id}` }, sc.id)),
        h('td', {}, sc.structure),
        h('td', {}, String(sc.numBuckets)),
        h('td', {}, String(sc.numHashFunctions)),
        h('td', {}, String(sc.maxRelocations)),
        h('td', {}, String(sc.bytes)),
        h('td', {}, sc.sha256.slice(0, 12) + '…')))))));

    host.append(h('h2', {}, 'The source files'));
    host.append(h('div', { class: 'panel-scroll' }, h('table', { class: 'filetab' },
      h('thead', {}, h('tr', {}, h('th', {}, 'file'), h('th', {}, 'bytes'),
        h('th', {}, 'sha256'))),
      h('tbody', {}, ...Object.entries(r.files).map(([path, f]) => h('tr', {},
        h('td', {}, h('a', { href: f.permalink, rel: 'noopener' }, path)),
        h('td', {}, String(f.bytes)),
        h('td', {}, f.sha256.slice(0, 16) + '…')))))));

    host.append(h('h2', {}, 'Make every byte again'));
    host.append(h('p', {},
      'The pipeline is a set of numbered scripts, and each one fails loudly rather '
      + 'than carrying on. You need git, cmake, a C++17 compiler, OpenSSL headers, '
      + 'python3 and about ten minutes.'));
    host.append(h('pre', { class: 'cmd' },
      'git clone <this repository>\n'
      + 'cd cuckoo-hashing\n'
      + './tools/00_fetch_reference.sh   # clone and pin the reference, hash every file\n'
      + './tools/01_build.sh             # abseil at the pinned version, then the harness\n'
      + './tools/02_extract_source.py    # slice the pristine source for the code panel\n'
      + './tools/03_generate.sh          # record every trace, and the golden draws\n'
      + './tools/04_verify.py            # re-derive every field, in Python\n'
      + './tools/05_conformance.sh       # behavior tests against the reference\n'
      + '\n'
      + './tools/06_all.sh               # all of the above, in order\n'));
    host.append(h('p', {},
      'The result is byte-for-byte the ', h('code', {}, 'docs/data/'),
      ' directory that this site serves. Continuous integration runs the same '
      + 'commands and fails if a single byte differs.'));

    host.append(h('h2', {}, 'License and credit'));
    host.append(h('p', {},
      'The source excerpts are Copyright 2023 Google LLC, under the Apache License 2.0 (',
      h('a', { href: 'data/source/LICENSE-dpf.txt' }, 'full text'),
      '). The site code is under the MIT license.'));
    host.append(h('p', { class: 'hint' },
      'The stash analysis follows Adam Kirsch, Michael Mitzenmacher and Udi Wieder, '
      + '"More Robust Hashing: Cuckoo Hashing with a Stash", SIAM Journal on Computing '
      + '39(4), 2009. The textbook comparison follows Rasmus Pagh and Flemming Friche '
      + 'Rodler, "Cuckoo Hashing", Journal of Algorithms 51(2), 2004.'));
  }

  render();
  const unsubs = [on('structure', () => { if (state.route === 'about') render(); })];
  return { unmount() { for (const off of unsubs) off(); } };
}
