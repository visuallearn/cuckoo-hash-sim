// Prediction mode: before a step is shown, the learner says what will happen.
// The answer comes from the trace, so the exercise is self-checking.

import { h, clear } from '../dom.js';
import { set, state } from '../store.js';
import { hName } from '../fmt.js';

let score = { asked: 0, right: 0 };

export function make() {
  const el = h('div', {});
  let answeredFor = -1;

  function build() { clear(el); }

  function question(trace, frame) {
    const st = frame.st;
    const k = trace.params.numHashFunctions;
    if (st.kind === 'draw') {
      return {
        text: 'Which hash function will the table draw?',
        options: Array.from({ length: k }, (_, j) => ({ label: hName(j), value: j })),
        answer: st.j,
        why: `The word is ${st.raw[st.raw.length - 1]}. ${st.mapFormula}.`,
      };
    }
    if (st.kind === 'hash') {
      const cands = trace.candidates[st.input] || [];
      const opts = [...new Set(cands)].sort((a, b) => a - b);
      return {
        text: `Which bucket does ${hName(st.j)}("${st.input}") give?`,
        options: opts.map((b) => ({ label: `bucket ${b}`, value: b })),
        answer: st.bucket,
        why: `The candidate table says ${hName(st.j)}("${st.input}") = ${st.bucket}.`,
      };
    }
    if (st.kind === 'place' || st.kind === 'evict') {
      return {
        text: 'Is that bucket free?',
        options: [{ label: 'free, so the element lands', value: 'place' },
                  { label: 'taken, so something is pushed out', value: 'evict' }],
        answer: st.kind,
        why: st.kind === 'place'
          ? 'The bucket was free.'
          : `The bucket held "${st.outgoing}", so it comes out.`,
      };
    }
    return null;
  }

  function update(vm) {
    if (!state.predict) { clear(el); return; }
    const q = question(vm.trace, vm.frame);
    if (!q) { clear(el); return; }
    if (answeredFor === vm.frame.index && el.dataset.done === '1') return;
    if (el.dataset.step === String(vm.frame.index)) return;

    clear(el);
    el.dataset.step = String(vm.frame.index);
    el.dataset.done = '0';
    const box = h('div', { class: 'pred' });
    const opts = h('div', { class: 'pred-opts' });
    const result = h('div', { class: 'hint' });
    for (const o of q.options) {
      opts.append(h('button', {
        type: 'button',
        onclick: (e) => {
          if (el.dataset.done === '1') return;
          el.dataset.done = '1';
          answeredFor = vm.frame.index;
          score.asked++;
          const ok = o.value === q.answer;
          if (ok) score.right++;
          for (const b of opts.children) {
            b.disabled = true;
            if (b.textContent === String(q.options.find((x) => x.value === q.answer).label)) {
              b.classList.add('right');
            }
          }
          if (!ok) e.currentTarget.classList.add('wrong');
          clear(result);
          result.append(h('b', {}, ok ? 'Correct. ' : 'Not this time. '), q.why,
            h('span', { class: 'pred-score' }, `  ${score.right} of ${score.asked}`));
        },
      }, o.label));
    }
    box.append(h('h4', {}, 'Your turn'), h('p', { style: 'margin:.2rem 0' }, q.text),
      opts, result);
    el.append(box);
  }

  return { el, build, update };
}
