// Transport controls, a coarse ribbon of operations and a fine ribbon of
// micro-steps. The fine ribbon colours each tick by event kind, so the
// interesting places are findable without playing the whole run.

import { h, clear } from '../dom.js';
import { set, state } from '../store.js';

const MAX_TICKS = 300;

// When one tick covers several steps, the tick shows the event a reader most
// wants to find.
const INTEREST = ['stash_overflow_error', 'bucket_full_error', 'stash_push', 'evict',
  'result', 'choose', 'place', 'append', 'probe', 'capacity_check', 'stash_scan',
  'hash', 'draw'];

const GLYPH = {
  place: '●', evict: '⇄', stash_push: '★', stash_overflow_error: '✖',
  bucket_full_error: '✖', append: '●', probe: '◇', draw: '·', hash: '·',
  choose: '◆', capacity_check: '·', stash_scan: '☆', result: '▣',
};

export function make(player) {
  const el = h('div', { class: 'transport' });
  let fine = null;
  let coarse = null;
  let count = null;
  let playBtn = null;
  let granBtn = null;
  let flat = null;
  let ticks = [];

  function build(vm) {
    clear(el);
    flat = vm.flat;

    const btn = (label, title, fn, key) => h('button', {
      type: 'button', title: title + (key ? `  (${key})` : ''), 'aria-label': title, onclick: fn,
    }, label);

    playBtn = h('button', {
      type: 'button', title: 'Play or pause  (Space)', 'aria-label': 'Play',
      onclick: () => player.toggle(),
    }, '▶');

    // With more than a dozen operations a name per button is unreadable, so the
    // ribbon becomes plain ticks and the name moves into the tooltip.
    const dense = flat.opStarts.length > 14;
    coarse = h('div', { class: 'tl-ops' + (dense ? ' dense' : ''), role: 'group',
      'aria-label': 'Jump to an operation' });
    for (const o of flat.opStarts) {
      const label = `${o.op.op} "${o.op.arg}", ${o.count} steps, ${o.op.statusCode}`;
      if (dense) {
        // Too many to be a usable target each. They become part of the
        // scrubber below, which is one control with the same reach.
        coarse.append(h('i', {
          class: 'tick', title: label, 'aria-hidden': 'true',
          dataset: { s: String(o.s) },
        }));
      } else {
        coarse.append(h('button', {
          type: 'button', title: label, 'aria-label': label,
          onclick: () => set({ step: o.s, playing: false }),
        }, o.op.arg.length > 9 ? o.op.arg.slice(0, 8) + '…' : o.op.arg));
      }
    }
    if (dense) {
      coarse.addEventListener('click', (e) => {
        const tick = e.target.closest('.tick');
        if (tick) set({ step: Number(tick.dataset.s), playing: false });
      });
    }

    // One slider, not one button per step: the ticks are decoration inside it.
    fine = h('div', {
      class: 'tl', role: 'slider', tabindex: '0',
      'aria-label': 'Position in the trace',
      'aria-valuemin': '1', 'aria-valuemax': String(flat.total),
      onkeydown: (e) => {
        const jump = { ArrowLeft: -1, ArrowRight: 1, PageDown: -10, PageUp: 10 }[e.key];
        if (jump !== undefined) { set({ step: state.step + jump, playing: false }); }
        else if (e.key === 'Home') set({ step: 0, playing: false });
        else if (e.key === 'End') set({ step: flat.total - 1, playing: false });
        else return;
        e.preventDefault();
        e.stopPropagation();
      },
      onclick: (e) => {
        const r = fine.getBoundingClientRect();
        const frac = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
        set({ step: Math.round(frac * (flat.total - 1)), playing: false });
      },
    });
    const span = Math.max(1, Math.ceil(flat.total / MAX_TICKS));
    ticks = [];
    for (let from = 0; from < flat.total; from += span) {
      const to = Math.min(flat.total, from + span);
      let kind = flat.steps[from].st.kind;
      let rank = INTEREST.indexOf(kind);
      for (let n = from + 1; n < to; n++) {
        const r = INTEREST.indexOf(flat.steps[n].st.kind);
        if (r >= 0 && (rank < 0 || r < rank)) { rank = r; kind = flat.steps[n].st.kind; }
      }
      const label = span === 1
        ? `step ${from + 1}: ${kind} ${GLYPH[kind] || ''}`
        : `steps ${from + 1} to ${to}: ${kind} ${GLYPH[kind] || ''}`;
      ticks.push({ from, to });
      fine.append(h('i', { class: 'tick k-' + kind, title: label, 'aria-hidden': 'true' }));
    }

    count = h('span', { class: 'transport-count' }, '');

    const speed = h('select', {
      'aria-label': 'Playback speed',
      onchange: (e) => { set({ speed: Number(e.target.value) }); player.restartTimerIfPlaying(); },
    }, ...[0.25, 0.5, 1, 2, 4].map((v) => h('option', {
      value: String(v), selected: v === state.speed ? true : null,
    }, v + '×')));

    granBtn = h('button', {
      type: 'button', 'aria-pressed': String(state.granularity === 'op'),
      title: 'Step by whole operations instead of single events',
      onclick: () => set({ granularity: state.granularity === 'op' ? 'micro' : 'op' }),
    }, 'whole inserts');

    el.append(
      h('div', { class: 'transport-group' },
        btn('⏮', 'Back to the start', () => player.home(), 'Home'),
        btn('◀◀', 'Previous operation', () => player.prevOp(), 'Shift + ←'),
        btn('◀', 'Previous step', () => player.prev(), '←'),
        playBtn,
        btn('▶', 'Next step', () => player.next(), '→'),
        btn('▶▶', 'Next operation', () => player.nextOp(), 'Shift + →'),
        btn('⏭', 'Go to the end', () => player.end(), 'End')),
      h('div', { class: 'tl-stack' }, coarse, fine),
      count,
      h('div', { class: 'transport-group' }, granBtn, speed));
  }

  function update(vm) {
    const i = vm.frame.index;
    playBtn.textContent = state.playing ? '⏸' : '▶';
    playBtn.setAttribute('aria-label', state.playing ? 'Pause' : 'Play');
    granBtn.setAttribute('aria-pressed', String(state.granularity === 'op'));
    count.textContent = `step ${i + 1} / ${vm.flat.total}`;
    fine.setAttribute('aria-valuenow', String(i + 1));
    fine.setAttribute('aria-valuetext',
      `step ${i + 1} of ${vm.flat.total}, ${vm.frame.st.kind}`);

    const fkids = fine.children;
    for (let n = 0; n < fkids.length; n++) {
      fkids[n].classList.toggle('now', i >= ticks[n].from && i < ticks[n].to);
      fkids[n].classList.toggle('past', i >= ticks[n].to);
    }
    const ckids = coarse.children;
    flat.opStarts.forEach((o, n) => {
      const to = n + 1 < flat.opStarts.length ? flat.opStarts[n + 1].s : Infinity;
      if (!ckids[n]) return;
      ckids[n].classList.toggle('active', i >= o.s && i < to);
      ckids[n].classList.toggle('done', i >= to);
      ckids[n].classList.toggle('err', o.op.status !== 'ok');
    });
  }

  return { el, build, update };
}
