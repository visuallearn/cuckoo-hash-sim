// The bucketed tables: MultipleChoiceHashTable and SimpleHashTable. Each bucket
// is a stack that grows. Nothing is ever evicted, so there is no walker.

import { h, clear, panel } from '../dom.js';
import { provenanceBadge } from './badges.js';
import { hName } from '../fmt.js';

export function make(kind) {
  const el = h('div', { class: 'p-table' });
  let host = null;
  let capNote = null;

  function build(vm) {
    clear(el);
    host = h('div', { class: 'buckets' });
    capNote = h('span', { class: 'hint' });
    el.append(panel(kind === 'multiple_choice' ? 'The buckets' : 'The buckets, one copy per hash function',
      [provenanceBadge(vm),
       h('span', { style: 'margin-left:auto' }, capNote)],
      host,
      h('div', { class: 'tbl-legend' },
        h('span', { class: 'l-free' }, 'a bucket'),
        h('span', { class: 'l-probe' }, 'a candidate this step'),
        h('span', { class: 'l-held' }, 'an element at rest'))));
  }

  function update(vm) {
    const t = vm.trace;
    const f = vm.frame;
    const cap = t.params.maxBucketSize;
    const cands = f.candidateBuckets || [];
    const chosen = f.st.kind === 'choose' ? f.st.bucket
      : (f.st.kind === 'append' ? f.st.bucket : null);
    const freshFrom = f.st.kind === 'append' ? f.st.element : null;

    clear(host);
    f.buckets.forEach((bucket, i) => {
      let cls = 'bucket';
      if (cands.includes(i)) cls += ' cand';
      if (chosen === i) cls += ' chosen';
      if (cap !== null && bucket.length > cap) cls += ' overfull';
      const box = h('div', { class: cls });
      const which = cands
        .map((b, j) => (b === i ? hName(j) : null))
        .filter(Boolean).join(' ');
      box.append(h('b', {}, h('span', {}, String(i)),
        h('span', {}, which || (cap === null ? '' : `${bucket.length}/${cap}`))));
      let seen = 0;
      for (const e of bucket) {
        const fresh = freshFrom === e && seen === bucket.length - 1;
        box.append(h('span', { class: 'chipbox' + (fresh ? ' fresh' : '') }, e));
        seen++;
      }
      host.append(box);
    });

    const total = f.buckets.reduce((a, b) => a + b.length, 0);
    const over = cap === null ? 0 : f.buckets.filter((b) => b.length > cap).length;
    capNote.textContent = cap === null
      ? `${total} stored, no bucket limit`
      : `${total} stored, limit ${cap} per bucket${over ? `, ${over} over the limit` : ''}`;
    host.setAttribute('role', 'img');
    host.setAttribute('aria-label',
      f.buckets.map((b, i) => `${i}: ${b.length ? b.join(', ') : 'empty'}`).join('. '));
  }

  return { el, build, update };
}
