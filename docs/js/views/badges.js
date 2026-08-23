// Recorded data and computed data must never look the same, on any panel.

import { h } from '../dom.js';

export function provenanceBadge(vm) {
  const sandbox = vm && vm.trace && vm.trace.provenance === 'sandbox';
  return h('span', { class: sandbox ? 'badge sandbox' : 'badge recorded' },
    sandbox ? 'computed in the browser' : 'recorded from C++');
}
