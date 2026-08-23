// The arithmetic of the current step, shown exactly as the reference computes
// it. Every value here is read from the trace. The browser does no hashing and
// no modular arithmetic on this path.

import { h, clear, panel } from '../dom.js';
import { provenanceBadge } from './badges.js';
import { hName, hexBytes, groupDigits, mathLine } from '../fmt.js';

export function make() {
  const el = h('div', { class: 'p-math' });
  let body = null;

  function build(vm) {
    clear(el);
    body = h('div', {});
    el.append(panel('The arithmetic', provenanceBadge(vm), body));
  }

  function update(vm) {
    const f = vm.frame;
    const st = f.st;
    clear(body);
    if (st.kind !== 'hash') {
      const last = lastHash(f);
      if (!last) {
        body.append(h('p', { class: 'math-empty' },
          'This step does no arithmetic. Move to a hash step to see the numbers.'));
        return;
      }
      body.append(h('p', { class: 'hint' }, 'The last hash of this operation:'));
      renderHash(body, last, vm.trace);
      return;
    }
    renderHash(body, st, vm.trace);
  }

  return { el, build, update };
}

function lastHash(f) {
  for (let n = f.local; n >= 0; n--) {
    if (f.op.steps[n].kind === 'hash') return f.op.steps[n];
  }
  return null;
}

function renderHash(root, st, trace) {
  const m = st.m;
  const seedLabel = st.seed === '' ? '""' : `"${st.seed}"`;

  root.append(h('div', { class: 'math-head' },
    h('span', { class: 'm' }, `${hName(st.j)}("${st.input}") `),
    h('span', { class: 'm-op' }, '='),
    h('span', { class: 'm' }, ` LE₂₅₆( SHA-256( ${seedLabel} ‖ "${st.input}" ) ) mod ${m}`),
    h('span', { class: 'm-op' }, '='),
    h('span', { class: 'm m-res', style: 'font-size:1.15rem' }, String(st.bucket))));

  const lines = h('div', { class: 'math-lines' });
  lines.append(mathLine('input bytes', h('span', {}, st.preimageHex),
    h('span', { class: 'hint' }, ` (${st.preimageHex.length / 2} bytes)`)));
  lines.append(mathLine('digest', h('span', {}, st.digestHex)));
  root.append(lines);

  // The byte strip. This is where the reading order is made visible: the
  // reference copies raw memory into two 128-bit values, so byte 0 is the least
  // significant byte of the low half.
  const strip = h('div', { class: 'bytes' });
  const bytes = hexBytes(st.digestHex);
  bytes.forEach((b, i) => {
    const half = i < 16 ? 'lo' : 'hi';
    const ladderPart = i < 8 ? ' d3' : (i < 16 ? ' d2' : '');
    strip.append(h('i', {
      class: half + ladderPart,
      title: `byte ${i} = 0x${b} = ${parseInt(b, 16)}`,
    }, b));
  });
  root.append(h('details', { class: 'math-sec', open: true },
    h('summary', {}, 'the 32 bytes, and which half each one belongs to'),
    strip,
    h('div', { class: 'byte-key' },
      h('span', { class: 'k-lo' }, h('b', {}, 'bytes 0–15'), ' → lo, read little-endian'),
      h('span', { class: 'k-hi' }, h('b', {}, 'bytes 16–31'), ' → hi, read little-endian')),
    h('div', { class: 'math-lines', style: 'margin-top:.4rem' },
      mathLine('lo', h('span', {}, st.loHex)),
      mathLine('hi', h('span', {}, st.hiHex)),
      mathLine('N', h('span', {}, groupDigits(st.nDec)))),
    h('p', { class: 'hint' },
      'The copy is a raw memory copy, so the result depends on the byte order of the '
      + 'host. The reference targets little-endian machines, and the generator asserts '
      + 'that the host it ran on is one.')));

  // The three-step ladder. Hardware division is at most 128-bit wide, so the
  // reference reduces a 256-bit number with three 128-bit divisions.
  const lad = st.ladder;
  const tab = h('table', { class: 'ladder-tab' },
    h('thead', {}, h('tr', {},
      h('th', {}, 'step'), h('th', {}, 'value'), h('th', {}, `mod ${m}`), h('th', {}, 'line'))),
    h('tbody', {},
      h('tr', {},
        h('td', {}, 'd₁ = hi'),
        h('td', { class: 'v' }, groupDigits(BigIntFromHex(st.hiHex))),
        h('td', { class: 'v' }, String(lad.r1)),
        h('td', { class: 'ln' }, ':' + lad.r1Line)),
      h('tr', {},
        h('td', {}, 'd₂ = r₁·2⁶⁴ + hi₆₄(lo)'),
        h('td', { class: 'v' }, groupDigits(lad.d2)),
        h('td', { class: 'v' }, String(lad.r2)),
        h('td', { class: 'ln' }, ':' + lad.r2Line)),
      h('tr', { class: 'res' },
        h('td', {}, 'd₃ = r₂·2⁶⁴ + lo₆₄(lo)'),
        h('td', { class: 'v' }, groupDigits(lad.d3)),
        h('td', { class: 'v' }, String(lad.r3)),
        h('td', { class: 'ln' }, ':' + lad.r3Line))));
  root.append(h('details', { class: 'math-sec', open: true },
    h('summary', {}, 'the three divisions in base 2⁶⁴'),
    tab,
    h('p', { class: 'hint' },
      `The result is ${lad.r3}, and that is N mod ${m}. A machine divides at most `
      + '128 bits at a time, so the reference does the reduction in three steps '
      + 'instead of one.')));

  root.append(h('div', { style: 'margin-top:.5rem' },
    h('button', {
      type: 'button',
      onclick: (e) => copyTranscript(e.currentTarget, st, trace),
    }, 'copy this step as text')));
}

// Decimal of a 0x-prefixed hex string, for the "hi" row. BigInt is exact here,
// and the value is only being reformatted, not recomputed.
function BigIntFromHex(hex) {
  return BigInt(hex).toString(10);
}

function transcript(st, trace) {
  const m = st.m;
  const lad = st.ladder;
  return [
    `${hName(st.j)}("${st.input}") mod ${m}`,
    `  seed          "${st.seed}"  (hex ${st.seedHex})`,
    `  SHA-256 input ${st.preimageHex}`,
    `  digest        ${st.digestHex}`,
    `  lo            ${st.loHex}`,
    `  hi            ${st.hiHex}`,
    `  N             ${st.nDec}`,
    `  r1 = hi mod ${m}                = ${lad.r1}`,
    `  d2 = r1*2^64 + hi64(lo)      = ${lad.d2}`,
    `  r2 = d2 mod ${m}                = ${lad.r2}`,
    `  d3 = r2*2^64 + lo64(lo)      = ${lad.d3}`,
    `  r3 = d3 mod ${m}                = ${lad.r3}   <- the bucket`,
    '',
    `recorded from google/distributed_point_functions @ ${trace.__commit || ''}`,
    'pir/hashing/sha256_hash_family.cc:59-87',
  ].join('\n');
}

function copyTranscript(btn, st, trace) {
  const text = transcript(st, trace);
  const done = (ok) => {
    btn.textContent = ok ? 'copied' : 'press Ctrl+C';
    setTimeout(() => { btn.textContent = 'copy this step as text'; }, 1600);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => done(true), () => fallback(text, done));
  } else {
    fallback(text, done);
  }
}

function fallback(text, done) {
  const ta = h('textarea', { style: 'position:fixed;left:-9999px' });
  ta.value = text;
  document.body.append(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
  ta.remove();
  done(ok);
}
