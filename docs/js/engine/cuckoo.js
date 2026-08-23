// The three structures, ported from the reference, emitting the same records
// that tools/cxx/trace_gen.cc writes.
//
// This is the only code on the site that computes rather than replays. It is
// used by the sandbox, by the textbook-mode comparison, and by the load-factor
// lab, and every one of those is badged so that a reader can tell recorded data
// from computed data. docs/selftest.html replays every shipped trace through
// this file and compares byte for byte; if anything differs, the flag below
// goes false and the pages that use it say so.
//
// Sources: pir/hashing/cuckoo_hash_table.cc lines 67-90,
//          pir/hashing/multiple_choice_hash_table.cc lines 57-72,
//          pir/hashing/simple_hash_table.cc lines 55-70.

import { sha256, utf8, toHex, concat } from './sha256.js';
import { MT19937_64, UniformIndex } from './mt19937.js';

const MASK64 = (1n << 64n) - 1n;

export const engine = { verified: null, note: 'not tested yet' };

export function markVerified(ok, note) {
  engine.verified = ok;
  engine.note = note;
}

/** Deep comparison that ignores key order. Returns the first few differences. */
export function diff(a, b, path, out) {
  if (out.length > 4) return out;
  if (a === b) return out;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) { out.push(`${path}: one is an array`); return out; }
    if (a.length !== b.length) { out.push(`${path}: length ${a.length} vs ${b.length}`); return out; }
    for (let i = 0; i < a.length; i++) diff(a[i], b[i], `${path}[${i}]`, out);
    return out;
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (!(k in a)) { out.push(`${path}.${k}: missing from the engine`); continue; }
      if (!(k in b)) { out.push(`${path}.${k}: only in the engine`); continue; }
      diff(a[k], b[k], `${path}.${k}`, out);
    }
    return out;
  }
  out.push(`${path}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
  return out;
}

/**
 * Run one recorded trace back through this engine and compare every field.
 *
 * docs/selftest.html does this for all of them. The pages that show computed
 * numbers do it once, for one trace, before they draw anything: a badge that
 * says "the reference's numbers" has to be earned in the page, not only in
 * continuous integration.
 */
export function verifyAgainst(trace) {
  if (engine.verified !== null) return engine.verified;
  try {
    const got = run({
      id: trace.id, structure: trace.structure, title: trace.title,
      teaches: trace.teaches,
      numBuckets: trace.params.numBuckets, k: trace.params.numHashFunctions,
      maxRelocations: trace.params.maxRelocations,
      maxStashSize: trace.params.maxStashSize,
      maxBucketSize: trace.params.maxBucketSize,
      familySeedHex: trace.params.familySeedHex,
      elements: trace.elements,
      lookups: trace.ops.filter((o) => o.op === 'lookup').map((o) => o.arg),
    });
    delete got.provenance;
    const out = diff(got, trace, trace.id, []);
    markVerified(out.length === 0, out.length === 0
      ? `reproduced ${trace.id} field for field`
      : out.slice(0, 2).join('; '));
  } catch (e) {
    markVerified(false, 'the engine threw: ' + e.message);
  }
  return engine.verified;
}

/** hash_family.cc:36, and hash_family.h:48 for the session seed. */
export function perFunctionSeeds(k, familySeedBytes) {
  const base = familySeedBytes || new Uint8Array(0);
  const out = [];
  for (let i = 0; i < k; i++) out.push(concat(base, utf8(String(i))));
  return out;
}

function leBytes(bytes, from, to) {
  let v = 0n;
  for (let i = to - 1; i >= from; i--) v = (v << 8n) | BigInt(bytes[i]);
  return v;
}

/** SHA256HashFunction::operator(), with every intermediate value. */
export function ladder(seedBytes, inputBytes, m) {
  const digest = sha256(concat(seedBytes, inputBytes));
  const lo = leBytes(digest, 0, 16);
  const hi = leBytes(digest, 16, 32);
  const M = BigInt(m);
  const r1 = hi % M;
  const d2 = (r1 << 64n) | (lo >> 64n);
  const r2 = d2 % M;
  const d3 = (r2 << 64n) | (lo & MASK64);
  const r3 = d3 % M;
  return {
    digest, digestHex: toHex(digest),
    lo, hi, n: (hi << 128n) | lo,
    r1: Number(r1), d2, r2: Number(r2), d3, r3: Number(r3),
    bucket: Number(r3),
  };
}

const hex128 = (v) => '0x' + v.toString(16).padStart(32, '0');
const hex64 = (v) => '0x' + v.toString(16).padStart(16, '0');

function hashStep(s, j, input, seedBytes, seedText, L, m, file, line, i) {
  const st = {
    s, kind: 'hash', j, input,
    seed: seedText, seedHex: toHex(seedBytes),
    preimageHex: toHex(concat(seedBytes, utf8(input))),
    digestHex: L.digestHex,
    loHex: hex128(L.lo), hiHex: hex128(L.hi), nDec: L.n.toString(10), m,
    ladder: {
      r1: L.r1, r1Line: 80,
      d2: L.d2.toString(10), d2Hex: hex128(L.d2), r2: L.r2, r2Line: 83,
      d3: L.d3.toString(10), d3Hex: hex128(L.d3), r3: L.r3, r3Line: 86,
    },
    bucket: L.bucket,
    codeLoc: { file, line },
  };
  if (i !== undefined && i >= 0) st.i = i;
  return st;
}

/**
 * Run a scenario and return a trace with the same shape as a recorded one.
 * `spec` is {structure, numBuckets, k, maxRelocations, maxStashSize,
 *            maxBucketSize, familySeedHex, elements, lookups}.
 */
export function run(spec) {
  const m = spec.numBuckets;
  const k = spec.k;
  const familySeed = spec.familySeedHex
    ? Uint8Array.from(spec.familySeedHex.match(/../g).map((x) => parseInt(x, 16)))
    : new Uint8Array(0);
  const seeds = perFunctionSeeds(k, familySeed);
  const seedTexts = seeds.map((b) => new TextDecoder('latin1').decode(b));
  const full = m <= 24;

  const trace = {
    schemaVersion: 1,
    id: spec.id || 'sandbox',
    structure: spec.structure,
    title: spec.title || 'A run you made',
    teaches: spec.teaches || '',
    snapshots: full ? 'full' : 'op',
    provenance: 'sandbox',
    params: {
      numBuckets: m, numHashFunctions: k,
      maxRelocations: spec.maxRelocations || 0,
      maxStashSize: spec.maxStashSize === undefined ? null : spec.maxStashSize,
      maxBucketSize: spec.maxBucketSize === undefined ? null : spec.maxBucketSize,
      hashFamily: 'SHA256',
      familySeedHex: spec.familySeedHex || '',
      perFunctionSeedsHex: seeds.map(toHex),
      perFunctionSeeds: seedTexts,
      rng: spec.structure === 'cuckoo'
        ? 'std::mt19937_64 default-constructed (seed 5489)' : 'none',
    },
    elements: spec.elements.slice(),
    candidates: {},
    ops: [],
    eventCounts: {},
    opCount: 0,
    microStepCount: 0,
  };

  const names = [...new Set([...spec.elements, ...(spec.lookups || [])])].sort();
  for (const name of names) {
    trace.candidates[name] = seeds.map((sd) => ladder(sd, utf8(name), m).bucket);
  }

  let s = 0;
  const bump = (kind) => { trace.eventCounts[kind] = (trace.eventCounts[kind] || 0) + 1; };

  if (spec.structure === 'cuckoo') {
    const table = new Array(m).fill(null);
    const stash = [];
    const index = new UniformIndex(k);
    const budget = spec.maxRelocations || 0;
    const bound = trace.params.maxStashSize;

    for (const element of spec.elements) {
      const tableBefore = table.slice();
      const stashBefore = stash.slice();
      const steps = [];
      let current = element;
      let placed = false;
      let used = budget;

      for (let i = 0; i < budget; i++) {
        const d = index.draw();
        const bits = d.bits32;
        const drawStep = {
          s: s++, kind: 'draw', i, j: d.j, k,
          raw: d.raws.map((x) => x.toString(10)),
          rawHex: d.raws.map(hex64),
          bits32: Number(bits),
          redraws: d.raws.length - 1,
          codeLoc: { file: 'pir/hashing/cuckoo_hash_table.cc', line: 71 },
        };
        if (((k - 1) & k) === 0) {
          drawStep.mapKind = 'mask';
          drawStep.mapFormula = `bits32 & ${k - 1} = ${d.j}`;
          drawStep.product = null;
          drawStep.rejectThreshold = 0;
        } else {
          drawStep.mapKind = 'multiply-shift';
          drawStep.mapFormula = `floor(${bits} * ${k} / 2^32) = ${d.j}`;
          drawStep.product = d.product.toString(10);
          drawStep.productLow32 = Number(d.product & 0xffffffffn);
          drawStep.rejectThreshold = Number((1n << 32n) % BigInt(k));
        }
        steps.push(drawStep);
        bump('draw');

        const L = ladder(seeds[d.j], utf8(current), m);
        steps.push(hashStep(s++, d.j, current, seeds[d.j], seedTexts[d.j], L, m,
          'pir/hashing/sha256_hash_family.cc', 59, i));
        bump('hash');

        const b = L.bucket;
        if (table[b] !== null) {
          const outgoing = table[b];
          const st = {
            s: s++, kind: 'evict', i, bucket: b, incoming: current, outgoing,
            codeLoc: { file: 'pir/hashing/cuckoo_hash_table.cc', line: 75 },
          };
          table[b] = current;
          current = outgoing;
          if (full) { st.tableAfter = table.slice(); st.stashAfter = stash.slice(); }
          steps.push(st);
          bump('evict');
        } else {
          const st = {
            s: s++, kind: 'place', i, bucket: b, element: current,
            codeLoc: { file: 'pir/hashing/cuckoo_hash_table.cc', line: 78 },
          };
          table[b] = current;
          if (full) { st.tableAfter = table.slice(); st.stashAfter = stash.slice(); }
          steps.push(st);
          bump('place');
          placed = true;
          used = i + 1;
          break;
        }
      }

      let status = 'ok';
      let statusCode = 'OK';
      let message;
      if (!placed) {
        if (bound !== null && stash.length >= bound) {
          status = 'error';
          statusCode = 'INTERNAL';
          message = 'Cannot insert element: stash is full';
          const st = {
            s: s++, kind: 'stash_overflow_error', element: current,
            statusCode, message,
            codeLoc: { file: 'pir/hashing/cuckoo_hash_table.cc', line: 85 },
          };
          if (full) { st.tableAfter = table.slice(); st.stashAfter = stash.slice(); }
          steps.push(st);
          bump('stash_overflow_error');
        } else {
          const st = {
            s: s++, kind: 'stash_push', element: current,
            stashIndexAfter: stash.length,
            codeLoc: { file: 'pir/hashing/cuckoo_hash_table.cc', line: 87 },
          };
          stash.push(current);
          if (full) { st.tableAfter = table.slice(); st.stashAfter = stash.slice(); }
          steps.push(st);
          bump('stash_push');
        }
      }

      trace.ops.push({
        op: 'insert', arg: element, status, statusCode,
        ...(message ? { message } : {}),
        relocationsUsed: used, maxRelocations: budget,
        tableBefore, stashBefore,
        tableAfter: table.slice(), stashAfter: stash.slice(),
        steps,
      });
    }

    for (const q of (spec.lookups || [])) {
      const steps = [];
      let hit = false;
      let hitBucket = -1;
      const buckets = [];
      for (let j = 0; j < k; j++) {
        const L = ladder(seeds[j], utf8(q), m);
        buckets.push(L.bucket);
        steps.push(hashStep(s++, j, q, seeds[j], seedTexts[j], L, m,
          'pir/cuckoo_hashing_sparse_dpf_pir_client.cc', 140, -1));
        bump('hash');
        const occ = table[L.bucket];
        const match = occ !== null && occ === q;
        steps.push({
          s: s++, kind: 'probe', j, bucket: L.bucket, occupant: occ, match,
          codeLoc: { file: 'pir/cuckoo_hashing_sparse_dpf_pir_client.cc', line: 140 },
        });
        bump('probe');
        if (match && !hit) { hit = true; hitBucket = L.bucket; }
      }
      const foundAt = stash.indexOf(q);
      steps.push({
        s: s++, kind: 'stash_scan', stashSize: stash.length, foundAt,
        codeLoc: { file: 'pir/cuckoo_hashed_dpf_pir_database.cc', line: 155 },
      });
      bump('stash_scan');
      steps.push({
        s: s++, kind: 'result', foundInTable: hit, bucket: hitBucket,
        foundInStash: foundAt >= 0, probes: k,
        codeLoc: { file: 'pir/cuckoo_hashing_sparse_dpf_pir_client.cc', line: 140 },
      });
      bump('result');
      trace.ops.push({
        op: 'lookup', arg: q, status: 'ok', statusCode: 'OK',
        foundInTable: hit, bucket: hitBucket, foundInStash: foundAt >= 0,
        candidateBuckets: buckets,
        tableBefore: table.slice(), stashBefore: stash.slice(),
        tableAfter: table.slice(), stashAfter: stash.slice(),
        steps,
      });
    }

    trace.finalTable = table.slice();
    trace.finalStash = stash.slice();
  } else {
    const buckets = Array.from({ length: m }, () => []);
    const cap = trace.params.maxBucketSize;
    const isMcht = spec.structure === 'multiple_choice';

    for (const element of spec.elements) {
      const before = buckets.map((b) => b.slice());
      const steps = [];
      const hashes = [];
      let smallest = 0;
      let status = 'ok';
      let statusCode = 'OK';
      let message;

      for (let j = 0; j < k; j++) {
        const L = ladder(seeds[j], utf8(element), m);
        const file = isMcht ? 'pir/hashing/multiple_choice_hash_table.cc'
                            : 'pir/hashing/simple_hash_table.cc';
        steps.push(hashStep(s++, j, element, seeds[j], seedTexts[j], L, m,
          file, isMcht ? 61 : 58, -1));
        bump('hash');
        if (isMcht) {
          if (j === 0 || buckets[L.bucket].length < buckets[smallest].length) {
            smallest = L.bucket;
          }
          hashes.push(L.bucket);
        } else {
          hashes.push(L.bucket);
          const size = buckets[L.bucket].length;
          const isFull = cap !== null && size >= cap;
          steps.push({
            s: s++, kind: 'capacity_check', j, bucket: L.bucket, size,
            maxBucketSize: cap, full: isFull,
            codeLoc: { file: 'pir/hashing/simple_hash_table.cc', line: 59 },
          });
          bump('capacity_check');
          if (isFull) {
            status = 'error';
            statusCode = 'INTERNAL';
            message = 'Cannot insert element: maximum bucket size reached';
            const st = {
              s: s++, kind: 'bucket_full_error', bucket: L.bucket, element,
              statusCode, message,
              codeLoc: { file: 'pir/hashing/simple_hash_table.cc', line: 60 },
            };
            if (full) st.bucketsAfter = buckets.map((b) => b.slice());
            steps.push(st);
            bump('bucket_full_error');
            break;
          }
        }
      }

      if (isMcht) {
        steps.push({
          s: s++, kind: 'choose', bucket: smallest,
          candidates: hashes.map((b, j) => ({
            j, bucket: b, size: buckets[b].length, chosen: b === smallest,
          })),
          codeLoc: { file: 'pir/hashing/multiple_choice_hash_table.cc', line: 62 },
        });
        bump('choose');
        if (cap !== null && buckets[smallest].length >= cap) {
          status = 'error';
          statusCode = 'INTERNAL';
          message = 'Cannot insert element: maximum bucket size reached';
          const st = {
            s: s++, kind: 'bucket_full_error', bucket: smallest, element,
            statusCode, message,
            codeLoc: { file: 'pir/hashing/multiple_choice_hash_table.cc', line: 67 },
          };
          if (full) st.bucketsAfter = buckets.map((b) => b.slice());
          steps.push(st);
          bump('bucket_full_error');
        } else {
          buckets[smallest].push(element);
          const st = {
            s: s++, kind: 'append', bucket: smallest, element,
            codeLoc: { file: 'pir/hashing/multiple_choice_hash_table.cc', line: 70 },
          };
          if (full) st.bucketsAfter = buckets.map((b) => b.slice());
          steps.push(st);
          bump('append');
        }
      } else if (status === 'ok') {
        for (let j = 0; j < hashes.length; j++) {
          buckets[hashes[j]].push(element);
          const st = {
            s: s++, kind: 'append', j, bucket: hashes[j], element,
            codeLoc: { file: 'pir/hashing/simple_hash_table.cc', line: 67 },
          };
          if (full) st.bucketsAfter = buckets.map((b) => b.slice());
          steps.push(st);
          bump('append');
        }
      }

      trace.ops.push({
        op: 'insert', arg: element, status, statusCode,
        ...(message ? { message } : {}),
        bucketsBefore: before,
        bucketsAfter: buckets.map((b) => b.slice()),
        steps,
      });
    }
    trace.finalBuckets = buckets.map((b) => b.slice());
  }

  trace.opCount = trace.ops.length;
  trace.microStepCount = s;
  return trace;
}

/**
 * Textbook cuckoo hashing, for contrast. This is NOT the reference.
 *
 * Pagh and Rodler's construction looks at all k candidates and takes an empty
 * one if there is one; on failure it draws a new seed and builds the table
 * again. The reference does neither. Everything that uses this is badged.
 */
export function runTextbook(spec) {
  const m = spec.numBuckets;
  const k = spec.k;
  const maxRebuilds = spec.maxRebuilds === undefined ? 8 : spec.maxRebuilds;
  let epoch = 0;
  const log = [];

  for (;;) {
    const seeds = perFunctionSeeds(k, utf8('rebuild' + epoch));
    const table = new Array(m).fill(null);
    const rng = new MT19937_64();
    const index = new UniformIndex(k, rng);
    let failedOn = null;
    const inserted = [];

    for (const element of spec.elements) {
      let current = element;
      let ok = false;
      for (let i = 0; i < (spec.maxRelocations || m); i++) {
        const cands = seeds.map((sd) => ladder(sd, utf8(current), m).bucket);
        // The textbook difference: look at every candidate first.
        const free = cands.find((b) => table[b] === null);
        if (free !== undefined) { table[free] = current; ok = true; break; }
        const j = index.draw().j;
        const b = cands[j];
        const out = table[b];
        table[b] = current;
        current = out;
      }
      if (!ok) { failedOn = current; break; }
      inserted.push(element);
    }

    log.push({ epoch, seedPrefix: 'rebuild' + epoch, inserted: inserted.length, failedOn });
    if (failedOn === null) {
      return { ok: true, epochs: log, table, seedPrefix: 'rebuild' + epoch };
    }
    epoch++;
    if (epoch > maxRebuilds) {
      return { ok: false, epochs: log, table, seedPrefix: 'rebuild' + (epoch - 1) };
    }
  }
}
