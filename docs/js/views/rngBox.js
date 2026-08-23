// The draw. One word of the Mersenne Twister becomes one hash-function index.
// Every value shown is recorded; the mapping is only being displayed.

import { h, clear, panel } from '../dom.js';
import { provenanceBadge } from './badges.js';
import { hName, groupDigits } from '../fmt.js';

export function make() {
  const el = h('div', { class: 'p-rng' });
  let body = null;

  function build(vm) {
    clear(el);
    body = h('div', { class: 'rng-lines' });
    el.append(panel('The draw',
      [provenanceBadge(vm), h('span', { class: 'badge' }, 'seed 5489')], body));
  }

  function update(vm) {
    const f = vm.frame;
    const k = vm.trace.params.numHashFunctions;
    clear(body);
    if (vm.trace.structure !== 'cuckoo') {
      body.append(h('p', { class: 'math-empty' },
        'This structure uses no random numbers. It uses every hash function, in order.'));
      return;
    }
    const st = f.st.kind === 'draw' ? f.st : lastDraw(f);
    if (!st) {
      body.append(h('p', { class: 'math-empty' },
        'No draw has happened in this operation yet.'));
      return;
    }

    const word = st.raw[st.raw.length - 1];
    const hex = st.rawHex[st.rawHex.length - 1].replace(/^0x/, '');
    body.append(h('div', {},
      h('span', { class: 'hint' }, 'mt19937_64 word'),
      h('div', { class: 'rng-word' }, groupDigits(word))));
    body.append(h('div', { class: 'rng-word' },
      '0x', h('span', {}, hex.slice(0, 8)), h('span', { class: 'lowhalf' }, hex.slice(8))));
    body.append(h('p', { class: 'hint', style: 'margin:.2rem 0 0' },
      'The distribution uses the low 32 bits, because its unsigned type comes from '
      + 'the width of an int.'));

    const lines = h('div', { class: 'math-lines', style: 'margin-top:.4rem' });
    lines.append(h('div', { class: 'math-line' },
      h('span', { class: 'lbl' }, 'low 32 bits'),
      h('span', { class: 'm' }, groupDigits(st.bits32))));
    if (st.mapKind === 'multiply-shift') {
      lines.append(h('div', { class: 'math-line' },
        h('span', { class: 'lbl' }, `× ${k}`),
        h('span', { class: 'm' }, groupDigits(st.product))));
      lines.append(h('div', { class: 'math-line' },
        h('span', { class: 'lbl' }, 'index' ),
        h('span', { class: 'm' }, st.mapFormula)));
      lines.append(h('div', { class: 'math-line' },
        h('span', { class: 'lbl' }, 'reject if'),
        h('span', { class: 'm' }, `low 32 bits of the product < ${st.rejectThreshold}`
          + `  (they are ${st.productLow32})`)));
    } else {
      lines.append(h('div', { class: 'math-line' },
        h('span', { class: 'lbl' }, 'index'),
        h('span', { class: 'm' }, st.mapFormula)));
      lines.append(h('div', { class: 'math-line' },
        h('span', { class: 'lbl' }, 'reject if'),
        h('span', { class: 'm' }, `never: ${k} is a power of two, so the low bits suffice`)));
    }
    if (st.redraws > 0) {
      lines.append(h('div', { class: 'math-line' },
        h('span', { class: 'lbl' }, 'redraws'),
        h('span', { class: 'm' }, `${st.redraws} word${st.redraws === 1 ? '' : 's'} rejected first`)));
    }
    body.append(lines);

    const choice = h('div', { class: 'rng-choice' });
    for (let j = 0; j < k; j++) {
      choice.append(h('i', { class: j === st.j ? 'on' : '' }, hName(j)));
    }
    body.append(choice);
    body.append(h('p', { class: 'hint' },
      'A new draw happens on every attempt, including the first. The reference never '
      + 'looks for an empty candidate.'));
  }

  return { el, build, update };
}

function lastDraw(f) {
  for (let n = f.local; n >= 0; n--) {
    if (f.op.steps[n].kind === 'draw') return f.op.steps[n];
  }
  return null;
}
