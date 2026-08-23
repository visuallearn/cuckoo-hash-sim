// Turn a recorded trace plus a step index into something the views can draw.
//
// The traces carry a full snapshot per operation, and the small ones carry a
// snapshot per micro-step as well. This module always rebuilds from the
// operation's own "before" state by applying the recorded changes, which is at
// most `max_relocations` steps of work, and it compares its result against the
// per-step snapshot whenever one is present. So the snapshots are checked here
// too, not only in the self-test.

/** Every micro-step of every operation, in one list, with back-references. */
export function flatten(trace) {
  const steps = [];
  const opStarts = [];
  trace.ops.forEach((op, opIndex) => {
    opStarts.push({ opIndex, op, s: steps.length, count: op.steps.length });
    op.steps.forEach((st, local) => {
      steps.push({ st, op, opIndex, local, s: steps.length });
    });
  });
  return { steps, opStarts, total: steps.length };
}

/** The operation that contains a global step index. */
export function opAt(flat, s) {
  const i = Math.max(0, Math.min(s, flat.total - 1));
  return flat.steps[i] ? flat.steps[i].opIndex : 0;
}

function cloneBuckets(b) { return b.map((x) => x.slice()); }

/**
 * The state after the micro-step at global index `s` has happened.
 * Returns a frame the views read; nothing here computes hashing or arithmetic.
 */
export function frameAt(trace, flat, s) {
  const total = flat.total;
  const idx = Math.max(0, Math.min(s, total - 1));
  const cur = flat.steps[idx];
  if (!cur) return null;
  const { op, opIndex, local, st } = cur;

  const cuckoo = trace.structure === 'cuckoo';
  const frame = {
    index: idx, total, st, op, opIndex, local,
    kind: st.kind,
    table: null, stash: null, buckets: null,
    walker: null, walkerFrom: null,
    hotBucket: null, evictedBucket: null,
    activeJ: null, activeBucket: null, iteration: null,
    candidateBuckets: null,
    mismatch: null,
  };

  if (cuckoo && op.op !== 'lookup') {
    const table = op.tableBefore.slice();
    const stash = op.stashBefore.slice();
    let walker = op.arg;
    let walkerFrom = null;
    for (let n = 0; n <= local; n++) {
      const e = op.steps[n];
      if (e.kind === 'evict') {
        const out = table[e.bucket];
        table[e.bucket] = e.incoming;
        walker = out;
        walkerFrom = e.bucket;
      } else if (e.kind === 'place') {
        table[e.bucket] = e.element;
        walker = null;
        walkerFrom = null;
      } else if (e.kind === 'stash_push') {
        stash.push(e.element);
        walker = null;
        walkerFrom = null;
      }
    }
    frame.table = table;
    frame.stash = stash;
    frame.walker = walker;
    frame.walkerFrom = walkerFrom;
    if (st.tableAfter) {
      const same = st.tableAfter.length === table.length
        && st.tableAfter.every((v, i) => v === table[i]);
      if (!same) frame.mismatch = 'the recorded snapshot and the replay disagree';
    }
  } else if (cuckoo) {
    frame.table = op.tableBefore.slice();
    frame.stash = op.stashBefore.slice();
  } else {
    const buckets = cloneBuckets(op.bucketsBefore);
    for (let n = 0; n <= local; n++) {
      const e = op.steps[n];
      if (e.kind === 'append') buckets[e.bucket].push(e.element);
    }
    frame.buckets = buckets;
    if (st.bucketsAfter) {
      const same = JSON.stringify(st.bucketsAfter) === JSON.stringify(buckets);
      if (!same) frame.mismatch = 'the recorded snapshot and the replay disagree';
    }
  }

  // The most recent draw and hash inside this operation set what is lit.
  let lastHashInput = null;
  for (let n = 0; n <= local; n++) {
    const e = op.steps[n];
    if (e.kind === 'draw') { frame.activeJ = e.j; frame.iteration = e.i; }
    if (e.kind === 'hash') {
      // A lookup and a bucketed insert have no draw, so the hash itself says
      // which function is in use.
      frame.activeJ = e.j;
      frame.activeBucket = e.bucket;
      lastHashInput = e.input;
      if (e.i !== undefined) frame.iteration = e.i;
    }
  }
  frame.lastHashInput = lastHashInput;
  if (st.kind === 'evict') { frame.evictedBucket = st.bucket; frame.hotBucket = st.bucket; }
  else if (st.kind === 'place' || st.kind === 'append' || st.kind === 'probe') frame.hotBucket = st.bucket;
  else if (st.kind === 'hash') frame.hotBucket = st.bucket;
  else if (frame.activeBucket !== null) frame.hotBucket = frame.activeBucket;

  // The arrows describe the element that is in hand. After a place or a stash
  // push nothing is in hand, so they describe the element that just settled.
  const walkerName = frame.walker !== null && frame.walker !== undefined
    ? frame.walker : (lastHashInput || op.arg);
  frame.candidateBuckets = trace.candidates[walkerName] || trace.candidates[op.arg] || null;
  frame.walkerName = walkerName;
  // Light an arrow only when the element it belongs to is the one that was just
  // hashed. An eviction changes the element in hand, so at that step the arrows
  // are the new walker's homes and none of them has been tried yet.
  frame.litJ = walkerName === lastHashInput ? frame.activeJ : null;
  return frame;
}

/** Micro-step indices at which each operation starts, for the coarse ticks. */
export function opTicks(flat) {
  return flat.opStarts;
}

/** The count of each event kind up to and including `s`. */
export function countsUpTo(flat, s) {
  const out = {};
  for (let i = 0; i <= Math.min(s, flat.total - 1); i++) {
    const k = flat.steps[i].st.kind;
    out[k] = (out[k] || 0) + 1;
  }
  return out;
}
