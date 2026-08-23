// The main explorer. The table, the arithmetic, the draw, the source, and a
// transport that moves one recorded event at a time.

import { h, clear } from '../dom.js';
import { state, set, on } from '../store.js';
import { flatten, frameAt } from '../replay.js';
import { makePlayer } from '../player.js';
import * as tableView from '../views/tableView.js';
import * as bucketsView from '../views/bucketsView.js';
import * as mathBox from '../views/mathBox.js';
import * as rngBox from '../views/rngBox.js';
import * as codePanel from '../views/codePanel.js';
import * as timeline from '../views/timeline.js';
import * as narration from '../views/narration.js';
import * as eventLog from '../views/eventLog.js';
import * as configPanel from '../views/configPanel.js';
import * as prediction from '../views/predictionOverlay.js';

export function mount(root, opts = {}) {
  const structures = opts.structures || null;
  clear(root);

  const isBuckets = state.trace.structure !== 'cuckoo';
  let flat = flatten(state.trace);
  const player = makePlayer(() => flat);

  const main = isBuckets ? bucketsView.make(state.trace.structure) : tableView.make();
  const parts = {
    main,
    narr: narration.make(),
    pred: prediction.make(),
    math: mathBox.make(),
    rng: rngBox.make(),
    code: codePanel.make(),
    log: eventLog.make(),
    cfg: configPanel.make(structures),
    tl: timeline.make(player),
  };

  const left = h('div', { class: 'ex-col' }, parts.cfg.el);
  const mid = h('div', { class: 'ex-col' }, parts.main.el, parts.narr.el, parts.pred.el, parts.log.el);
  const right = h('div', { class: 'ex-col ex-right' }, parts.math.el, parts.rng.el, parts.code.el);
  root.append(h('div', { class: 'route' }, h('div', { class: 'ex' }, left, mid, right), parts.tl.el));

  let builtFor = null;

  function vm() {
    return {
      trace: state.trace, manifest: state.manifest, code: state.code, flat,
      frame: frameAt(state.trace, flat, state.step), state,
    };
  }

  function render() {
    if (!state.trace) return;
    // A scenario with a different structure needs a different main view. Ask
    // main.js for a remount rather than rebuilding the wrong one in place.
    if ((state.trace.structure !== 'cuckoo') !== isBuckets) {
      if (opts.onStructureChange) opts.onStructureChange();
      return;
    }
    if (state.trace.id !== builtFor) {
      flat = flatten(state.trace);
      const v0 = vm();
      for (const p of Object.values(parts)) p.build(v0);
      builtFor = state.trace.id;
    }
    const v = vm();
    if (!v.frame) return;
    for (const p of Object.values(parts)) p.update(v);
  }

  render();
  const unsubs = [on('structure', render), on('step', render)];

  return {
    unmount() { player.pause(); for (const off of unsubs) off(); },
    keys(e) {
      if (e.key === 'ArrowRight' && e.shiftKey) { player.nextOp(); return true; }
      if (e.key === 'ArrowLeft' && e.shiftKey) { player.prevOp(); return true; }
      if (e.key === 'ArrowRight') { player.next(); return true; }
      if (e.key === 'ArrowLeft') { player.prev(); return true; }
      if (e.key === ' ') { player.toggle(); return true; }
      if (e.key === 'Home') { player.home(); return true; }
      if (e.key === 'End') { player.end(); return true; }
      if (e.key === '[') { set({ speed: Math.max(0.25, state.speed / 2) }); player.restartTimerIfPlaying(); return true; }
      if (e.key === ']') { set({ speed: Math.min(4, state.speed * 2) }); player.restartTimerIfPlaying(); return true; }
      if (e.key === 'p') { set({ predict: !state.predict }); return true; }
      return false;
    },
  };
}
