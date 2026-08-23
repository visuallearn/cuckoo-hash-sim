// The cuckoo table: one row of buckets, the k candidate arrows of the element
// that is moving, the walker above the row, and the stash tray below it.
//
// The stash sits outside the grid, with a dashed border, because it is outside
// the k-probe contract: a lookup that reads the k candidate buckets does not
// find anything that lives there.

import { h, s, clear, panel } from '../dom.js';
import { hName, elementHue } from '../fmt.js';
import { provenanceBadge } from './badges.js';

const WIDE_MAX = 24;      // above this the row becomes a wrapped grid
const CELL = 17;          // the compact cell size
const PER_ROW = 25;
const SLOT_W = 62;
const SLOT_H = 40;
const GAP = 8;
const PAD_X = 14;
const WALK_Y = 26;
const ROW_Y = 132;
const NUM_Y = ROW_Y + SLOT_H + 14;

export function make() {
  const el = h('div', { class: 'p-table' });
  let svg = null;
  let tray = null;
  let pipsEl = null;
  let host = null;

  function build(vm) {
    clear(el);
    svg = null;
    tray = h('div', { class: 'stash-tray' });
    pipsEl = h('span', { class: 'pips' });
    host = h('div', { class: 'tbl' });
    el.append(panel('The table',
      [provenanceBadge(vm),
       h('span', { style: 'margin-left:auto' }, pipsEl)],
      h('div', { class: 'tbl-wrap panel-scroll' }, host),
      tray,
      h('div', { class: 'tbl-legend' },
        h('span', { class: 'l-free' }, 'free'),
        h('span', { class: 'l-held' }, 'holds an element'),
        h('span', { class: 'l-probe' }, 'the bucket of this step'),
        h('span', { class: 'l-evict' }, 'the element that was pushed out'),
        h('span', { class: 'l-stash' }, 'the stash, outside the k buckets'))));
  }

  function slotX(i) { return PAD_X + i * (SLOT_W + GAP); }

  function update(vm) {
    const t = vm.trace;
    const f = vm.frame;
    const m = t.params.numBuckets;
    const k = t.params.numHashFunctions;
    if (m > WIDE_MAX) { updateCompact(vm, t, f, m); updateTray(t, f); return; }
    const width = PAD_X * 2 + m * SLOT_W + (m - 1) * GAP;
    const height = NUM_Y + 16;

    const g = s('g', {});

    // Candidate arrows for the element that is moving, drawn under the slots.
    const cands = f.candidateBuckets || [];
    const walkerX = width / 2;
    for (let j = 0; j < cands.length; j++) {
      const b = cands[j];
      const x = slotX(b) + SLOT_W / 2;
      const lit = f.litJ === j;
      const cls = 'arrow' + (lit ? ' lit' : (f.litJ === null ? '' : ' dim'));
      const midY = (WALK_Y + 20 + ROW_Y) / 2;
      g.append(s('path', {
        class: cls,
        d: `M${walkerX} ${WALK_Y + 22} C${walkerX} ${midY} ${x} ${midY} ${x} ${ROW_Y - 4}`,
        'marker-end': lit ? 'url(#ah-lit)' : 'url(#ah)',
      }));
      // Two hash functions can name the same bucket. Stagger the labels so the
      // duplicate is visible rather than hidden behind the first one.
      const twin = cands.slice(0, j).filter((c) => c === b).length;
      const lx = walkerX + (x - walkerX) * (0.62 - twin * 0.13);
      g.append(s('text', {
        class: 'arrowlab' + (lit ? ' lit' : ''),
        x: lx, y: midY + 4 + twin * 13,
      }, `${hName(j)}=${b}`));
    }

    // The buckets.
    for (let i = 0; i < m; i++) {
      const occupant = f.table ? f.table[i] : null;
      const isCand = cands.includes(i);
      const hot = f.hotBucket === i;
      const evicted = f.evictedBucket === i;
      let cls = 'slot';
      if (occupant !== null && occupant !== undefined) cls += ' held';
      if (isCand) cls += ' cand';
      if (evicted) cls += ' evicted';
      else if (hot) cls += ' hot';
      g.append(s('rect', {
        class: cls, x: slotX(i), y: ROW_Y, width: SLOT_W, height: SLOT_H, rx: 5,
      }));
      if (occupant !== null && occupant !== undefined) {
        // The chip that arrived this step drops in from the walker's position.
        const arriving = (f.kind === 'place' || f.kind === 'evict') && f.hotBucket === i;
        const cx = slotX(i) + SLOT_W / 2;
        g.append(s('text', {
          class: 'chip' + (hot ? ' hot' : ' held') + (arriving ? ' lands' : ''),
          x: cx, y: ROW_Y + SLOT_H / 2,
          style: `fill: hsl(${elementHue(occupant)} 55% var(--chip-l))`
            + (arriving ? `;--dx:${(width / 2 - cx).toFixed(1)}px;--dy:${WALK_Y - ROW_Y - SLOT_H / 2}px` : ''),
        }, occupant));
      }
      g.append(s('text', { class: 'slotnum', x: slotX(i) + SLOT_W / 2, y: NUM_Y }, String(i)));
    }

    // The walker: the element that is looking for a home. This is the signature
    // move of the whole site, so it gets the one piece of real choreography.
    // The diagram is rebuilt on every step, so a transition would have nothing
    // to transition from; a keyframe on a freshly made node does run, and the
    // chip springs out of the bucket it was pushed from.
    if (f.walker) {
      const w = Math.max(56, f.walker.length * 9 + 20);
      const fromX = f.walkerFrom === null ? walkerX : slotX(f.walkerFrom) + SLOT_W / 2;
      const dx = fromX - walkerX;
      const dy = f.walkerFrom === null ? 0 : ROW_Y - WALK_Y;
      const chip = s('g', {
        class: f.kind === 'evict' ? 'walkgrp arc' : 'walkgrp',
        style: `--dx:${dx.toFixed(1)}px;--dy:${dy.toFixed(1)}px`,
      });
      chip.append(s('rect', {
        class: 'walker', x: walkerX - w / 2, y: WALK_Y - 12, width: w, height: 24, rx: 6,
      }));
      chip.append(s('text', { class: 'walkerlab', x: walkerX, y: WALK_Y + 1 }, f.walker));
      g.append(chip);
      g.append(s('text', { class: 'walkercap', x: walkerX, y: WALK_Y - 18 },
        f.walkerFrom === null ? 'looking for a bucket' : `pushed out of bucket ${f.walkerFrom}`));
      if (f.walkerFrom !== null) {
        g.append(s('path', {
          class: 'ghost',
          d: `M${fromX} ${ROW_Y} C${fromX} ${ROW_Y - 40} ${walkerX} ${WALK_Y + 60} ${walkerX} ${WALK_Y + 14}`,
        }));
      }
    }

    const defs = s('defs', {},
      s('marker', { id: 'ah', viewBox: '0 0 8 8', refX: 6, refY: 4, markerWidth: 5,
        markerHeight: 5, orient: 'auto' },
        s('path', { d: 'M0 0 L8 4 L0 8 z', fill: 'var(--rule-strong)' })),
      s('marker', { id: 'ah-lit', viewBox: '0 0 8 8', refX: 6, refY: 4, markerWidth: 5,
        markerHeight: 5, orient: 'auto' },
        s('path', { d: 'M0 0 L8 4 L0 8 z', fill: 'var(--probe)' })));

    clear(host);
    host.append(s('svg', {
      viewBox: `0 0 ${width} ${height}`,
      width: Math.max(width, 320), height,
      role: 'img',
      'aria-label': tableAria(t, f),
      // Grow into a wide panel, but not so far that a six-bucket table looks
      // like a poster. One and a half times the natural size is the ceiling.
      style: `width:100%;max-width:min(100%, ${Math.round(width * 1.5)}px)`,
    }, defs, g));

    updateTray(t, f);
  }

  function updateTray(t, f) {
    clear(tray);
    const bound = t.params.maxStashSize;
    const full = bound !== null && f.stash && f.stash.length >= bound;
    tray.className = 'stash-tray' + (full ? ' full' : '');
    tray.append(h('b', {}, 'stash'));
    if (!f.stash || f.stash.length === 0) {
      tray.append(h('span', { class: 'empty' }, 'empty'));
    } else {
      for (const e of f.stash) tray.append(h('span', { class: 'chipbox' }, e));
    }
    tray.append(h('span', { class: 'hint', style: 'margin-left:auto' },
      bound === null ? 'no limit' : `limit ${bound}`));
    if (f.kind === 'stash_overflow_error') {
      tray.classList.remove('shake');
      void tray.offsetWidth;
      tray.classList.add('shake');
    }

    // The relocation budget, as pips.
    clear(pipsEl);
    const budget = t.params.maxRelocations;
    const used = f.iteration === null ? 0 : f.iteration + 1;
    const shown = Math.min(budget, 24);
    for (let i = 0; i < shown; i++) {
      pipsEl.append(h('i', { class: i < used ? 'used' : '' }));
    }
    pipsEl.append(h('span', { class: 'cap' },
      budget > shown ? `${used} / ${budget}` : `${used} / ${budget} attempts`));
  }

  // A hundred buckets do not fit in one legible row. Draw a wrapped grid of
  // small cells instead: no names, but occupancy, the candidates and the hot
  // bucket are all still visible, and the event log carries the names.
  function updateCompact(vm, t, f, m) {
    const rows = Math.ceil(m / PER_ROW);
    const width = PAD_X * 2 + PER_ROW * CELL;
    const height = 30 + rows * CELL + 18;
    const cands = f.candidateBuckets || [];
    const g = s('g', {});
    let filled = 0;
    for (let i = 0; i < m; i++) {
      const occupant = f.table ? f.table[i] : null;
      if (occupant !== null && occupant !== undefined) filled++;
      const cx = PAD_X + (i % PER_ROW) * CELL;
      const cy = 24 + Math.floor(i / PER_ROW) * CELL;
      let cls = 'slot';
      if (occupant !== null && occupant !== undefined) cls += ' held';
      if (cands.includes(i)) cls += ' cand';
      if (f.evictedBucket === i) cls += ' evicted';
      else if (f.hotBucket === i) cls += ' hot';
      const cell = s('rect', {
        class: cls, x: cx + 1, y: cy + 1, width: CELL - 2, height: CELL - 2, rx: 2,
      });
      cell.append(s('title', {}, `bucket ${i}: ${occupant === null || occupant === undefined ? 'empty' : occupant}`));
      g.append(cell);
    }
    // The class centres its text, and a presentation attribute cannot override
    // a stylesheet rule, so the override has to be inline style.
    g.append(s('text', { class: 'slotnum', x: PAD_X + 2, y: 16,
      style: 'text-anchor:start' }, `${m} buckets, ${filled} occupied`));
    if (f.walker) {
      g.append(s('text', { class: 'walkercap', x: width / 2, y: height - 4 },
        `in hand: ${f.walker}`
        + (f.walkerFrom === null ? '' : `, pushed out of bucket ${f.walkerFrom}`)
        + (cands.length ? `  ·  homes ${cands.join(', ')}` : '')));
    }
    clear(host);
    host.append(s('svg', {
      viewBox: `0 0 ${width} ${height}`, role: 'img',
      'aria-label': tableAria(t, f),
      style: `width:100%;max-width:min(100%, ${Math.round(width * 1.6)}px)`,
    }, g));
  }

  return { el, build, update };
}

function tableAria(t, f) {
  const parts = [];
  const m = t.params.numBuckets;
  for (let i = 0; i < m; i++) {
    const v = f.table ? f.table[i] : null;
    parts.push(`${i}: ${v === null || v === undefined ? 'empty' : v}`);
  }
  const stash = f.stash && f.stash.length ? f.stash.join(', ') : 'empty';
  return `Table of ${m} buckets. ${parts.join('. ')}. Stash: ${stash}.`;
}
