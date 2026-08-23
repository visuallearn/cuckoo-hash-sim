// Formatting helpers, plus the small inline-maths vocabulary the math box uses.
// Everything is plain HTML: spans, sub and sup. No typesetting library.

import { h } from './dom.js';

const SUB = { 0: '₀', 1: '₁', 2: '₂', 3: '₃', 4: '₄', 5: '₅', 6: '₆', 7: '₇', 8: '₈', 9: '₉' };

export function sub(n) { return String(n).split('').map((c) => SUB[c] || c).join(''); }

/** h₂ as one token. */
export function hName(j) { return 'h' + sub(j); }

/** Group a long decimal into blocks of three, so a reader can compare digits. */
export function groupDigits(str) {
  const s = String(str);
  let out = '';
  for (let i = 0; i < s.length; i++) {
    if (i > 0 && (s.length - i) % 3 === 0) out += ' ';
    out += s[i];
  }
  return out;
}

/** Split a hex string into byte pairs. */
export function hexBytes(hex) {
  const s = String(hex).replace(/^0x/, '');
  const out = [];
  for (let i = 0; i < s.length; i += 2) out.push(s.slice(i, i + 2));
  return out;
}

/** One line of the math box. */
export function mathLine(label, ...tokens) {
  return h('div', { class: 'math-line' },
    h('span', { class: 'lbl' }, label || ''),
    h('span', { class: 'm' }, ...tokens));
}

/** A stable hue per element, from a colour-blind-safe categorical set. */
const HUES = [206, 28, 145, 280, 48, 190, 330, 96, 12, 258, 168, 320];
export function elementHue(name) {
  let acc = 0;
  for (let i = 0; i < name.length; i++) acc = (acc * 31 + name.charCodeAt(i)) >>> 0;
  return HUES[acc % HUES.length];
}
