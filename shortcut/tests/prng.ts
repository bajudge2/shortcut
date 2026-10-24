// Seeded property-test helper. fast-check is not installed, so property tests use this.
// Not matched by the `tests/*.test.ts` glob: it is imported by tests, never run on its own.

/** Uniform random number in [0, 1). */
export type Rng = () => number;
/** A generator draws one value from the rng. */
export type Gen<T> = (rng: Rng) => T;

/** Small, fast, deterministic 32-bit PRNG. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Integer in [lo, hi], inclusive on both ends. */
export function int(lo: number, hi: number): Gen<number> {
  return (rng) => lo + Math.floor(rng() * (hi - lo + 1));
}

/** One element of a non-empty array. */
export function pick<T>(arr: readonly T[]): Gen<T> {
  if (arr.length === 0) throw new Error('pick: empty array');
  return (rng) => arr[Math.floor(rng() * arr.length)];
}

export function bool(): Gen<boolean> {
  return (rng) => rng() < 0.5;
}

/** Array of length in [lo, hi] whose elements come from `gen`. */
export function array<T>(gen: Gen<T>, lo: number, hi: number): Gen<T[]> {
  const len = int(lo, hi);
  return (rng) => {
    const n = len(rng);
    const out: T[] = [];
    for (let i = 0; i < n; i++) out.push(gen(rng));
    return out;
  };
}

export const DEFAULT_SEED = 0x5eed1234;

function resolveSeed(seed?: number): number {
  if (seed !== undefined) return seed >>> 0;
  const env = process.env.PBT_SEED;
  if (env !== undefined && env.trim() !== '') {
    const n = Number(env);
    if (!Number.isFinite(n)) throw new Error(`PBT_SEED is not a number: ${env}`);
    return n >>> 0;
  }
  return DEFAULT_SEED;
}

function show(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export interface ForAllOptions {
  runs?: number;
  seed?: number;
}

/**
 * Run `prop` against `runs` cases drawn from `gen`. A case fails if `prop`
 * throws or returns `false`. The error names the seed, run index, and case.
 * An explicit `seed` option wins over `PBT_SEED`, which wins over DEFAULT_SEED.
 */
export function forAll<T>(
  name: string,
  gen: Gen<T>,
  prop: (value: T) => void | boolean,
  { runs = 100, seed }: ForAllOptions = {},
): void {
  const s = resolveSeed(seed);
  const rng = mulberry32(s);
  for (let i = 0; i < runs; i++) {
    const value = gen(rng);
    let cause: unknown;
    let failed = false;
    try {
      if (prop(value) === false) failed = true;
    } catch (err) {
      failed = true;
      cause = err;
    }
    if (failed) {
      const reason = cause instanceof Error ? cause.message : cause === undefined ? 'property returned false' : String(cause);
      throw new Error(
        `Property "${name}" failed (seed=${s}, run=${i}/${runs})\nCase: ${show(value)}\n${reason}`,
      );
    }
  }
}
