// Quality gates that need a real browser: keyboard-only reach, reduced motion,
// and the time from a cold navigation to the first interaction.
//
// Not part of the published site. Driven by tools/13_qa.py, which also runs
// Lighthouse and writes notes/QA.md.
//
// Usage: node tools/qa/qa.mjs <base-url> <screenshot-dir>

import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const BASE = process.argv[2] || 'http://localhost:8791';
const SHOTS = process.argv[3] || 'notes/qa-screenshots';
mkdirSync(SHOTS, { recursive: true });

const results = [];
function ck(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'ok  ' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}

const stepOf = async (page) => {
  const t = await page.textContent('body');
  const m = /step (\d+) \//.exec(t || '');
  return m ? Number(m[1]) : -1;
};

const browser = await chromium.launch();

// ---------------------------------------------------------------- keyboard only
{
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
  await page.goto(`${BASE}/index.html#/table?s=CK-classroom&step=0`);
  await page.waitForSelector('.tbl svg');

  // Nothing below uses page.click. Everything is Tab, Enter and arrows.
  const reachable = [];
  await page.keyboard.press('Tab');
  for (let i = 0; i < 60; i++) {
    const el = await page.evaluate(() => {
      const a = document.activeElement;
      if (!a || a === document.body) return null;
      const r = a.getBoundingClientRect();
      return {
        tag: a.tagName,
        name: (a.getAttribute('aria-label') || a.textContent || '').trim().slice(0, 40),
        w: Math.round(r.width), h: Math.round(r.height),
        visible: r.width > 0 && r.height > 0,
        outline: getComputedStyle(a, ':focus-visible').outlineStyle,
      };
    });
    if (el) reachable.push(el);
    await page.keyboard.press('Tab');
  }
  ck('keyboard reaches the controls', reachable.length >= 25,
    `${reachable.length} focus stops in the first 60 tabs`);
  // The tab order must be walkable. Three hundred scrubber ticks in it was the
  // reason the ribbons became one slider.
  const cycle = [];
  for (const e of reachable) {
    const key = e.tag + ':' + e.name;
    if (cycle.includes(key)) break;
    cycle.push(key);
  }
  ck('the tab order cycles in under 60 stops', cycle.length < 60,
    `${cycle.length} distinct stops before the order repeats`);
  const nameless = reachable.filter((e) => !e.name);
  ck('every focus stop has an accessible name', nameless.length === 0,
    `${nameless.length} without one`);
  const invisible = reachable.filter((e) => !e.visible);
  ck('no focus stop is invisible', invisible.length === 0,
    `${invisible.length} with zero size`);

  // The skip link must be the first stop and must move focus into the content.
  // A fresh context, because navigating to the same URL with a different
  // fragment does not reset focus, and the tab sweep above left it deep in the
  // page.
  {
    const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
    const p2 = await ctx.newPage();
    await p2.goto(`${BASE}/index.html#/table?s=CK-classroom&step=0`);
    await p2.waitForSelector('.tbl svg');
    await p2.keyboard.press('Tab');
    const first = await p2.evaluate(() => ({
      cls: (document.activeElement.className || '') + '',
      text: (document.activeElement.textContent || '').trim(),
    }));
    ck('the first tab stop is the skip link', first.cls.includes('skip-link'),
      `${first.cls} "${first.text}"`);
    await p2.keyboard.press('Enter');
    await p2.waitForTimeout(150);
    const landed = await p2.evaluate(() => document.activeElement.id
      || document.activeElement.tagName);
    ck('the skip link moves focus to the content', landed === 'main', landed);
    await ctx.close();
  }

  // Drive the explorer with keys only.
  await page.goto(`${BASE}/index.html#/table?s=CK-classroom&step=0`);
  await page.waitForSelector('.tbl svg');
  const s0 = await stepOf(page);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(200);
  const s2 = await stepOf(page);
  ck('arrow keys move through the trace', s2 === s0 + 2, `${s0} then ${s2}`);
  await page.keyboard.press('End');
  await page.waitForTimeout(200);
  const sEnd = await stepOf(page);
  ck('End reaches the last step', sEnd > s2, `step ${sEnd}`);
  await page.keyboard.press('Home');
  await page.waitForTimeout(200);
  ck('Home returns to the first step', (await stepOf(page)) === 1);

  // The narration must reach a screen reader, not only the diagram.
  const live = await page.textContent('#live');
  ck('the live region carries the narration', (live || '').trim().length > 20,
    `${(live || '').trim().length} characters`);
  const svgLabel = await page.getAttribute('.tbl svg', 'aria-label');
  ck('the diagram has a text description', (svgLabel || '').length > 40,
    `${(svgLabel || '').length} characters`);

  await page.screenshot({ path: `${SHOTS}/keyboard-focus.png`, fullPage: false });
  await page.close();
}

