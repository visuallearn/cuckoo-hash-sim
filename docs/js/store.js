// One mutable state object plus subscribers. Two notification kinds:
//   'structure' -- the thing being viewed changed (scenario, route, toggles),
//                  so views rebuild their DOM;
//   'step'      -- only the position in the trace moved, so views retint.
// Keeping those apart is what makes playback smooth without a virtual DOM.

const listeners = { structure: [], step: [] };

export const state = {
  manifest: null,
  code: null,
  trace: null,
  route: 'tour',
  scenario: 'CK-classroom',
  step: 0,              // a global micro-step index inside the trace
  playing: false,
  speed: 1,
  granularity: 'micro', // 'micro' | 'op'
  tourStep: 0,
  hashElement: 'ant',
  hashFunction: 0,
  hashBound: 6,
  codeDoc: 'cuckoo_insert',
  codeFollow: true,
  predict: false,
  variant: 'multiple_choice',
  labK: 3,
  showAllCandidates: true,
};

/**
 * Subscribe. Returns an unsubscribe function. A route MUST call it from
 * unmount(), or navigating away and back leaves the old route's handlers
 * running against detached DOM for the rest of the session.
 */
export function on(kind, fn) {
  listeners[kind].push(fn);
  return function off() {
    const i = listeners[kind].indexOf(fn);
    if (i >= 0) listeners[kind].splice(i, 1);
  };
}

export function emit(kind) {
  // Iterate a copy: a handler may unsubscribe while we are notifying it, and
  // splicing the live array mid-loop would skip a listener.
  for (const fn of listeners[kind].slice()) fn(state);
}

export function listenerCount() {
  return listeners.structure.length + listeners.step.length;
}

const STEP_ONLY = new Set(['step', 'playing']);

export function set(patch) {
  let structural = false;
  for (const [k, v] of Object.entries(patch)) {
    if (state[k] === v) continue;
    state[k] = v;
    if (!STEP_ONLY.has(k)) structural = true;
  }
  emit(structural ? 'structure' : 'step');
}
