import { createHash } from 'node:crypto';

export type RngState = readonly [number, number, number, number];
const U32_RANGE = 0x1_0000_0000;
const U64_MASK = 0xffff_ffff_ffff_ffffn;

function rotl(value: number, bits: number): number {
  return ((value << bits) | (value >>> (32 - bits))) >>> 0;
}

function checkedState(state: RngState): [number, number, number, number] {
  if (
    !Array.isArray(state) ||
    state.length !== 4 ||
    !Array.from(state).every((value) => Number.isInteger(value) && value >= 0 && value < U32_RANGE) ||
    state.every((value) => value === 0)
  ) {
    throw new RangeError('RNG state must contain four u32 values and must not be all zero');
  }
  return [state[0], state[1], state[2], state[3]];
}

/** xoshiro128** with the pinned splitmix64 seed expansion; never use this for security tokens. */
export class Rng {
  readonly seed: bigint;
  #state: [number, number, number, number];

  constructor(seed: bigint) {
    if (typeof seed !== 'bigint' || seed < 0n || seed > U64_MASK)
      throw new RangeError('RNG seed must be u64');
    this.seed = seed;
    let x = seed;
    const splitmix64 = (): bigint => {
      x = (x + 0x9e37_79b9_7f4a_7c15n) & U64_MASK;
      let z = x;
      z = ((z ^ (z >> 30n)) * 0xbf58_476d_1ce4_e5b9n) & U64_MASK;
      z = ((z ^ (z >> 27n)) * 0x94d0_49bb_1331_11ebn) & U64_MASK;
      return z ^ (z >> 31n);
    };
    const a = splitmix64();
    const b = splitmix64();
    this.#state = checkedState([
      Number(a & 0xffff_ffffn),
      Number(a >> 32n),
      Number(b & 0xffff_ffffn),
      Number(b >> 32n),
    ]);
  }

  static fromState(state: RngState, seed = 0n): Rng {
    const rng = new Rng(seed);
    rng.#state = checkedState(state);
    return rng;
  }

  /** A copy suitable for reproducing a stream without sharing mutable state. */
  get state(): RngState {
    return [...this.#state];
  }

  nextU32(): number {
    let [s0, s1, s2, s3] = this.#state;
    const result = Math.imul(rotl(Math.imul(s1, 5), 7), 9) >>> 0;
    const t = s1 << 9;
    s2 ^= s0;
    s3 ^= s1;
    s1 ^= s2;
    s0 ^= s3;
    s2 ^= t;
    s3 = rotl(s3, 11);
    this.#state = [s0 >>> 0, s1 >>> 0, s2 >>> 0, s3 >>> 0];
    return result;
  }

  nextFloat(): number {
    const a = this.nextU32();
    const b = this.nextU32();
    return ((a >>> 5) * 67_108_864 + (b >>> 6)) / 9_007_199_254_740_992;
  }

  nextInt(n: number): number {
    if (!Number.isSafeInteger(n) || n < 1 || n > U32_RANGE) throw new RangeError('RNG bound must be 1…2^32');
    const limit = Math.floor(U32_RANGE / n) * n;
    let value: number;
    do value = this.nextU32();
    while (value >= limit);
    return value % n;
  }

  shuffle<T>(items: T[]): T[] {
    for (let index = items.length - 1; index > 0; index--) {
      const other = this.nextInt(index + 1);
      const value = items[index]!;
      items[index] = items[other]!;
      items[other] = value;
    }
    return items;
  }

  fork(label: string): Rng {
    if (typeof label !== 'string') throw new TypeError('RNG fork label must be a string');
    const prefix = Buffer.alloc(17);
    prefix.write('BDTS-RNG', 0, 'ascii');
    prefix.writeBigUInt64LE(this.seed, 9);
    const digest = createHash('sha256').update(prefix).update(label, 'utf8').digest();
    return new Rng(digest.readBigUInt64LE(0));
  }
}
