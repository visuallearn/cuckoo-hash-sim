// Free input. The same views as the explorer, over a run computed here rather
// than recorded, and badged so the difference is never in doubt.

import { h, clear } from '../dom.js';
import { state, set, on } from '../store.js';
import { flatten, frameAt } from '../replay.js';
import { makePlayer } from '../player.js';
import { run, engine, verifyAgainst } from '../engine/cuckoo.js';
import * as tableView from '../views/tableView.js';
import * as bucketsView from '../views/bucketsView.js';
import * as mathBox from '../views/mathBox.js';
import * as rngBox from '../views/rngBox.js';
import * as codePanel from '../views/codePanel.js';
import * as timeline from '../views/timeline.js';
import * as narration from '../views/narration.js';
import * as eventLog from '../views/eventLog.js';

// Education, not a calculator: everything stays at a size a person can follow.
const MAX_ELEMENTS = 12;
const MAX_LEN = 12;
const M_CHOICES = [4, 6, 8, 12, 16];

const cfg = {
  structure: 'cuckoo',
  words: 'ant bee cat dog eel',
  m: 6,
  k: 3,
  budget: 4,
  stash: '',
  cap: '',
  lookups: '',
  production: false,
};

function parseWords(text) {
  return text.split(/[\s,]+/).map((w) => w.trim()).filter(Boolean)
    .slice(0, MAX_ELEMENTS)
    .map((w) => w.slice(0, MAX_LEN));
}

