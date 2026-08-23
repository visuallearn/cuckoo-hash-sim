// One or two sentences for the current micro-step, in Simplified Technical
// English. The event log and the screen-reader mirror use the same text, so
// the animation is never the only carrier of information.

import { hName } from './fmt.js';

function tone(kind) {
  if (kind === 'evict' || kind === 'stash_push') return 'evict';
  if (kind === 'stash_overflow_error' || kind === 'bucket_full_error') return 'fail';
  return '';
}

/** { title, detail, tone } for one recorded step. */
export function narrate(trace, frame) {
  const st = frame.st;
  const m = trace.params.numBuckets;
  const k = trace.params.numHashFunctions;
  const budget = trace.params.maxRelocations;
  const arg = frame.op.arg;

  switch (st.kind) {
    case 'draw': {
      const redraw = st.redraws > 0
        ? ` The first ${st.redraws === 1 ? 'word was' : 'words were'} rejected, so the generator gave another one.`
        : '';
      return {
        title: `Attempt ${st.i + 1} of ${budget}. The table draws a random hash function: ${hName(st.j)}.`,
        detail: `The index comes from one word of the Mersenne Twister. ${st.mapFormula}.${redraw} `
          + `The reference draws again on every attempt, and it never looks at the other ${k - 1} candidates.`,
        tone: '',
      };
    }
    case 'hash': {
      const where = frame.op.op === 'lookup' ? 'The query' : 'The element';
      return {
        title: `${hName(st.j)}("${st.input}") = ${st.bucket}.`,
        detail: `${where} goes to bucket ${st.bucket} of ${m}. `
          + `SHA-256 of the seed "${st.seed}" and the input gives 32 bytes. `
          + `Those bytes are one 256-bit number, and three divisions reduce it.`,
        tone: '',
      };
    }
    case 'place':
      return {
        title: `Bucket ${st.bucket} is free, so "${st.element}" stays there.`,
        detail: `The insert is complete. It used ${st.i + 1} of the ${budget} attempts.`,
        tone: '',
      };
    case 'evict':
      return {
        title: `Bucket ${st.bucket} holds "${st.outgoing}". "${st.incoming}" takes the bucket and "${st.outgoing}" comes out.`,
        detail: `A swap, not a search. "${st.outgoing}" is now the element that must find a home, `
          + `and it uses the same budget: attempt ${st.i + 2} of ${budget} comes next.`,
        tone: 'evict',
      };
    case 'stash_push':
      return {
        title: `The budget of ${budget} is used. "${st.element}" goes on the stash.`,
        detail: 'The reference does not make a new set of hash functions and does not build the table again. '
          + 'The stash is its answer to a walk that does not finish.',
        tone: 'evict',
      };
    case 'stash_overflow_error':
      return {
        title: `The stash is full. The insert fails.`,
        detail: `The status is INTERNAL and the message is "${st.message}". `
          + 'This is the only hard failure in the reference.',
        tone: 'fail',
      };
    case 'probe':
      return {
        title: st.match
          ? `Bucket ${st.bucket} holds "${st.occupant}". That is the query.`
          : `Bucket ${st.bucket} holds ${st.occupant === null ? 'nothing' : `"${st.occupant}"`}. That is not the query.`,
        detail: `A lookup reads all ${k} candidate buckets. The client does this, `
          + 'because the table class has no lookup of its own.',
        tone: '',
      };
    case 'stash_scan':
      return {
        title: st.foundAt >= 0
          ? `The query is on the stash, at position ${st.foundAt}.`
          : `The stash holds ${st.stashSize} element${st.stashSize === 1 ? '' : 's'} and none of them is the query.`,
        detail: 'The production database copies only the table, so a key on the stash cannot be found there. '
          + 'The parameters are chosen to keep the stash empty.',
        tone: st.foundAt >= 0 ? 'evict' : '',
      };
    case 'result':
      return {
        title: st.foundInTable
          ? `Found "${arg}" in bucket ${st.bucket} after ${st.probes} probes.`
          : `"${arg}" is not in the table. ${st.probes} probes were enough to know that.`,
        detail: `A lookup always costs ${k} probes and one stash scan, whatever the table holds.`,
        tone: '',
      };
    case 'capacity_check':
      return {
        title: st.full
          ? `Bucket ${st.bucket} already holds ${st.size} element${st.size === 1 ? '' : 's'}. It is full.`
          : `Bucket ${st.bucket} holds ${st.size} element${st.size === 1 ? '' : 's'}.`,
        detail: 'The first loop measures every candidate before the second loop appends anything. '
          + 'A bucket named twice by one element is therefore measured twice at its old size.',
        tone: st.full ? 'fail' : '',
      };
    case 'choose': {
      const parts = st.candidates.map((c) => `${hName(c.j)}→${c.bucket} (${c.size})`).join(', ');
      return {
        title: `Bucket ${st.bucket} has the fewest elements. It takes "${arg}".`,
        detail: `The candidates are ${parts}. The test is a strict "less than", so the first `
          + 'of two equal counts keeps the choice.',
        tone: '',
      };
    }
    case 'append':
      return {
        title: `"${st.element}" goes into bucket ${st.bucket}.`,
        detail: st.j === undefined
          ? 'Nothing is evicted. A bucketed table grows the bucket instead.'
          : `This is the copy for ${hName(st.j)}. Every hash function gets one copy.`,
        tone: '',
      };
    case 'bucket_full_error':
      return {
        title: 'The bucket is at its maximum size. The insert fails.',
        detail: `The status is INTERNAL and the message is "${st.message}".`,
        tone: 'fail',
      };
    default:
      return { title: st.kind, detail: '', tone: tone(st.kind) };
  }
}

/** A compact line for the event log. */
export function logLine(st) {
  switch (st.kind) {
    case 'draw': return `${hName(st.j)}  (word ${st.raw[0]}${st.redraws ? `, +${st.redraws} rejected` : ''})`;
    case 'hash': return `${hName(st.j)}("${st.input}") = ${st.bucket}`;
    case 'place': return `bucket ${st.bucket} <- ${st.element}`;
    case 'evict': return `bucket ${st.bucket}: ${st.outgoing} out, ${st.incoming} in`;
    case 'stash_push': return `stash[${st.stashIndexAfter}] <- ${st.element}`;
    case 'stash_overflow_error': return st.message;
    case 'probe': return `bucket ${st.bucket} = ${st.occupant === null ? '(empty)' : st.occupant}${st.match ? '  match' : ''}`;
    case 'stash_scan': return st.foundAt >= 0 ? `stash[${st.foundAt}] matches` : `stash: ${st.stashSize} scanned, no match`;
    case 'result': return st.foundInTable ? `found in bucket ${st.bucket}` : 'not found';
    case 'capacity_check': return `bucket ${st.bucket} size ${st.size}${st.full ? ' FULL' : ''}`;
    case 'choose': return `bucket ${st.bucket} is least loaded`;
    case 'append': return `bucket ${st.bucket} += ${st.element}`;
    case 'bucket_full_error': return st.message;
    default: return st.kind;
  }
}
