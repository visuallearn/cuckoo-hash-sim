// Bootstrap and hash router. Deep links carry the whole view state, so a link
// to one micro-step of one scenario opens exactly that.

import { state, set, on, emit } from './store.js';
import { loadManifest, loadCode, loadTrace, scenarioOf } from './traceLoader.js';
import { h, clear } from './dom.js';

const ROUTES = ['tour', 'table', 'hash', 'lookup', 'variants', 'lab', 'sandbox', 'about'];
const loaders = {
  tour: () => import('./routes/tour.js'),
  table: () => import('./routes/table.js'),
  hash: () => import('./routes/hash.js'),
  lookup: () => import('./routes/lookup.js'),
  variants: () => import('./routes/variants.js'),
  lab: () => import('./routes/lab.js'),
  sandbox: () => import('./routes/sandbox.js'),
  about: () => import('./routes/about.js'),
};
// Every route that either replays a trace or checks the browser engine
// against one.
const NEEDS_TRACE = new Set(['table', 'hash', 'lookup', 'variants', 'lab', 'sandbox']);

const main = document.getElementById('main');
let active = null;
let activeRoute = null;
let activeStructure = null;
let syncing = false;

// ------------------------------------------------------------- hash and state

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, qs] = raw.split('?');
  const route = ROUTES.includes(path) ? path : null;
  const q = new URLSearchParams(qs || '');
  const num = (k) => (q.has(k) ? Number(q.get(k)) : undefined);
  return {
    route,
    scenario: q.get('s') || undefined,
    step: num('step'),
    tourStep: num('t'),
    element: q.get('e') || undefined,
    fn: num('j'),
    granularity: q.get('view') === 'op' ? 'op' : (q.get('view') === 'micro' ? 'micro' : undefined),
    predict: q.has('predict') ? q.get('predict') === '1' : undefined,
  };
}

function writeHash() {
  if (syncing) return;
  const q = new URLSearchParams();
  if (state.route === 'table') {
    q.set('s', state.scenario);
    q.set('step', state.step);
    q.set('view', state.granularity);
    if (state.predict) q.set('predict', '1');
  } else if (state.route === 'hash') {
    q.set('s', state.scenario);
    q.set('e', state.hashElement);
    q.set('j', state.hashFunction);
  } else if (state.route === 'lookup') {
    q.set('s', state.scenario);
  } else if (state.route === 'tour') {
    q.set('t', state.tourStep);
  }
  const s = q.toString();
  const next = '#/' + state.route + (s ? '?' + s : '');
  if (location.hash !== next) {
    syncing = true;
    history.replaceState(null, '', next);
    syncing = false;
  }
}

// ------------------------------------------------------------------- chrome