// ------------------------------------------------------------- reduced motion
{
  for (const motion of ['no-preference', 'reduce']) {
    const page = await browser.newPage({
      viewport: { width: 1400, height: 900 },
      reducedMotion: motion,
    });
    // An eviction step: the one place with real choreography.
    await page.goto(`${BASE}/index.html#/table?s=CK-classroom&step=8`);
    await page.waitForSelector('.tbl svg .walker');
    const state = await page.evaluate(() => {
      const w = document.querySelector('.tbl .walkgrp');
      const slot = document.querySelector('.tbl .slot.evicted, .tbl .slot.hot');
      const cs = w ? getComputedStyle(w) : null;
      const ss = slot ? getComputedStyle(slot) : null;
      return {
        walkerAnimation: cs ? cs.animationName : 'none',
        walkerDuration: cs ? cs.animationDuration : '0s',
        slotAnimation: ss ? ss.animationName : 'none',
        slotDuration: ss ? ss.animationDuration : '0s',
      };
    });
    if (motion === 'reduce') {
      ck('reduced motion: the walker does not travel',
        state.walkerAnimation === 'none',
        `animation-name = ${state.walkerAnimation}`);
      ck('reduced motion: a colour pulse replaces the movement',
        state.slotAnimation === 'slotflash',
        `${state.slotAnimation} for ${state.slotDuration}`);
    } else {
      ck('normal motion: the walker travels',
        state.walkerAnimation === 'springfrom',
        `${state.walkerAnimation} for ${state.walkerDuration}`);
    }
    await page.screenshot({ path: `${SHOTS}/motion-${motion}.png`,
      animations: 'disabled' });
    await page.close();
  }
}

// -------------------------------------------------------------- dark and light
{
  for (const scheme of ['light', 'dark']) {
    const page = await browser.newPage({
      viewport: { width: 1400, height: 900 }, colorScheme: scheme,
    });
    await page.goto(`${BASE}/index.html#/table?s=CK-classroom&step=8`);
    await page.waitForSelector('.tbl svg');
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    ck(`${scheme} scheme paints its own background`, bg !== 'rgba(0, 0, 0, 0)', bg);
    await page.screenshot({ path: `${SHOTS}/scheme-${scheme}.png`,
      animations: 'disabled' });
    await page.close();
  }
}

// ------------------------------------------------------ time to first interaction
{
  const timings = [];
  for (let n = 0; n < 5; n++) {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const page = await ctx.newPage();
    const t0 = Date.now();
    await page.goto(`${BASE}/index.html#/table?s=CK-classroom&step=0`,
      { waitUntil: 'commit' });
    // "Interactive" means the table is drawn and a key actually moves it.
    await page.waitForSelector('.tbl svg .slot');
    await page.keyboard.press('ArrowRight');
    await page.waitForFunction(() => /step 2 \//.test(document.body.textContent || ''));
    timings.push(Date.now() - t0);
    await ctx.close();
  }
  timings.sort((a, b) => a - b);
  const median = timings[Math.floor(timings.length / 2)];
  ck('cold load to first interaction is under 1 s', median < 1000,
    `median ${median} ms of ${JSON.stringify(timings)}`);
  results.push({ name: '__timings', pass: true, detail: JSON.stringify(timings) });
}

// ------------------------------------------------------------- the sandbox badge
{
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  await page.goto(`${BASE}/index.html#/sandbox`);
  await page.waitForSelector('.tbl svg');
  const badges = await page.evaluate(() => [...document.querySelectorAll('.badge')]
    .map((b) => ({ cls: b.className, text: b.textContent.trim() })));
  const sandbox = badges.filter((b) => b.cls.includes('sandbox'));
  const recorded = badges.filter((b) => b.cls.includes('recorded'));
  ck('the sandbox badges every panel as computed', sandbox.length >= 2,
    `${sandbox.length} sandbox badges`);
  ck('and shows no "recorded from C++" badge', recorded.length === 0,
    `${recorded.length} recorded badges`);
  const style = await page.evaluate(() => {
    const s = document.querySelector('.badge.sandbox');
    const c = getComputedStyle(s);
    return { color: c.color, border: c.borderColor, bg: c.backgroundColor };
  });
  results.push({ name: '__sandboxBadge', pass: true, detail: JSON.stringify(style) });
  await page.screenshot({ path: `${SHOTS}/sandbox-badge.png`,
    animations: 'disabled' });
  await page.close();

  // The same panels on a recorded route, for the visual contrast.
  const p2 = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  await p2.goto(`${BASE}/index.html#/table?s=CK-classroom&step=8`);
  await p2.waitForSelector('.tbl svg');
  const rec = await p2.evaluate(() => [...document.querySelectorAll('.badge.recorded')].length);
  ck('the explorer badges every panel as recorded', rec >= 2, `${rec} recorded badges`);
  await p2.screenshot({ path: `${SHOTS}/recorded-badge.png`,
    animations: 'disabled' });
  await p2.close();
}

await browser.close();

const failed = results.filter((r) => !r.pass && !r.name.startsWith('__'));
writeFileSync(`${SHOTS}/../qa-playwright.json`, JSON.stringify(results, null, 1) + '\n');
console.log(`\n${results.filter((r) => !r.name.startsWith('__')).length} checks, ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);
