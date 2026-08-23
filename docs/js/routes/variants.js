// The other two structures in the same module, a side-by-side comparison of
// all three over one stream of elements, and a clearly-marked textbook mode
// that is not the reference.

import { h, clear, panel } from '../dom.js';
import { state, on } from '../store.js';
import { hName } from '../fmt.js';
import { run, runTextbook, engine, verifyAgainst } from '../engine/cuckoo.js';

const COMPARE_ELEMENTS = ['ant', 'bee', 'cat', 'dog', 'eel', 'fox'];
const COMPARE_M = 6;

function bucketGrid(buckets, cap) {
  const g = h('div', { class: 'buckets' });
  buckets.forEach((b, i) => {
    const box = h('div', { class: 'bucket' + (cap !== null && b.length > cap ? ' overfull' : '') });
    box.append(h('b', {}, h('span', {}, String(i)), h('span', {}, String(b.length))));
    for (const e of b) box.append(h('span', { class: 'chipbox' }, e));
    g.append(box);
  });
  return g;
}

function slotRow(table) {
  const g = h('div', { class: 'buckets' });
  table.forEach((v, i) => {
    const box = h('div', { class: 'bucket' });
    box.append(h('b', {}, h('span', {}, String(i)), h('span', {}, v === null ? '' : '1')));
    if (v !== null) box.append(h('span', { class: 'chipbox' }, v));
    g.append(box);
  });
  return g;
}