function paintChrome() {
  const r = state.manifest.reference;
  document.getElementById('topbar-sub').textContent =
    `google/distributed_point_functions @ ${r.commitShort} · pir/hashing · Apache 2.0`;
  const foot = document.getElementById('foot-version');
  if (foot) foot.textContent = r.commitShort;
  for (const a of document.querySelectorAll('.topbar-nav a')) {
    if (a.dataset.route === state.route) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
}

// A blank page is the worst failure mode for a teaching site, so an uncaught
// error becomes a visible, quotable banner. It also gives the headless checks
// something to assert on.
function clearBanner() {
  const el = document.getElementById('errbanner');
  if (el) el.remove();
}

function banner(msg) {
  let el = document.getElementById('errbanner');
  if (!el) {
    el = h('div', {
      id: 'errbanner', role: 'alert',
      style: 'position:sticky;top:0;z-index:50;padding:.6rem 1rem;'
        + 'background:var(--fail-soft);color:var(--fail);border-bottom:2px solid var(--fail);'
        + 'font-family:var(--mono);font-size:.78rem;white-space:pre-wrap',
    });
    document.body.insertBefore(el, document.body.firstChild);
  }
  el.textContent = 'Error: ' + msg;
}

window.addEventListener('error', (e) => banner(e.message || String(e.error)));
window.addEventListener('unhandledrejection', (e) => banner(
  'unhandled rejection: ' + (e.reason && e.reason.message ? e.reason.message : String(e.reason))));

function fail(err) {
  banner(String(err && err.message ? err.message : err));
  clear(main);
  main.append(h('div', { class: 'route-prose' },
    h('h1', {}, 'The data did not load'),
    h('p', {}, String(err && err.message ? err.message : err)),
    h('p', { class: 'hint' },
      'A browser blocks module and fetch requests on file:// URLs. If you opened this '
      + 'page from a local copy, serve the docs directory over HTTP. For example: ',
      h('code', {}, 'python3 tools/serve.py 8791'), '.')));
  // eslint-disable-next-line no-console
  console.error(err);
}

// ------------------------------------------------------------- trace loading

function normalise() {
  const t = state.trace;
  if (!t) return;
  const total = t.microStepCount;
  if (!Number.isFinite(state.step) || state.step < 0 || state.step >= total) state.step = 0;
  if (!Number.isFinite(state.tourStep) || state.tourStep < 0) state.tourStep = 0;
}

async function ensureTrace() {
  if (!scenarioOf(state.manifest, state.scenario)) {
    state.scenario = state.manifest.default.scenario;
  }
  if (!state.trace || state.trace.id !== state.scenario) {
    state.trace = await loadTrace(state.manifest, state.scenario);
    state.step = 0;
  }
  normalise();
}

// ------------------------------------------------------------------- routing

async function go() {
  const want = parseHash();
  const route = want.route || state.manifest.default.route || 'tour';

  if (want.scenario !== undefined) state.scenario = want.scenario;
  if (want.tourStep !== undefined) state.tourStep = want.tourStep;
  if (want.element !== undefined) state.hashElement = want.element;
  if (want.fn !== undefined) state.hashFunction = want.fn;
  if (want.granularity !== undefined) state.granularity = want.granularity;
  if (want.predict !== undefined) state.predict = want.predict;
  state.route = route;

  try {
    if (NEEDS_TRACE.has(route) || route === 'tour') await ensureTrace();
  } catch (e) { fail(e); return; }

  if (want.step !== undefined) state.step = want.step;
  normalise();
  paintChrome();

  const structure = state.trace ? state.trace.structure : null;
  const needRemount = activeRoute !== route
    || (route === 'table' && activeStructure !== structure);

  if (needRemount) {
    if (active && active.unmount) active.unmount();
    const mod = await loaders[route]();
    active = mod.mount(main, { onStructureChange: () => { activeRoute = null; go(); } });
    activeRoute = route;
    activeStructure = structure;
  } else {
    emit('structure');
  }
  document.body.dataset.ready = route;
  clearBanner();
  writeHash();
}

// ------------------------------------------------------------------ keyboard

function isTyping(el) {
  return el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA');
}

document.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey || isTyping(document.activeElement)) return;
  if (active && active.keys && active.keys(e)) e.preventDefault();
});

window.addEventListener('hashchange', () => { if (!syncing) go(); });
on('structure', writeHash);
on('step', writeHash);

// A view can change the scenario straight through the store. That needs the
// matching trace, which is a fetch. Without this, choosing a new scenario
// updated the picker and the URL but left every panel on the previous run.
let loadingTrace = false;
on('structure', async () => {
  if (!state.manifest) return;
  if (state.route !== activeRoute) { go(); return; }
  if (!NEEDS_TRACE.has(state.route) && state.route !== 'tour') return;
  if ((state.trace && state.trace.id === state.scenario) || loadingTrace) return;
  loadingTrace = true;
  try { await ensureTrace(); }
  catch (e) { fail(e); return; }
  finally { loadingTrace = false; }
  if (state.route === 'table' && state.trace.structure !== activeStructure) {
    activeRoute = null;
    go();
    return;
  }
  emit('structure');
});

// --------------------------------------------------------------------- start

(async () => {
  try {
    const [manifest, code] = await Promise.all([loadManifest(), loadCode()]);
    state.manifest = manifest;
    state.code = code;
    state.scenario = manifest.default.scenario;
    if (!location.hash) location.replace('#/tour');
    await go();
  } catch (e) { fail(e); }
})();

export { set };
