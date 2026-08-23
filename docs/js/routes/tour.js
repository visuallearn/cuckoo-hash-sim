// The guided tour. The prose lives in data/tour.json so it can be edited
// without touching code. Every figure is a small view that reads a recorded
// trace, so nothing in the narration is invented.

import { h, s, clear, add } from '../dom.js';
import { state, set, on } from '../store.js';
import { loadTrace } from '../traceLoader.js';
import { flatten, frameAt } from '../replay.js';
import { narrate } from '../narrate.js';
import { hName, hexBytes, groupDigits } from '../fmt.js';
import * as tableView from '../views/tableView.js';
import * as prediction from '../views/predictionOverlay.js';

let tour = null;
const traces = new Map();

/** Tiny inline markup: **bold**, `code`, *emphasis*. */
function rich(str) {
  const p = h('p', {});
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g;
  let last = 0;
  let m;
  while ((m = re.exec(str)) !== null) {
    if (m.index > last) p.append(str.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith('**')) p.append(h('b', {}, tok.slice(2, -2)));
    else if (tok.startsWith('`')) p.append(h('code', {}, tok.slice(1, -1)));
    else p.append(h('em', {}, tok.slice(1, -1)));
    last = re.lastIndex;
  }
  if (last < str.length) p.append(str.slice(last));
  return p;
}

function subs(trace) {
  const map = trace
    ? { m: trace.params.numBuckets, k: trace.params.numHashFunctions,
        budget: trace.params.maxRelocations, n: trace.elements.length }
    : {};
  return (str) => str.replace(/\{\{(\w+)\}\}/g, (_, key) => (key in map ? String(map[key]) : `{{${key}}}`));
}

function firstStepOfKind(trace, kind) {
  const flat = flatten(trace);
  for (let i = 0; i < flat.total; i++) if (flat.steps[i].st.kind === kind) return i;
  return 0;
}

function findHash(trace, element, j) {
  for (const op of trace.ops) {
    for (const st of op.steps) {
      if (st.kind === 'hash' && st.input === element && st.j === j) return st;
    }
  }
  return null;
}

// ------------------------------------------------------------------ figures

function figProblem() {
  const W = 460;
  const H = 150;
  const g = s('g', {});
  const drawers = ['', '', '', '', '', ''];
  drawers.forEach((_, i) => {
    g.append(s('rect', { class: 'slot', x: 20 + i * 70, y: 80, width: 60, height: 40, rx: 5 }));
    g.append(s('text', { class: 'slotnum', x: 50 + i * 70, y: 134 }, String(i)));
  });
  g.append(s('rect', { class: 'slot held', x: 160, y: 80, width: 60, height: 40, rx: 5 }));
  g.append(s('text', { class: 'chip held', x: 190, y: 100 }, 'cat'));
  g.append(s('rect', { class: 'walker', x: 130, y: 18, width: 62, height: 24, rx: 6 }));
  g.append(s('text', { class: 'walkerlab', x: 161, y: 31 }, 'dog'));
  g.append(s('path', {
    class: 'arrow lit', d: 'M161 44 C161 60 190 60 190 76', 'marker-end': 'url(#ah-lit)',
  }));
  g.append(s('text', { class: 'arrowlab lit', x: 205, y: 62 }, 'h(dog) = 2'));
  g.append(s('defs', {},
    s('marker', { id: 'ah-lit', viewBox: '0 0 8 8', refX: 6, refY: 4, markerWidth: 5,
      markerHeight: 5, orient: 'auto' },
      s('path', { d: 'M0 0 L8 4 L0 8 z', fill: 'var(--probe)' }))));
  return h('div', { class: 'tbl' },
    s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img',
      style: `width:100%;max-width:${W}px;height:auto`,
      'aria-label': 'Six drawers. Drawer 2 holds cat. The word dog also hashes to drawer 2.' }, g),
    h('p', { class: 'hint' },
      'Two words want drawer 2. A hash table must decide what happens next.'));
}

