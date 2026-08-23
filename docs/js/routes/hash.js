// One element, one hash function, every intermediate value. The numbers come
// out of the recorded traces, so this page computes nothing.

import { h, clear, panel } from '../dom.js';
import { state, set, on } from '../store.js';
import { hName, hexBytes, groupDigits } from '../fmt.js';

/** Every recorded hash step in the loaded trace, keyed by element and function. */
function index(trace) {
  const map = new Map();
  for (const op of trace.ops) {
    for (const st of op.steps) {
      if (st.kind !== 'hash') continue;
      map.set(st.input + ' ' + st.j, st);
    }
  }
  return map;
}

export function mount(root) {
  clear(root);
  const host = h('div', { class: 'route-prose' });
  root.append(host);

  function render() {
    const trace = state.trace;
    const map = index(trace);
    const elements = [...new Set([...map.keys()].map((x) => x.slice(0, x.lastIndexOf(' '))))];
    if (!elements.includes(state.hashElement)) state.hashElement = elements[0];
    const k = trace.params.numHashFunctions;
    if (state.hashFunction >= k) state.hashFunction = 0;
    const st = map.get(state.hashElement + ' ' + state.hashFunction);

    clear(host);
    host.append(h('h1', {}, 'From a word to a bucket'));
    host.append(h('p', {},
      'A hash function here is SHA-256, with a seed in front of the input. The 32 bytes '
      + 'of the digest become one 256-bit number. That number is then reduced to the '
      + 'range of the table.'));

    host.append(h('div', { class: 'cfg-row' },
      h('label', { for: 'hx-el' }, 'element'),
      h('select', {
        id: 'hx-el', onchange: (e) => set({ hashElement: e.target.value }),
      }, ...elements.map((x) => h('option', {
        value: x, selected: x === state.hashElement ? true : null,
      }, x))),
      h('label', { for: 'hx-fn' }, 'hash function'),
      h('select', {
        id: 'hx-fn', onchange: (e) => set({ hashFunction: Number(e.target.value) }),
      }, ...Array.from({ length: k }, (_, j) => h('option', {
        value: String(j), selected: j === state.hashFunction ? true : null,
      }, hName(j)))),
      h('span', { class: 'hint' },
        `scenario ${trace.id}, m = ${trace.params.numBuckets}`)));

    if (!st) {
      host.append(h('p', { class: 'hint' },
        'This scenario has no recorded evaluation of that pair. Select another one.'));
      return;
    }

    host.append(panel('1. the bytes that go into SHA-256',
      h('span', { class: 'badge recorded' }, 'recorded'),
      h('div', { class: 'math-lines' },
        h('div', { class: 'math-line' }, h('span', { class: 'lbl' }, 'seed'),
          h('span', { class: 'm' }, `"${st.seed}"   ${st.seedHex}`)),
        h('div', { class: 'math-line' }, h('span', { class: 'lbl' }, 'input'),
          h('span', { class: 'm' }, `"${st.input}"`)),
        h('div', { class: 'math-line' }, h('span', { class: 'lbl' }, 'together'),
          h('span', { class: 'm' }, st.preimageHex))),
      h('p', { class: 'hint' },
        'The seed is absorbed once, when the hash function is made. Each call continues '
        + 'from that saved state, so the seed is a prefix of the message.')));

    const strip = h('div', { class: 'bytes' });
    hexBytes(st.digestHex).forEach((b, i) => {
      strip.append(h('i', {
        class: (i < 16 ? 'lo' : 'hi') + (i < 8 ? ' d3' : (i < 16 ? ' d2' : '')),
        title: `byte ${i} = 0x${b} = ${parseInt(b, 16)}`,
      }, b));
    });
    host.append(panel('2. the digest, and how it is read',
      h('span', { class: 'badge recorded' }, 'recorded'),
      h('p', { class: 'm', style: 'overflow-wrap:anywhere' }, st.digestHex),
      strip,
      h('div', { class: 'byte-key' },
        h('span', { class: 'k-lo' }, h('b', {}, 'bytes 0 to 15'), ' become lo'),
        h('span', { class: 'k-hi' }, h('b', {}, 'bytes 16 to 31'), ' become hi')),
      h('div', { class: 'math-lines', style: 'margin-top:.5rem' },
        h('div', { class: 'math-line' }, h('span', { class: 'lbl' }, 'lo'),
          h('span', { class: 'm' }, st.loHex)),
        h('div', { class: 'math-line' }, h('span', { class: 'lbl' }, 'hi'),
          h('span', { class: 'm' }, st.hiHex)),
        h('div', { class: 'math-line' }, h('span', { class: 'lbl' }, 'N'),
          h('span', { class: 'm' }, groupDigits(st.nDec)))),
      h('p', { class: 'hint' },
        'Byte 0 is the least significant byte. The reference copies raw memory into two '
        + '128-bit values, so this reading order is the byte order of the machine. A '
        + 'big-endian host gives different buckets, and the trace generator asserts that '
        + 'its host is little-endian.')));

    const lad = st.ladder;
    host.append(panel('3. the reduction, in three steps',
      h('span', { class: 'badge recorded' }, 'recorded'),
      h('div', { class: 'panel-scroll' }, h('table', { class: 'ladder-tab' },
        h('thead', {}, h('tr', {}, h('th', {}, 'step'), h('th', {}, 'value'),
          h('th', {}, 'mod ' + st.m), h('th', {}, 'source line'))),
        h('tbody', {},
          h('tr', {}, h('td', {}, 'd1 = hi'),
            h('td', { class: 'v' }, groupDigits(BigInt(st.hiHex).toString(10))),
            h('td', { class: 'v' }, String(lad.r1)),
            h('td', { class: 'ln' }, 'sha256_hash_family.cc:' + lad.r1Line)),
          h('tr', {}, h('td', {}, 'd2 = r1 * 2^64 + high half of lo'),
            h('td', { class: 'v' }, groupDigits(lad.d2)),
            h('td', { class: 'v' }, String(lad.r2)),
            h('td', { class: 'ln' }, 'sha256_hash_family.cc:' + lad.r2Line)),
          h('tr', { class: 'res' }, h('td', {}, 'd3 = r2 * 2^64 + low half of lo'),
            h('td', { class: 'v' }, groupDigits(lad.d3)),
            h('td', { class: 'v' }, String(lad.r3)),
            h('td', { class: 'ln' }, 'sha256_hash_family.cc:' + lad.r3Line))))),
      h('p', {}, 'The answer is ', h('b', {}, String(st.bucket)),
        `, and it is equal to N mod ${st.m}.`),
      h('p', { class: 'hint' },
        'A machine divides at most 128 bits at a time. The reference therefore reduces '
        + 'the 256-bit number with three 128-bit divisions, in base 2^64. The remainder '
        + 'of each step becomes the top half of the next dividend.')));

    const all = trace.candidates[st.input];
    host.append(panel('the complete candidate set', null,
      h('p', {}, `"${st.input}" can live in `,
        h('b', {}, all.map((b, j) => `${hName(j)} = ${b}`).join(', ')), '.'),
      new Set(all).size < all.length
        ? h('p', { class: 'hint' },
          'Two of those agree, so this element has fewer homes than the table has hash '
          + 'functions. Nothing in the reference sees that or corrects it.')
        : null,
      h('p', {}, h('a', { href: `#/table?s=${trace.id}` }, 'See the walk that uses them'))));
  }

  render();
  const unsubs = [on('structure', () => { if (state.route === 'hash') render(); })];
  return { unmount() { for (const off of unsubs) off(); } };
}
