// The reference source, with the cursor on the line that is running.
//
// The text is the pristine upstream file, verbatim, with its real line numbers.
// tools/02_extract_source.py takes it from `git show <pin>:<path>` and asserts
// every line number that a trace points at.

import { h, clear, panel } from '../dom.js';
import { set, state } from '../store.js';

// Which slice covers which file. A step's codeLoc names a file, and the panel
// follows it.
const DOC_FOR_FILE = {
  'pir/hashing/cuckoo_hash_table.cc': 'cuckoo_insert',
  'pir/hashing/sha256_hash_family.cc': 'sha256_hash',
  'pir/hashing/multiple_choice_hash_table.cc': 'mcht_insert',
  'pir/hashing/simple_hash_table.cc': 'simple_insert',
  'pir/cuckoo_hashing_sparse_dpf_pir_client.cc': 'client_probe',
  'pir/cuckoo_hashed_dpf_pir_database.cc': 'database_build',
  'pir/cuckoo_hashing_sparse_dpf_pir_server.cc': 'server_params',
};

const TAB_ORDER = ['cuckoo_insert', 'sha256_hash', 'cuckoo_create', 'hash_family',
  'mcht_insert', 'simple_insert', 'client_probe', 'database_build', 'server_params'];

export function make() {
  const el = h('div', { class: 'p-code' });
  let scroller = null;
  let lineEls = new Map();
  let lastKey = '';
  let crumb = null;
  let foot = null;
  let tabs = null;
  let followBtn = null;

  function build(vm) {
    clear(el);
    tabs = h('div', { class: 'code-tabs' });
    crumb = h('div', { class: 'code-crumb' });
    scroller = h('div', { class: 'code-scroll' });
    foot = h('p', { class: 'code-foot' });
    followBtn = h('button', {
      type: 'button', 'aria-pressed': String(state.codeFollow),
      title: 'Move the panel to the file that the current step is in',
      onclick: () => set({ codeFollow: !state.codeFollow }),
    }, 'follow the step');
    for (const name of TAB_ORDER) {
      const d = vm.code.docs[name];
      if (!d) continue;
      tabs.append(h('button', {
        type: 'button', dataset: { doc: name },
        title: `${d.file}:${d.startLine}–${d.endLine}`,
        onclick: () => set({ codeDoc: name, codeFollow: false }),
      }, d.symbol.split('::').pop()));
    }
    el.append(panel('The reference source',
      h('span', { class: 'badge' }, 'verbatim'),
      tabs, crumb, scroller, foot,
      h('div', { style: 'margin-top:.4rem' }, followBtn)));
    lastKey = '';
  }

  function renderDoc(vm, name) {
    const d = vm.code.docs[name];
    lineEls = new Map();
    const code = h('div', { class: 'code' });
    for (const ln of d.lines) {
      const row = h('span', { class: 'ln' },
        h('span', { class: 'n' }, String(ln.n)),
        h('span', { class: 't' }, ln.t || ' '));
      code.append(row);
      lineEls.set(ln.n, row);
    }
    clear(scroller);
    scroller.append(code);
    clear(crumb);
    crumb.append(h('b', {}, d.symbol), ' — ', d.blurb);
    clear(foot);
    const short = vm.manifest.reference.commitShort;
    foot.append(
      d.file, ' lines ', String(d.startLine), '–', String(d.endLine), ' · ',
      h('a', { href: d.permalink, rel: 'noopener' }, short), ' · sha256 ',
      d.sourceSha256.slice(0, 12), '…', h('br', {}),
      'Copyright 2023 Google LLC. ',
      h('a', { href: 'data/source/LICENSE-dpf.txt' }, 'Apache 2.0'), '.');
  }

  function update(vm) {
    const loc = vm.frame ? vm.frame.st.codeLoc : null;
    const wanted = state.codeFollow && loc && DOC_FOR_FILE[loc.file]
      ? DOC_FOR_FILE[loc.file] : state.codeDoc;
    const doc = vm.code.docs[wanted] ? wanted : 'cuckoo_insert';

    for (const b of tabs.children) {
      b.setAttribute('aria-pressed', String(b.dataset.doc === doc));
    }
    followBtn.setAttribute('aria-pressed', String(state.codeFollow));

    const line = loc && vm.code.docs[doc].file === loc.file ? loc.line : -1;
    const key = doc + ':' + line;
    if (key === lastKey) return;
    if (!lastKey.startsWith(doc + ':')) renderDoc(vm, doc);
    else {
      for (const row of lineEls.values()) row.classList.remove('cur');
    }
    const row = lineEls.get(line);
    if (row) {
      row.classList.add('cur');
      // Centre the cursor inside its own scroller only. Never scroll the page.
      const r = row.getBoundingClientRect();
      const sc = scroller.getBoundingClientRect();
      scroller.scrollTop += (r.top - sc.top) - scroller.clientHeight / 2 + r.height / 2;
    }
    lastKey = key;
  }

  return { el, build, update };
}
