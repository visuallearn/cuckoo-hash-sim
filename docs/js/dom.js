// Minimal DOM helpers. No framework: the site is served as-is from GitHub
// Pages, so "view source" is part of the teaching material.

const SVG_NS = 'http://www.w3.org/2000/svg';

function apply(el, attrs) {
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.setAttribute('class', v);
    else if (k === 'text') el.textContent = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
}

function append(el, kids) {
  for (const k of kids.flat(4)) {
    if (k === null || k === undefined || k === false) continue;
    el.appendChild(typeof k === 'object' ? k : document.createTextNode(String(k)));
  }
}

/** h('div', {class:'x'}, 'text', child, ...) */
export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  apply(el, attrs);
  append(el, kids);
  return el;
}

/** The same, in the SVG namespace. */
export function s(tag, attrs, ...kids) {
  const el = document.createElementNS(SVG_NS, tag);
  apply(el, attrs);
  append(el, kids);
  return el;
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

export function frag(...kids) {
  const f = document.createDocumentFragment();
  append(f, kids);
  return f;
}

/**
 * Append children to an existing element, dropping null and undefined.
 * The native Element.append turns a null into the text "null", which is how a
 * conditional child ends up printed on the page.
 */
export function add(el, ...kids) {
  append(el, kids);
  return el;
}

/** A titled panel. */
export function panel(title, extra, ...kids) {
  return h('section', { class: 'panel' }, h('h4', {}, title, extra || null), ...kids);
}