export function mount(root) {
  clear(root);
  const shell = h('div', { class: 'route' });
  const host = h('div', { class: 'route-prose', style: 'padding-left:0;padding-right:0' });
  const wide = h('div', {});
  shell.append(host, wide);
  root.append(shell);

  function render() {
    clear(host);
    clear(wide);
    verifyAgainst(state.trace);
    host.append(h('h1', {}, 'The other two tables, and the textbook'));
    host.append(h('p', {},
      'The reference module holds three structures. They solve the same problem with '
      + 'three different rules, and a private-lookup protocol uses two of them at once.'));

    // --- the three, side by side, over the same stream ---------------------
    const cuckoo = run({
      structure: 'cuckoo', numBuckets: COMPARE_M, k: 3, maxRelocations: 6,
      maxStashSize: null, elements: COMPARE_ELEMENTS,
    });
    const mcht = run({
      structure: 'multiple_choice', numBuckets: COMPARE_M, k: 2,
      elements: COMPARE_ELEMENTS,
    });
    const simple = run({
      structure: 'simple', numBuckets: COMPARE_M, k: 2, elements: COMPARE_ELEMENTS,
    });

    wide.append(panel('The same six words, three rules',
      h('span', { class: engine.verified === false ? 'badge fail' : 'badge sandbox' },
        engine.verified === false ? 'engine did not pass its self-test'
          : 'computed in the browser'),
      h('div', { class: 'cmp' },
        h('div', {},
          h('h3', {}, 'CuckooHashTable'),
          h('p', { class: 'hint' },
            'One element per bucket. On a collision it evicts and walks. '
            + `k = 3, budget = 6.`),
          slotRow(cuckoo.finalTable),
          h('p', { class: 'hint' },
            'stash: ' + (cuckoo.finalStash.length ? cuckoo.finalStash.join(', ') : 'empty'))),
        h('div', {},
          h('h3', {}, 'MultipleChoiceHashTable'),
          h('p', { class: 'hint' },
            'Many elements per bucket. It measures all k and takes the least '
            + 'loaded. Nothing moves. k = 2.'),
          bucketGrid(mcht.finalBuckets, null)),
        h('div', {},
          h('h3', {}, 'SimpleHashTable'),
          h('p', { class: 'hint' },
            'One copy per hash function, in every candidate bucket. k = 2.'),
          bucketGrid(simple.finalBuckets, null))),
      h('p', { class: 'hint', style: 'margin-top:.6rem' },
        'The numbers here are computed in your browser by a port of the reference. '
        + 'The self-test replays every recorded trace through that port and compares '
        + 'the result byte for byte.')));

    const rest = h('div', { class: 'route-prose', style: 'padding-left:0;padding-right:0' });
    wide.append(rest);
    rest.append(h('h2', {}, 'Bucketing: the least loaded of k'));
    rest.append(h('p', {},
      'MultipleChoiceHashTable measures every candidate bucket, in the fixed order '
      + `${hName(0)}, ${hName(1)}, and so on, and puts the element in the smallest `
      + 'one. The test is a strict "less than", so when two counts are equal the '
      + 'first one keeps the choice. There is no random draw and no eviction.'));
    rest.append(h('p', {},
      'That makes it simpler and its cost more even, but a reader must now scan a '
      + 'whole bucket instead of one slot.'));
    rest.append(h('p', {},
      h('a', { href: '#/table?s=MC-least-loaded' }, 'Step through a bucketed build'),
      ' · ',
      h('a', { href: '#/table?s=MC-bucket-full' }, 'See the capacity failure')));

    rest.append(h('h2', {}, 'Simple hashing: one copy per function'));
    rest.append(h('p', {},
      'SimpleHashTable stores the element in every candidate bucket, so it holds k '
      + 'copies of everything. It is the server side of the pair: whichever bucket a '
      + 'cuckoo-hashing client asks for, the server’s matching bucket holds the '
      + 'element.'));
    rest.append(h('div', { class: 'note' },
      h('b', {}, 'A detail that matters. '),
      'The capacity check runs over every candidate before anything is appended. When '
      + 'two hash functions give the same bucket, that bucket is measured twice at its '
      + 'old size, so a bucket one below the limit accepts two more elements and ends '
      + 'above it. ',
      h('a', { href: '#/table?s=SH-overflow' }, 'The recorded case')));
    rest.append(h('p', {},
      h('a', { href: '#/table?s=SH-fanout' }, 'Step through a simple-hashing build')));

    // --- textbook mode ------------------------------------------------------
    rest.append(h('h2', {}, 'Textbook mode'));
    rest.append(h('p', {},
      'Pagh and Rodler’s construction differs from this code in two ways. It looks '
      + 'at every candidate bucket and takes an empty one if there is one. And when a '
      + 'walk fails it makes a new set of hash functions and builds the whole table '
      + 'again.'));
    rest.append(h('p', {},
      'The reference does neither. It draws one function at random each time, and its '
      + 'answer to a failed walk is the stash. The panel below runs the textbook rules '
      + 'so the difference is visible. It is not the reference, and it is marked.'));

    const tbHost = h('div', {});
    const nEls = ['ant', 'bee', 'cat', 'dog', 'eel', 'fox', 'gnu', 'hen'];
    function renderTextbook(m) {
      clear(tbHost);
      const res = runTextbook({ numBuckets: m, k: 2, elements: nEls, maxRelocations: m });
      tbHost.append(h('p', {},
        `${nEls.length} elements into ${m} buckets, k = 2. Load factor `
        + `${(nEls.length / m).toFixed(2)}.`));
      const rows = res.epochs.map((e) => h('tr', {},
        h('td', { class: 'w' }, String(e.epoch + 1)),
        h('td', {}, e.seedPrefix),
        h('td', {}, String(e.inserted)),
        h('td', {}, e.failedOn === null ? 'complete' : `stuck on "${e.failedOn}"`)));
      tbHost.append(h('div', { class: 'panel-scroll' }, h('table', { class: 'cand-tab' },
        h('thead', {}, h('tr', {}, h('th', {}, 'build'), h('th', {}, 'seed prefix'),
          h('th', {}, 'placed'), h('th', {}, 'outcome'))),
        h('tbody', {}, ...rows))));
      tbHost.append(h('p', {},
        res.ok
          ? `Build ${res.epochs.length} succeeded. Every earlier build was thrown away.`
          : `No build succeeded within ${res.epochs.length} attempts at this load factor.`));
      tbHost.append(slotRow(res.table));
    }
    const sizes = [10, 12, 9, 8];
    const picker = h('div', { class: 'cfg-row' },
      h('label', { for: 'tb-m' }, 'buckets'),
      h('select', { id: 'tb-m', onchange: (e) => renderTextbook(Number(e.target.value)) },
        ...sizes.map((m) => h('option', { value: String(m) }, String(m)))));
    renderTextbook(sizes[0]);
    wide.append(panel('Rehash and retry',
      h('span', { class: 'badge textbook' }, 'textbook, not the Google reference'),
      picker, tbHost,
      h('p', { class: 'hint' },
        'Every element on this panel carries the textbook badge. The manifest lists it '
        + 'as an extension, not as reference behavior.')));

    rest.append(h('h2', {}, 'Two columns'));
    const rows = [
      ['choosing a bucket', 'draws one hash function at random, every attempt',
        'looks at all k and takes an empty one if there is one'],
      ['on a failed walk', 'puts the element on a stash', 'makes new hash functions and builds again'],
      ['duplicates', 'accepted, and a key can occupy two slots', 'usually rejected by a membership test'],
      ['deletion', 'not implemented', 'clear the slot the key is in'],
      ['cycle detection', 'a counter only: max_relocations attempts', 'often the same counter, then a rebuild'],
      ['worst case for a lookup', 'k buckets, then the stash', 'k buckets'],
    ];
    rest.append(h('div', { class: 'panel-scroll' }, h('table', { class: 'prov' },
      h('thead', {}, h('tr', {}, h('th', {}, ''), h('th', {}, 'this reference'),
        h('th', {}, 'Pagh and Rodler, 2004'))),
      h('tbody', {}, ...rows.map((r) => h('tr', {},
        h('th', {}, r[0]), h('td', {}, r[1]), h('td', {}, r[2])))))));

    rest.append(h('h2', {}, 'Why a protocol wants both'));
    rest.append(h('p', {},
      'In the private-lookup protocol the client cuckoo-hashes its queries and the '
      + 'server simple-hashes its database. The client asks for exactly one bucket per '
      + 'hash function. The server put a copy of every record in every one of its '
      + 'candidate buckets, so whichever bucket the client asks for, the answer is '
      + 'there. Neither side learns which key the other meant.'));
    rest.append(h('div', { class: 'note' },
      h('b', {}, 'The stash is the weak point. '),
      'The database builder copies only the table. A key that the walk pushed onto the '
      + 'stash is not in the served database at all, and a query for it returns nothing. '
      + 'Three hash functions, 1.5 buckets per element and a budget equal to the number '
      + 'of records make that outcome very unlikely, and the code does not check for it.'));
  }

  render();
  const unsubs = [on('structure', () => { if (state.route === 'variants') render(); })];
  return { unmount() { for (const off of unsubs) off(); } };
}