function figCandidates(trace) {
  const k = trace.params.numHashFunctions;
  const names = trace.elements;
  const head = h('tr', {}, h('th', {}, 'word'),
    ...Array.from({ length: k }, (_, j) => h('th', {}, hName(j))),
    h('th', {}, 'different homes'));
  const rows = names.map((name) => {
    const row = trace.candidates[name];
    const distinct = new Set(row).size;
    return h('tr', {},
      h('td', { class: 'w' }, name),
      ...row.map((b, j) => h('td', {
        class: row.filter((x) => x === b).length > 1 ? 'dup' : '',
      }, String(b))),
      h('td', { class: distinct < k ? 'dup' : '' }, String(distinct)));
  });
  return h('div', {},
    h('div', { class: 'panel-scroll' },
      h('table', { class: 'cand-tab' }, h('thead', {}, head), h('tbody', {}, ...rows))),
    h('p', { class: 'hint' },
      `Amber marks a bucket that two hash functions agree on. m = ${trace.params.numBuckets}.`),
    h('p', {}, h('a', { href: `#/table?s=${trace.id}` }, 'Open this scenario in the explorer')));
}

function figHashHead(trace, bind) {
  const st = findHash(trace, bind.element, bind.function);
  if (!st) return h('p', { class: 'hint' }, 'no recorded evaluation');
  const strip = h('div', { class: 'bytes' });
  hexBytes(st.digestHex).forEach((b, i) => {
    strip.append(h('i', { class: i < 16 ? 'lo' : 'hi', title: `byte ${i}` }, b));
  });
  return h('div', {},
    h('div', { class: 'math-head' },
      h('span', { class: 'm' }, `${hName(st.j)}("${st.input}") = LE₂₅₆( SHA-256( "${st.seed}" ‖ "${st.input}" ) ) mod ${st.m} = `),
      h('span', { class: 'm m-res', style: 'font-size:1.15rem' }, String(st.bucket))),
    h('div', { class: 'math-lines' },
      h('div', { class: 'math-line' }, h('span', { class: 'lbl' }, 'bytes in'),
        h('span', { class: 'm' }, st.preimageHex)),
      h('div', { class: 'math-line' }, h('span', { class: 'lbl' }, 'digest'),
        h('span', { class: 'm' }, st.digestHex))),
    strip,
    h('div', { class: 'byte-key' },
      h('span', { class: 'k-lo' }, h('b', {}, 'bytes 0 to 15'), ' become lo'),
      h('span', { class: 'k-hi' }, h('b', {}, 'bytes 16 to 31'), ' become hi')),
    h('p', {}, h('a', { href: '#/hash' }, 'Open the full pipeline')));
}

function figLadder(trace, bind) {
  const st = findHash(trace, bind.element, bind.function);
  if (!st) return h('p', { class: 'hint' }, 'no recorded evaluation');
  const lad = st.ladder;
  return h('div', {},
    h('div', { class: 'math-lines' },
      h('div', { class: 'math-line' }, h('span', { class: 'lbl' }, 'N'),
        h('span', { class: 'm' }, groupDigits(st.nDec)))),
    h('div', { class: 'panel-scroll' }, h('table', { class: 'ladder-tab' },
      h('thead', {}, h('tr', {}, h('th', {}, 'step'), h('th', {}, 'value'),
        h('th', {}, 'mod ' + st.m))),
      h('tbody', {},
        h('tr', {}, h('td', {}, 'd1 = hi'),
          h('td', { class: 'v' }, groupDigits(BigInt(st.hiHex).toString(10))),
          h('td', { class: 'v' }, String(lad.r1))),
        h('tr', {}, h('td', {}, 'd2 = r1 * 2^64 + high half of lo'),
          h('td', { class: 'v' }, groupDigits(lad.d2)),
          h('td', { class: 'v' }, String(lad.r2))),
        h('tr', { class: 'res' }, h('td', {}, 'd3 = r2 * 2^64 + low half of lo'),
          h('td', { class: 'v' }, groupDigits(lad.d3)),
          h('td', { class: 'v' }, String(lad.r3)))))),
    h('p', {}, 'The bucket is ', h('b', {}, String(st.bucket)), '.'));
}

