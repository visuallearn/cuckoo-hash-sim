# Quality gates

Measured numbers, with the command that produced each one. Regenerate with:

```sh
python3 tools/serve.py 8791 &
python3 tools/13_qa.py 8791
```

Last run 2026-08-23. `tools/13_qa.py` exits non-zero when a gate is missed, so a green pipeline is the evidence, not this file.

## Summary

| gate | target | measured | |
|---|---|---|---|
| accessibility, the explorer | >= 95 | 100 | pass |
| accessibility, the guided tour | >= 95 | 100 | pass |
| transfer size, one route | <= 250 KB gz | 53.8 KB | pass |
| cold load to first interaction | < 1000 ms | 851 ms median of 5 | pass |
| browser checks | all pass | 20 of 20 | pass |

## Accessibility

Lighthouse 12.8.2, accessibility category only, headless Chromium.

- **the explorer** (`#/table?s=CK-classroom&step=8`): **100**
  - no failed audit
- **the guided tour** (`#/tour?t=6`): **100**
  - no failed audit

Accessibility is also checked structurally by `tools/08_browser_check.py`, which asserts that every control carries a name, that the primary controls are large enough to hit, that the narration reaches a live region, and that every step appears as text as well as in the diagram.

## Keyboard, motion and provenance

From `tools/qa/qa.mjs`, which uses no mouse at all.

| check | result | detail |
|---|---|---|
| keyboard reaches the controls | pass | 60 focus stops in the first 60 tabs |
| the tab order cycles in under 60 stops | pass | 33 distinct stops before the order repeats |
| every focus stop has an accessible name | pass | 0 without one |
| no focus stop is invisible | pass | 0 with zero size |
| the first tab stop is the skip link | pass | skip-link "Skip to main content" |
| the skip link moves focus to the content | pass | main |
| arrow keys move through the trace | pass | 1 then 3 |
| End reaches the last step | pass | step 31 |
| Home returns to the first step | pass |  |
| the live region carries the narration | pass | 238 characters |
| the diagram has a text description | pass | 93 characters |
| normal motion: the walker travels | pass | springfrom for 0.42s |
| reduced motion: the walker does not travel | pass | animation-name = none |
| reduced motion: a colour pulse replaces the movement | pass | slotflash for 0.6s |
| light scheme paints its own background | pass | rgb(246, 247, 244) |
| dark scheme paints its own background | pass | rgb(21, 23, 28) |
| cold load to first interaction is under 1 s | pass | median 851 ms of [844,846,851,851,859] |
| the sandbox badges every panel as computed | pass | 4 sandbox badges |
| and shows no "recorded from C++" badge | pass | 0 recorded badges |
| the explorer badges every panel as recorded | pass | 3 recorded badges |

## The provenance badges

Recorded data and computed data must never look the same. Screenshots in `notes/qa-screenshots/`:

- `recorded-badge.png` — the explorer, every panel marked "recorded from C++" in green
- `sandbox-badge.png` — the sandbox, every panel marked "computed in the browser" in amber

Computed style of the sandbox badge: `{"color":"rgb(141, 93, 23)","border":"rgb(141, 93, 23)","bg":"rgb(248, 236, 214)"}`

## Motion

- `motion-no-preference.png` — the eviction step with the spring animation live
- `motion-reduce.png` — the same step under `prefers-reduced-motion: reduce`

Under reduced motion the walker does not travel. A 600 ms colour pulse on the bucket replaces the movement, so the same information arrives without anything sliding.

## Size

| | gzipped |
|---|---|
| the explorer route: shell, CSS and its 20 modules | 38.7 KB |
| its data: manifest, source slices, one trace | 15.1 KB |
| **route total** | **53.8 KB** |
| every module on the site (30), if all were loaded | 68.6 KB |
| the largest trace, `CK-test-preset.json`, fetched only when selected | 168.5 KB (1109 KB raw) |

There is no bundler by design: the modules are the teaching material. Routes load on demand, so no visitor pays for all of them.

## Timing

Cold navigation to a keypress that actually moves the trace, five runs: [844, 846, 851, 851, 859] ms, median **851 ms**.

Measured against `tools/serve.py` on localhost. The published site sits behind a CDN with HTTP/2, which multiplexes the same requests over one connection.

