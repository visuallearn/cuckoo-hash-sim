// The load-factor lab. This is the one page that computes rather than replays,
// so it carries the sandbox badge everywhere and says how each number was made.

import { h, s, clear, panel } from '../dom.js';
import { state, on } from '../store.js';
import { run, engine, verifyAgainst } from '../engine/cuckoo.js';

const W = 520;
const H = 260;
const PAD = { l: 46, r: 12, t: 26, b: 34 };

function words(n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push('e' + i);
  return out;
}

/** For one k and one load factor, the fraction of elements that reach the stash. */
function measure(k, n, ratio) {
  // `ratio` is buckets per element, so the table gets larger as it grows.
  const m = Math.max(1, Math.floor(n * ratio));
  const t = run({
    structure: 'cuckoo', numBuckets: m, k, maxRelocations: n,
    maxStashSize: null, elements: words(n),
  });
  return { m, stash: t.finalStash.length, n };
}

function line(points, colour) {
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join(' ');
  return s('path', { class: 'ln2', d, stroke: colour });
}

function chart(series, xlabel, ylabel, xs, ymax) {
  const g = s('g', {});
  const x = (v) => PAD.l + ((v - xs[0]) / (xs[xs.length - 1] - xs[0])) * (W - PAD.l - PAD.r);
  const y = (v) => H - PAD.b - (v / ymax) * (H - PAD.t - PAD.b);

  for (let i = 0; i <= 4; i++) {
    const v = (ymax * i) / 4;
    g.append(s('line', { class: 'gr', x1: PAD.l, y1: y(v), x2: W - PAD.r, y2: y(v) }));
    g.append(s('text', { class: 'lab', x: PAD.l - 6, y: y(v) + 3, 'text-anchor': 'end' },
      v.toFixed(v < 1 ? 2 : 0)));
  }
  for (const v of xs) {
    g.append(s('text', { class: 'lab', x: x(v), y: H - PAD.b + 14, 'text-anchor': 'middle' },
      String(v)));
  }
  g.append(s('line', { class: 'ax', x1: PAD.l, y1: H - PAD.b, x2: W - PAD.r, y2: H - PAD.b }));
  g.append(s('line', { class: 'ax', x1: PAD.l, y1: PAD.t, x2: PAD.l, y2: H - PAD.b }));
  g.append(s('text', { class: 'lab', x: (W + PAD.l) / 2, y: H - 4, 'text-anchor': 'middle' }, xlabel));
  g.append(s('text', { class: 'lab', x: 4, y: 11 }, ylabel));

  for (const ser of series) {
    const pts = ser.points.map((p) => ({ x: x(p.x), y: y(p.y) }));
    g.append(line(pts, ser.colour));
    for (const p of pts) g.append(s('circle', { class: 'pt', cx: p.x, cy: p.y, r: 3, fill: ser.colour }));
  }
  return s('svg', { class: 'chart', viewBox: `0 0 ${W} ${H}`, role: 'img',
    'aria-label': series.map((x2) => `${x2.name}: `
      + x2.points.map((p) => `${p.x} gives ${p.y.toFixed(3)}`).join(', ')).join('. ') }, g);
}

export function mount(root) {
  clear(root);
  const host = h('div', { class: 'route-prose' });
  root.append(host);

  function render() {
    clear(host);
    verifyAgainst(state.trace);
    host.append(h('h1', {}, 'How full is too full'));
    host.append(h('p', {},
      'Everything else on this site is a recorded value. This page is not. It runs the '
      + 'browser port of the reference over many inputs and counts what happens, so '
      + 'every number here carries the sandbox badge.'));

    const badge = engine.verified === false
      ? h('span', { class: 'badge fail' }, 'the engine did not pass its self-test')
      : h('span', { class: 'badge sandbox' }, 'computed in the browser');

    const n = 60;
    const ratios = [1.0, 1.1, 1.2, 1.3, 1.5, 1.75, 2.0, 2.5];
    const colours = { 2: 'var(--evict)', 3: 'var(--probe)', 4: 'var(--settled)' };
    const series = [2, 3, 4].map((k) => ({
      name: `k = ${k}`,
      colour: colours[k],
      points: ratios.map((r) => {
        const res = measure(k, n, r);
        return { x: r, y: res.stash / n };
      }),
    }));
    const ymax = Math.max(0.1, Math.ceil(
      Math.max(...series.flatMap((x) => x.points.map((p) => p.y))) * 20) / 20);

    host.append(panel('Elements that reach the stash', badge,
      chart(series, 'buckets per element', 'fraction on the stash', ratios, ymax),
      h('div', { class: 'chart-legend' },
        ...series.map((x) => h('span', {},
          h('i', { style: `background:${x.colour}` }), x.name))),
      h('p', { class: 'hint' },
        `${n} elements, a relocation budget equal to the number of elements, and an `
        + 'unlimited stash. One run per point: the generator is deterministic, so a '
        + 'point is one exact answer rather than an average.'),
      h('p', {},
        'The production choice is three hash functions and 1.5 buckets per element. '
        + 'Read that point off the middle line.')));

    const budgets = [1, 2, 4, 8, 16, 32, 60];
    const bseries = [{
      name: 'k = 3, 1.5 buckets per element',
      colour: 'var(--probe)',
      points: budgets.map((b) => {
        const t = run({
          structure: 'cuckoo', numBuckets: Math.floor(1.5 * n), k: 3,
          maxRelocations: b, maxStashSize: null, elements: words(n),
        });
        return { x: b, y: t.finalStash.length / n };
      }),
    }];
    const bmax = Math.max(0.1, Math.ceil(
      Math.max(...bseries[0].points.map((p) => p.y)) * 20) / 20);
    host.append(panel('What the relocation budget buys', badge.cloneNode(true),
      chart(bseries, 'max_relocations', 'fraction on the stash', budgets, bmax),
      h('p', { class: 'hint' },
        `${n} elements, ${Math.floor(1.5 * n)} buckets, three hash functions.`),
      h('p', {},
        'A budget of one is plain hashing with three tries and no memory. The curve '
        + 'flattens quickly: past a certain point the walks that fail are the ones that '
        + 'were never going to succeed, and more attempts do not help them.')));

    host.append(h('h2', {}, 'What the stash is for'));
    host.append(h('p', {},
      'Kirsch, Mitzenmacher and Wieder showed that a stash of constant size turns the '
      + 'failure probability of a cuckoo table from a polynomial into a much smaller '
      + 'quantity. A stash of a few slots is worth a large increase in the number of '
      + 'buckets.'));
    host.append(h('p', { class: 'hint' },
      'Adam Kirsch, Michael Mitzenmacher and Udi Wieder, "More Robust Hashing: Cuckoo '
      + 'Hashing with a Stash", SIAM Journal on Computing 39(4), 2009.'));
    host.append(h('p', {},
      'The reference takes that idea and makes the stash unlimited by default. Its '
      + 'production caller then sizes the table so the stash is empty in practice, '
      + 'because the layer above cannot read a stash at all.'));

    host.append(h('p', {},
      h('a', { href: '#/sandbox' }, 'Try your own words in the sandbox')));
  }

  render();
  const unsubs = [on('structure', () => { if (state.route === 'lab') render(); })];
  return { unmount() { for (const off of unsubs) off(); } };
}