function figDraw(trace, bind) {
  const flat = flatten(trace);
  const idx = bind.step || 0;
  const f = frameAt(trace, flat, idx);
  const st = f.st.kind === 'draw' ? f.st : flat.steps[firstStepOfKind(trace, 'draw')].st;
  const k = trace.params.numHashFunctions;
  const choice = h('div', { class: 'rng-choice' });
  for (let j = 0; j < k; j++) choice.append(h('i', { class: j === st.j ? 'on' : '' }, hName(j)));
  return h('div', {},
    h('div', { class: 'math-lines' },
      h('div', { class: 'math-line' }, h('span', { class: 'lbl' }, 'word'),
        h('span', { class: 'm' }, groupDigits(st.raw[0]))),
      h('div', { class: 'math-line' }, h('span', { class: 'lbl' }, 'low 32 bits'),
        h('span', { class: 'm' }, groupDigits(st.bits32))),
      h('div', { class: 'math-line' }, h('span', { class: 'lbl' }, 'index'),
        h('span', { class: 'm' }, st.mapFormula))),
    choice,
    h('p', { class: 'hint' },
      'The distribution uses the low 32 bits of the word, because its unsigned type '
      + 'comes from the width of an int. This is the one place where the exact library '
      + 'version matters, so the project records golden draws from it.'),
    h('p', {}, h('a', { href: `#/table?s=${trace.id}&step=${idx}` },
      'See this draw in the explorer')));
}

function figSteps(trace, bind) {
  const flat = flatten(trace);
  let idx = bind.event ? firstStepOfKind(trace, bind.event) : (bind.step || 0);
  const view = tableView.make();
  const narrBox = h('div', { class: 'narr' });
  const counter = h('span', { class: 'transport-count' });
  const wrap = h('div', {});

  function paint() {
    const frame = frameAt(trace, flat, idx);
    const vm = { trace, manifest: state.manifest, code: state.code, flat, frame, state };
    view.update(vm);
    const n = narrate(trace, frame);
    narrBox.className = 'narr' + (n.tone ? ' ' + n.tone : '');
    clear(narrBox);
    narrBox.append(h('b', {}, n.title), h('span', { class: 'sub' }, n.detail));
    counter.textContent = `step ${idx + 1} / ${flat.total}`;
  }

  view.build({ trace, manifest: state.manifest, code: state.code, flat,
    frame: frameAt(trace, flat, idx), state });

  const controls = h('div', { class: 'transport', style: 'position:static' },
    h('div', { class: 'transport-group' },
      h('button', { type: 'button', 'aria-label': 'Back to the start',
        onclick: () => { idx = 0; paint(); } }, '⏮'),
      h('button', { type: 'button', 'aria-label': 'Previous step',
        onclick: () => { idx = Math.max(0, idx - 1); paint(); } }, '◀'),
      h('button', { type: 'button', 'aria-label': 'Next step',
        onclick: () => { idx = Math.min(flat.total - 1, idx + 1); paint(); } }, '▶'),
      h('button', { type: 'button', 'aria-label': 'Go to the end',
        onclick: () => { idx = flat.total - 1; paint(); } }, '⏭')),
    counter);

  wrap.append(view.el, narrBox, controls,
    h('p', {}, h('a', { href: `#/table?s=${trace.id}&step=${idx}` },
      'Open this run in the explorer')));
  paint();
  return wrap;
}

function figLookup(trace) {
  const ops = trace.ops.filter((o) => o.op === 'lookup');
  if (!ops.length) return h('p', { class: 'hint' }, 'no recorded lookup');
  const k = trace.params.numHashFunctions;
  const boxes = ops.map((op) => {
    const probes = op.steps.filter((x) => x.kind === 'probe');
    return h('div', {},
      h('h4', {}, `"${op.arg}" — `, op.foundInTable ? `found in bucket ${op.bucket}` : 'not found'),
      h('table', { class: 'cand-tab' },
        h('thead', {}, h('tr', {}, h('th', {}, 'function'), h('th', {}, 'bucket'),
          h('th', {}, 'holds'), h('th', {}, 'match'))),
        h('tbody', {}, ...probes.map((p) => h('tr', { class: p.match ? 'on' : '' },
          h('td', { class: 'w' }, hName(p.j)),
          h('td', {}, String(p.bucket)),
          h('td', {}, p.occupant === null ? 'empty' : p.occupant),
          h('td', {}, p.match ? 'yes' : 'no'))))));
  });
  return h('div', {},
    h('div', { class: 'cmp' }, ...boxes),
    h('p', { class: 'hint' }, `${k} probes, whatever the answer is.`),
    h('p', {}, h('a', { href: '#/lookup' }, 'Open the lookup page')));
}

