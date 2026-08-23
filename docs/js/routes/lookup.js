// Finding a key. The table class has no lookup of its own, so this is the
// client's code path: compute all k indices and read those buckets.

import { h, clear, panel } from '../dom.js';
import { state, set, on } from '../store.js';
import { hName } from '../fmt.js';
import { flatten } from '../replay.js';

function lookupOps(trace) {
  return trace.ops
    .map((op, i) => ({ op, i }))
    .filter((x) => x.op.op === 'lookup');
}

export function mount(root) {
  clear(root);
  const host = h('div', { class: 'route-prose' });
  root.append(host);

  function render() {
    const trace = state.trace;
    const flat = flatten(trace);
    const ops = lookupOps(trace);
    clear(host);

    host.append(h('h1', {}, 'Finding a key'));
    host.append(h('p', {},
      'A cuckoo table gives every key a small, fixed set of homes. A lookup reads those '
      + 'homes and nothing else, so its cost does not grow with the number of keys.'));
    host.append(h('p', {},
      'The reference class has no lookup method. The code below is the client of the '
      + 'private-information-retrieval protocol, which is the only place the reference '
      + 'reads a cuckoo table back.'));

    const withLookups = state.manifest.scenarios.filter(
      (s) => s.structure === 'cuckoo');
    host.append(h('div', { class: 'cfg-row' },
      h('label', { for: 'lk-sc' }, 'scenario'),
      h('select', {
        id: 'lk-sc', onchange: (e) => set({ scenario: e.target.value, step: 0 }),
      }, ...withLookups.map((s) => h('option', {
        value: s.id, selected: s.id === state.scenario ? true : null,
      }, s.title)))));

    if (!ops.length) {
      host.append(h('p', { class: 'hint' },
        'This scenario records no lookup. Scenarios that do are "Four words, six '
        + 'buckets", "The same key twice", and "The production recipe, at eight '
        + 'elements".'));
      return;
    }

    const k = trace.params.numHashFunctions;
    for (const { op, i } of ops) {
      const probes = op.steps.filter((s) => s.kind === 'probe');
      const scan = op.steps.find((s) => s.kind === 'stash_scan');
      const start = flat.opStarts.find((o) => o.opIndex === i).s;
      const rows = probes.map((p) => h('tr', { class: p.match ? 'on' : '' },
        h('td', { class: 'w' }, hName(p.j)),
        h('td', {}, String(p.bucket)),
        h('td', {}, p.occupant === null ? 'empty' : p.occupant),
        h('td', {}, p.match ? 'match' : 'no')));
      host.append(panel(
        `${op.foundInTable ? 'A hit' : 'A miss'}: looking for "${op.arg}"`,
        h('span', { class: op.foundInTable ? 'badge recorded' : 'badge' },
          op.foundInTable ? `found in bucket ${op.bucket}` : 'not in the table'),
        h('div', { class: 'panel-scroll' }, h('table', { class: 'cand-tab' },
          h('thead', {}, h('tr', {}, h('th', {}, 'function'), h('th', {}, 'bucket'),
            h('th', {}, 'holds'), h('th', {}, 'is the query'))),
          h('tbody', {}, ...rows))),
        h('p', { style: 'margin-top:.5rem' },
          `${k} probes, always. Then the stash: `,
          scan && scan.foundAt >= 0
            ? h('b', {}, `the key is on the stash at position ${scan.foundAt}.`)
            : `${scan ? scan.stashSize : 0} entries, no match.`),
        op.foundInStash
          ? h('div', { class: 'note' },
            h('b', {}, 'This key is only on the stash. '),
            'The production database copies only the table into the served database, so '
            + 'a reader there cannot get this key at all. The parameters are chosen '
            + 'so the stash stays empty.')
          : null,
        h('p', {}, h('a', { href: `#/table?s=${trace.id}&step=${start}` },
          'Step through this lookup in the explorer'))));
    }

    host.append(h('h2', {}, 'Why a lookup cannot be cheaper'));
    host.append(h('p', {},
      'The walk that inserted a key chose one of its k buckets at random, and a later '
      + 'insert can move that key again. Nothing records which bucket won. A reader '
      + 'must therefore look in all k of them.'));
    host.append(h('p', {},
      'That is also what makes the structure useful for private lookups. The client '
      + 'asks for exactly one bucket per hash function, whatever the key is, so the '
      + 'pattern of requests is the same for every query.'));

    host.append(h('h2', {}, 'What the stash costs'));
    host.append(h('p', {},
      'A key on the stash is outside that contract. A reader must scan the stash as '
      + 'well, and a private reader cannot scan anything without giving the query away. '
      + 'The reference deals with this by sizing the table so the stash stays empty: '
      + 'three hash functions, 1.5 buckets per element, and a budget equal to the '
      + 'number of records.'));

  }

  render();
  const unsubs = [on('structure', () => { if (state.route === 'lookup') render(); })];
  return { unmount() { for (const off of unsubs) off(); } };
}
