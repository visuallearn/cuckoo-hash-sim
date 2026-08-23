// Scenario picker, the parameters of the loaded trace, and the candidate table.
// The candidate table is static for a scenario: it is the full set of homes
// each element has, computed before the walk starts.

import { h, clear, panel } from '../dom.js';
import { set, state } from '../store.js';
import { hName } from '../fmt.js';

export function make(structures) {
  const el = h('div', { class: 'p-config' });
  let list = null;
  let params = null;
  let cands = null;

  function build(vm) {
    clear(el);
    list = h('div', { class: 'case-list', role: 'group', 'aria-label': 'Scenario' });
    for (const sc of vm.manifest.scenarios) {
      if (structures && !structures.includes(sc.structure)) continue;
      list.append(h('button', {
        type: 'button', dataset: { id: sc.id },
        onclick: () => set({ scenario: sc.id, step: 0, playing: false }),
      }, h('span', {}, sc.title), h('span', { class: 'case-id' }, sc.id)));
    }
    params = h('dl', { class: 'params-list' });
    cands = h('div', {});
    el.append(
      panel('Scenario', null, list),
      panel('Parameters', null, params),
      panel('Where every element can live', null, cands));
  }

  function update(vm) {
    for (const b of list.children) {
      b.setAttribute('aria-pressed', String(b.dataset.id === state.scenario));
    }
    const p = vm.trace.params;
    clear(params);
    const rows = [
      ['buckets, m', String(p.numBuckets)],
      ['hash functions, k', String(p.numHashFunctions)],
    ];
    if (vm.trace.structure === 'cuckoo') {
      rows.push(['relocation budget', String(p.maxRelocations)]);
      rows.push(['stash limit', p.maxStashSize === null ? 'none' : String(p.maxStashSize)]);
    }
    if (p.maxBucketSize !== null) rows.push(['bucket limit', String(p.maxBucketSize)]);
    rows.push(['hash family', p.hashFamily]);
    rows.push(['seeds', p.perFunctionSeeds.map((x) => `"${x}"`).join(' ')]);
    if (p.familySeedHex) rows.push(['session seed', p.familySeedHex]);
    if (vm.trace.structure === 'cuckoo') rows.push(['generator', 'mt19937_64, seed 5489']);
    rows.push(['elements', String(vm.trace.elements.length)]);
    for (const [k, v] of rows) params.append(h('dt', {}, k), h('dd', {}, v));

    clear(cands);
    const names = Object.keys(vm.trace.candidates);
    if (names.length > 28) {
      cands.append(h('p', { class: 'hint' },
        `${names.length} elements. The table is too long to show here. The arrows in `
        + 'the diagram carry the same numbers.'));
      return;
    }
    const k = p.numHashFunctions;
    const head = h('tr', {}, h('th', {}, 'element'),
      ...Array.from({ length: k }, (_, j) => h('th', {}, hName(j))));
    const body = h('tbody', {});
    const active = vm.frame.walkerName;
    for (const name of names) {
      const row = vm.trace.candidates[name];
      const seen = new Map();
      row.forEach((b) => seen.set(b, (seen.get(b) || 0) + 1));
      body.append(h('tr', { class: name === active ? 'on' : '' },
        h('td', { class: 'w' }, name),
        ...row.map((b) => h('td', {
          class: seen.get(b) > 1 ? 'dup' : '',
          title: seen.get(b) > 1 ? 'two hash functions give the same bucket' : '',
        }, String(b)))));
    }
    cands.append(h('div', { class: 'panel-scroll' },
      h('table', { class: 'cand-tab' }, h('thead', {}, head), body)));
    const dupes = names.filter((n) => new Set(vm.trace.candidates[n]).size < k);
    if (dupes.length) {
      cands.append(h('p', { class: 'hint' },
        `${dupes.join(', ')} ${dupes.length === 1 ? 'has' : 'have'} fewer than ${k} `
        + 'different buckets, because two hash functions agree. Amber marks those.'));
    }
  }

  return { el, build, update };
}