function figOrders(a, b) {
  // The words are the data, so they keep their own case rather than taking the
  // heading style's capitals.
  const row = (t) => h('div', {},
    h('h4', { style: 'text-transform:none' }, t.elements.join(', ')),
    h('div', { class: 'buckets' },
      ...t.finalTable.map((v, i) => h('div', { class: 'bucket' },
        h('b', {}, h('span', {}, String(i))),
        v === null ? null : h('span', { class: 'chipbox' }, v)))),
    h('p', { class: 'hint' },
      'stash: ' + (t.finalStash.length ? t.finalStash.join(', ') : 'empty')));
  const same = JSON.stringify(a.finalTable) === JSON.stringify(b.finalTable);
  return h('div', {},
    h('div', { class: 'cmp' }, row(a), row(b)),
    h('p', {}, same
      ? 'The two runs agree.'
      : h('b', {}, 'The same four words, the same parameters, two different tables.')),
    h('p', {}, h('a', { href: `#/table?s=${a.id}` }, 'Run A'), ' · ',
      h('a', { href: `#/table?s=${b.id}` }, 'Run B')));
}

function figProduction(trace, manifest) {
  const p = manifest.algorithm.production;
  const rows = [
    ['hash functions, k', String(p.numHashFunctions)],
    ['buckets', p.bucketsFormula],
    ['relocation budget', p.maxRelocations],
    ['stash limit', 'none'],
    ['session seed', `${p.sessionSeedBytes} random bytes, in front of every function seed`],
  ];
  const sizes = [1, 2, 3, 4, 5, 7, 10, 100];
  return h('div', {},
    h('dl', { class: 'params-list' },
      ...rows.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])),
    h('div', { class: 'panel-scroll', style: 'margin-top:.6rem' },
      h('table', { class: 'cand-tab' },
        h('thead', {}, h('tr', {}, h('th', {}, 'records'),
          ...sizes.map((n) => h('th', {}, String(n))))),
        h('tbody', {}, h('tr', {}, h('td', { class: 'w' }, 'buckets'),
          ...sizes.map((n) => h('td', {}, String(Math.floor(1.5 * n)))))))),
    h('p', { class: 'hint' }, 'Five records give seven buckets. The product truncates.'),
    h('p', { class: 'note' }, p.stashNote),
    h('p', {}, h('a', { href: `#/table?s=${trace.id}` }, 'A build with these parameters'),
      ' · ', h('a', { href: '#/table?s=CK-test-preset' }, 'The unit test’s own size')));
}

function figPredict(trace, bind) {
  const flat = flatten(trace);
  let idx = bind.step || 0;
  const view = tableView.make();
  const pred = prediction.make();
  const counter = h('span', { class: 'transport-count' });
  const wrap = h('div', {});

  function paint() {
    const frame = frameAt(trace, flat, idx);
    const vm = { trace, manifest: state.manifest, code: state.code, flat, frame, state };
    view.update(vm);
    counter.textContent = `step ${idx + 1} / ${flat.total}`;
    const was = state.predict;
    state.predict = true;
    pred.update(vm);
    state.predict = was;
  }
  view.build({ trace, manifest: state.manifest, code: state.code, flat,
    frame: frameAt(trace, flat, idx), state });
  pred.build();
  wrap.append(view.el, pred.el,
    h('div', { class: 'transport', style: 'position:static' },
      h('div', { class: 'transport-group' },
        h('button', { type: 'button', 'aria-label': 'Previous step',
          onclick: () => { idx = Math.max(0, idx - 1); paint(); } }, '◀'),
        h('button', { type: 'button', 'aria-label': 'Next step',
          onclick: () => { idx = Math.min(flat.total - 1, idx + 1); paint(); } }, '▶')),
      counter),
    h('p', { class: 'hint' },
      'Answer, then move on. Use the same three inputs each time: the candidate table, '
      + 'the drawn hash function, and what the table holds now.'));
  paint();
  return wrap;
}

