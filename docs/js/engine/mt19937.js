// std::mt19937_64 and the index mapping abseil puts on top of it.
//
// Both are written from their specifications. The Mersenne Twister is defined
// by the C++ standard, and a default-constructed one uses seed 5489. The
// mapping is transcribed from abseil 20240722.0:
//
//   absl/random/internal/fast_uniform_bits.h
//     FastUniformBits<uint32_t> over a generator whose range is the whole of
//     uint64_t takes the simplified loop, with one iteration and no shift. That
//     is a plain narrowing cast: the low 32 bits of one word.
//   absl/random/uniform_int_distribution.h
//     Generate() masks when the range is a power of two, and otherwise does a
//     wide multiply and keeps the high half, redrawing while the low half is
//     below 2^32 mod k.
//
// The unsigned type is uint32_t, not uint64_t, because
// uniform_int_distribution<int> derives it from the width of `unsigned int`.
// Using 64-bit arithmetic here would change every index.
//
// docs/selftest.html replays the golden draws recorded from the real abseil
// through this file, and replays every draw in every shipped trace as well.

const MASK64 = (1n << 64n) - 1n;
const MASK32 = 0xffffffffn;

export class MT19937_64 {
  constructor(seed = 5489n) {
    this.N = 312;
    this.M = 156;
    this.A = 0xb5026f5aa96619e9n;
    this.UPPER = 0xffffffff80000000n;
    this.LOWER = 0x000000007fffffffn;
    this.mt = new Array(this.N);
    this.mt[0] = BigInt(seed) & MASK64;
    for (let i = 1; i < this.N; i++) {
      const prev = this.mt[i - 1];
      this.mt[i] = (6364136223846793005n * (prev ^ (prev >> 62n)) + BigInt(i)) & MASK64;
    }
    this.index = this.N;
  }

  twist() {
    for (let i = 0; i < this.N; i++) {
      const x = (this.mt[i] & this.UPPER) | (this.mt[(i + 1) % this.N] & this.LOWER);
      let xa = x >> 1n;
      if (x & 1n) xa ^= this.A;
      this.mt[i] = this.mt[(i + this.M) % this.N] ^ xa;
    }
    this.index = 0;
  }

  /** @returns {bigint} the next 64-bit word */
  next() {
    if (this.index >= this.N) this.twist();
    let y = this.mt[this.index++];
    y ^= (y >> 29n) & 0x5555555555555555n;
    y = (y ^ ((y << 17n) & 0x71d67fffeda60000n)) & MASK64;
    y = (y ^ ((y << 37n) & 0xfff7eee000000000n)) & MASK64;
    y ^= y >> 43n;
    return y & MASK64;
  }
}

/** absl::uniform_int_distribution<int>(0, k - 1). */
export class UniformIndex {
  constructor(k, rng) {
    this.k = k;
    this.rng = rng || new MT19937_64();
    this.R = BigInt(k - 1);
    this.Lim = BigInt(k);
    this.threshold = (1n << 32n) % this.Lim;
  }

  /** @returns {{raws: bigint[], j: number, bits32: bigint, product: bigint|null}} */
  draw() {
    const raws = [this.rng.next()];
    let bits = raws[raws.length - 1] & MASK32;
    if ((this.R & this.Lim) === 0n) {
      return { raws, j: Number(bits & this.R), bits32: bits, product: null };
    }
    let product = bits * this.Lim;
    while ((product & MASK32) < this.threshold) {
      raws.push(this.rng.next());
      bits = raws[raws.length - 1] & MASK32;
      product = bits * this.Lim;
    }
    return { raws, j: Number(product >> 32n), bits32: bits, product };
  }
}
