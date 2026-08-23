// Playback over the flattened micro-step list.

import { state, set } from './store.js';

const BASE_MS = 900;

/** Playback speed scales the motion, with a floor so a label stays readable. */
function applySpeed() {
  const root = document.documentElement;
  const scale = Math.min(1, 1 / Math.max(0.25, state.speed));
  root.style.setProperty('--t-fast', `${Math.round(240 * scale)}ms`);
  root.style.setProperty('--t-arc', `${Math.round(420 * scale)}ms`);
}

export function makePlayer(getFrame) {
  let timer = null;
  applySpeed();

  const total = () => getFrame().total;
  const opStarts = () => getFrame().opStarts.map((o) => o.s);

  function goto(i) {
    const t = total();
    set({ step: Math.max(0, Math.min(i, t - 1)) });
  }

  function nextIndex(from) {
    if (state.granularity === 'op') {
      const s = opStarts().find((x) => x > from);
      return s === undefined ? total() - 1 : s;
    }
    return from + 1;
  }

  function prevIndex(from) {
    if (state.granularity === 'op') {
      const before = opStarts().filter((x) => x < from);
      return before.length ? before[before.length - 1] : 0;
    }
    return from - 1;
  }

  function tick() {
    const t = total();
    const nxt = nextIndex(state.step);
    if (nxt >= t - 1) { goto(t - 1); pause(); return; }
    goto(nxt);
  }

  function play() {
    if (timer) return;
    if (state.step >= total() - 1) set({ step: 0 });
    set({ playing: true });
    timer = setInterval(tick, BASE_MS / state.speed);
  }

  function pause() {
    if (timer) { clearInterval(timer); timer = null; }
    if (state.playing) set({ playing: false });
  }

  return {
    play,
    pause,
    toggle() { if (state.playing) pause(); else play(); },
    next() { pause(); goto(nextIndex(state.step)); },
    prev() { pause(); goto(prevIndex(state.step)); },
    home() { pause(); goto(0); },
    end() { pause(); goto(total() - 1); },
    nextOp() {
      pause();
      const s = opStarts().find((x) => x > state.step);
      goto(s === undefined ? total() - 1 : s);
    },
    prevOp() {
      pause();
      const before = opStarts().filter((x) => x < state.step);
      goto(before.length ? before[before.length - 1] : 0);
    },
    restartTimerIfPlaying() {
      applySpeed();
      if (timer) { clearInterval(timer); timer = setInterval(tick, BASE_MS / state.speed); }
    },
  };
}