// ------------------------------------------------------------------- mount

export function mount(root) {
  clear(root);
  const host = h('div', { class: 'tour' });
  root.append(host);

  async function traceFor(id) {
    if (!traces.has(id)) traces.set(id, await loadTrace(state.manifest, id));
    return traces.get(id);
  }

  async function render() {
    if (!tour) return;
    const i = Math.max(0, Math.min(state.tourStep, tour.steps.length - 1));
    const st = tour.steps[i];
    const bind = st.bind || {};
    let trace = null;
    if (bind.scenario) trace = await traceFor(bind.scenario);
    const sub = subs(trace);

    clear(host);
    const dots = h('div', { class: 'tour-dots' });
    tour.steps.forEach((s2, n) => dots.append(h('button', {
      type: 'button', title: `${n + 1}. ${s2.title}`,
      'aria-current': String(n === i), 'aria-label': `Step ${n + 1}: ${s2.title}`,
      onclick: () => set({ tourStep: n }),
    }, String(n + 1))));

    let fig = null;
    if (st.fig === 'problem') fig = figProblem();
    else if (st.fig === 'candidates') fig = figCandidates(trace);
    else if (st.fig === 'hashhead') fig = figHashHead(trace, bind);
    else if (st.fig === 'ladder') fig = figLadder(trace, bind);
    else if (st.fig === 'draw') fig = figDraw(trace, bind);
    else if (st.fig === 'steps') fig = figSteps(trace, bind);
    else if (st.fig === 'lookup') fig = figLookup(trace);
    else if (st.fig === 'orders') fig = figOrders(await traceFor('CK-order-a'), await traceFor('CK-order-b'));
    else if (st.fig === 'production') fig = figProduction(trace, state.manifest);
    else if (st.fig === 'predict') fig = figPredict(trace, bind);

    add(host,
      h('div', { class: 'tour-count' }, `Step ${i + 1} of ${tour.steps.length}`
        + (trace ? `  ·  scenario ${trace.id}, m = ${trace.params.numBuckets}, `
          + `k = ${trace.params.numHashFunctions}` : '')),
      h('article', { class: 'tour-step' },
        h('h2', {}, sub(st.title)),
        ...st.body.map((b) => rich(sub(b))),
        fig ? h('div', { class: 'tour-fig' }, h('h3', {}, 'The figure'), fig) : null,
        st.also ? h('p', {}, ...st.also.map((a) => h('a', { href: a.href }, a.label))) : null),
      h('div', { class: 'tour-nav' },
        h('button', { type: 'button', disabled: i === 0 ? true : null,
          onclick: () => set({ tourStep: i - 1 }) }, '← Back'),
        h('button', {
          type: 'button', disabled: i === tour.steps.length - 1 ? true : null,
          onclick: () => set({ tourStep: i + 1 }),
        }, 'Next →'),
        dots),
      i === 0 ? h('p', { class: 'hint' }, 'Use the left and right arrow keys to move.') : null,
      i === tour.steps.length - 1
        ? h('p', {}, 'Next: ',
          h('a', { href: '#/table' }, 'the explorer'), ', ',
          h('a', { href: '#/variants' }, 'the other two tables'), ', or ',
          h('a', { href: '#/sandbox' }, 'your own words'), '.')
        : null);
  }

  (async () => {
    if (!tour) {
      const r = await fetch('data/tour.json', { cache: 'no-cache' });
      tour = await r.json();
    }
    await render();
  })();

  const unsubs = [on('structure', () => { if (state.route === 'tour') render(); })];

  return {
    unmount() { for (const off of unsubs) off(); },
    keys(e) {
      if (!tour) return false;
      if (e.key === 'ArrowRight') { set({ tourStep: Math.min(state.tourStep + 1, tour.steps.length - 1) }); return true; }
      if (e.key === 'ArrowLeft') { set({ tourStep: Math.max(state.tourStep - 1, 0) }); return true; }
      return false;
    },
  };
}
