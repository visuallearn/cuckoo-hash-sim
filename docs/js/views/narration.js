// One or two sentences about the current step, and the same text in a live
// region for a screen reader.

import { h, clear, add } from '../dom.js';
import { narrate } from '../narrate.js';

export function make() {
  const el = h('div', { class: 'p-narr' });
  let box = null;

  function build() {
    clear(el);
    box = h('div', { class: 'narr' });
    el.append(box);
  }

  function update(vm) {
    const n = narrate(vm.trace, vm.frame);
    box.className = 'narr' + (n.tone ? ' ' + n.tone : '');
    clear(box);
    add(box, h('b', {}, n.title), n.detail ? h('span', { class: 'sub' }, n.detail) : null);
    const live = document.getElementById('live');
    if (live) live.textContent = n.title + ' ' + n.detail;
    if (vm.frame.mismatch) {
      box.append(h('span', { class: 'sub', style: 'color:var(--fail)' },
        'Warning: ' + vm.frame.mismatch));
    }
  }

  return { el, build, update };
}