export function mount(root) {
  clear(root);
  const host = h('div', { class: 'route' });
  root.append(host);

  let trace = null;
  let flat = null;
  let parts = null;
  let player = null;
  let mountedStructure = null;

  const form = h('div', {});
  const viewHost = h('div', {});
  host.append(h('div', { class: 'route-prose', style: 'padding-left:0;padding-right:0' },
    h('h1', {}, 'Your own words'),
    h('p', {},
      'This page runs a port of the reference in your browser. The self-test replays '
      + 'every recorded trace through that port and compares the result byte for byte, '
      + 'so the numbers are the reference’s numbers. They are still computed here and '
      + 'not recorded, and the badge says so on every panel.'),
    form), viewHost);

  function buildForm() {
    clear(form);
    const row = (label, ...kids) => h('div', { class: 'cfg-row' },
      h('label', {}, label), ...kids);

    const wordsIn = h('input', {
      type: 'text', value: cfg.words, size: 40, spellcheck: 'false',
      'aria-label': 'elements, separated by spaces',
      oninput: (e) => { cfg.words = e.target.value; },
    });
    const lookupIn = h('input', {
      type: 'text', value: cfg.lookups, size: 24, spellcheck: 'false',
      'aria-label': 'keys to look up afterwards',
      oninput: (e) => { cfg.lookups = e.target.value; },
    });
    const structSel = h('select', {
      'aria-label': 'structure',
      onchange: (e) => { cfg.structure = e.target.value; buildForm(); go(); },
    }, ...[['cuckoo', 'CuckooHashTable'], ['multiple_choice', 'MultipleChoiceHashTable'],
      ['simple', 'SimpleHashTable']].map(([v, t]) => h('option', {
        value: v, selected: v === cfg.structure ? true : null,
      }, t)));
    const mSel = h('select', {
      'aria-label': 'buckets', disabled: cfg.production ? true : null,
      onchange: (e) => { cfg.m = Number(e.target.value); },
    }, ...M_CHOICES.map((v) => h('option', {
      value: String(v), selected: v === cfg.m ? true : null,
    }, String(v))));
    const kSel = h('select', {
      'aria-label': 'hash functions', disabled: cfg.production ? true : null,
      onchange: (e) => { cfg.k = Number(e.target.value); },
    }, ...(cfg.structure === 'simple' ? [1, 2, 3] : [2, 3]).map((v) => h('option', {
      value: String(v), selected: v === cfg.k ? true : null,
    }, String(v))));
    const bSel = h('select', {
      'aria-label': 'relocation budget', disabled: cfg.production ? true : null,
      onchange: (e) => { cfg.budget = Number(e.target.value); },
    }, ...[0, 1, 2, 3, 4, 6, 8, 12, 16].map((v) => h('option', {
      value: String(v), selected: v === cfg.budget ? true : null,
    }, String(v))));
    const sSel = h('select', {
      'aria-label': 'stash limit', disabled: cfg.production ? true : null,
      onchange: (e) => { cfg.stash = e.target.value; },
    }, ...['', '0', '1', '2', '3', '4'].map((v) => h('option', {
      value: v, selected: v === cfg.stash ? true : null,
    }, v === '' ? 'no limit' : v)));
    const cSel = h('select', {
      'aria-label': 'bucket limit',
      onchange: (e) => { cfg.cap = e.target.value; },
    }, ...['', '1', '2', '3', '4'].map((v) => h('option', {
      value: v, selected: v === cfg.cap ? true : null,
    }, v === '' ? 'no limit' : v)));
    const prod = h('button', {
      type: 'button', 'aria-pressed': String(cfg.production),
      title: 'k = 3, buckets = int64(1.5 x n), budget = n, no stash limit',
      onclick: () => { cfg.production = !cfg.production; buildForm(); go(); },
    }, 'production formula');

    form.append(row('elements', wordsIn,
      h('span', { class: 'hint' }, `up to ${MAX_ELEMENTS} words, ${MAX_LEN} characters each`)));
    if (cfg.structure === 'cuckoo') {
      form.append(row('look up afterwards', lookupIn,
        h('span', { class: 'hint' }, 'optional')));
    }
    form.append(row('structure', structSel));
    const params = row('buckets', mSel, h('label', {}, 'hash functions'), kSel);
    if (cfg.structure === 'cuckoo') {
      params.append(h('label', {}, 'budget'), bSel, h('label', {}, 'stash limit'), sSel, prod);
    } else {
      params.append(h('label', {}, 'bucket limit'), cSel);
    }
    form.append(params);
    form.append(h('div', { class: 'cfg-row' },
      h('button', { type: 'button', onclick: go }, 'run it'),
      h('button', { type: 'button', onclick: download }, 'download this run as a trace'),
      h('span', { class: engine.verified === false ? 'badge fail' : 'badge sandbox' },
        engine.verified === false
          ? 'the engine did not pass its self-test'
          : 'computed in the browser')));
  }

  function spec() {
    const elements = parseWords(cfg.words);
    const n = elements.length;
    const prodM = Math.max(1, Math.floor(1.5 * n));
    return {
      id: 'sandbox',
      title: 'A run you made',
      teaches: 'free input, computed in the browser',
      structure: cfg.structure,
      numBuckets: cfg.production && cfg.structure === 'cuckoo' ? prodM : cfg.m,
      k: cfg.production && cfg.structure === 'cuckoo' ? 3 : cfg.k,
      maxRelocations: cfg.production && cfg.structure === 'cuckoo' ? n : cfg.budget,
      maxStashSize: cfg.production || cfg.stash === '' ? null : Number(cfg.stash),
      maxBucketSize: cfg.cap === '' ? null : Number(cfg.cap),
      familySeedHex: '',
      elements,
      lookups: cfg.structure === 'cuckoo' ? parseWords(cfg.lookups) : [],
    };
  }

  function download() {
    if (!trace) return;
    const blob = new Blob([JSON.stringify(trace, null, 1)], { type: 'application/json' });
    const a = h('a', { href: URL.createObjectURL(blob), download: 'sandbox-trace.json' });
    document.body.append(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  }

  function go() {
    const sp = spec();
    if (!sp.elements.length) {
      clear(viewHost);
      viewHost.append(h('p', { class: 'hint' }, 'Type at least one word.'));
      return;
    }
    trace = run(sp);
    flat = flatten(trace);
    state.step = 0;
    if (mountedStructure !== trace.structure) {
      clear(viewHost);
      player = makePlayer(() => flat);
      const isBuckets = trace.structure !== 'cuckoo';
      parts = {
        main: isBuckets ? bucketsView.make(trace.structure) : tableView.make(),
        narr: narration.make(),
        math: mathBox.make(),
        rng: rngBox.make(),
        code: codePanel.make(),
        log: eventLog.make(),
        tl: timeline.make(player),
      };
      const mid = h('div', { class: 'ex-col' }, parts.main.el, parts.narr.el, parts.log.el);
      const right = h('div', { class: 'ex-col ex-right' }, parts.math.el, parts.rng.el, parts.code.el);
      viewHost.append(h('div', { class: 'ex', style: 'grid-template-columns:minmax(0,1fr) minmax(340px,440px)' },
        mid, right), parts.tl.el);
      mountedStructure = trace.structure;
      for (const p of Object.values(parts)) p.build(vm());
    } else {
      for (const p of Object.values(parts)) p.build(vm());
    }
    paint();
  }

  function vm() {
    return {
      trace, manifest: state.manifest, code: state.code, flat,
      frame: frameAt(trace, flat, state.step), state,
    };
  }

  function paint() {
    if (!parts || !trace) return;
    const v = vm();
    if (!v.frame) return;
    for (const p of Object.values(parts)) p.update(v);
  }

  verifyAgainst(state.trace);
  buildForm();
  go();

  const unsubs = [on('step', paint)];
  return {
    unmount() { if (player) player.pause(); for (const off of unsubs) off(); },
    keys(e) {
      if (!player) return false;
      if (e.key === 'ArrowRight') { player.next(); return true; }
      if (e.key === 'ArrowLeft') { player.prev(); return true; }
      if (e.key === ' ') { player.toggle(); return true; }
      if (e.key === 'Home') { player.home(); return true; }
      if (e.key === 'End') { player.end(); return true; }
      return false;
    },
  };
}
