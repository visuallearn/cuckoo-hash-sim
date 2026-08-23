// Everything the animation says, as text. The diagram is never the only place
// a fact appears.

import { h, clear, panel } from '../dom.js';
import { set } from '../store.js';
import { logLine } from '../narrate.js';

export function make() {
  const el = h('div', { class: 'p-log' });
  let body = null;
  let rows = [];
  let lastNow = -1;

  function build(vm) {
    clear(el);
    rows = [];
    const tbody = h('tbody', {});
    vm.flat.steps.forEach((x, i) => {
      const tr = h('tr', { onclick: () => set({ step: i, playing: false }) },
        h('td', { class: 's' }, String(i + 1)),
        h('td', { class: 'k ' + x.st.kind }, x.st.kind),
        h('td', {}, logLine(x.st)));
      rows.push(tr);
      tbody.append(tr);
    });
    // A data table needs headers, or a screen reader reads three unlabelled
    // columns.
    body = h('div', { class: 'log' }, h('table', {},
      h('thead', {}, h('tr', {},
        h('th', { scope: 'col' }, 'step'),
        h('th', { scope: 'col' }, 'event'),
        h('th', { scope: 'col' }, 'what happened'))),
      tbody));
    el.append(panel('Every step, as text', null, body));
    lastNow = -1;
  }

  function update(vm) {
    const i = vm.frame.index;
    if (i === lastNow) return;
    if (rows[lastNow]) rows[lastNow].classList.remove('now');
    const tr = rows[i];
    if (tr) {
      tr.classList.add('now');
      const r = tr.getBoundingClientRect();
      const b = body.getBoundingClientRect();
      if (r.top < b.top || r.bottom > b.bottom) {
        body.scrollTop += (r.top - b.top) - body.clientHeight / 2 + r.height / 2;
      }
    }
    lastNow = i;
  }

  return { el, build, update };
}
