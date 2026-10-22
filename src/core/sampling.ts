// A sample against the samples a population could have produced. Nobody's sample matches the
// population exactly, so the question is whether it looks like a realistic draw: draw many
// samples of the same size from a null population, compute the same statistics on each, and see
// where the observed statistics fall among them (a Monte Carlo test).
//
//   population  every draw is a random member of the reference population (a simple random sample)
//   matched     every draw comes from the reference population near a center: the population's
//               share in each bin times a normal kernel with spread in bins (players matched near
//               a rank), placed so that the null's median sits at the center (a lobby is centered
//               on the player it was made for). The center and spread can be given, or fitted so
//               the null's median and middle half equal the sample's; fitted statistics then
//               cannot reject, and only the remaining ones test anything.
//
// Positions are in bins: 0 is the bottom of the first bin, 1 the bottom of the second, and a draw
// spreads evenly inside its bin. Quantiles interpolate inside a bin as the distribution summary
// does; mean, spread and skew use bin midpoints. Statistics compared:
//   median, p25, p75, iqr, mean, skew (Fisher), and shape: the total variation distance between
//   the sample's bin shares and the null's (half the sum of absolute differences, 0 = identical).
// p-values are two-sided for location and spread (2 × the smaller tail) and one-sided for shape
// (a sample can only be too far from the null shape), with the usual +1 correction, so the
// smallest reportable p is 1 / (sims + 1); z is the distance in simulated standard deviations,
// which still separates results beyond the reach of the simulation.
//
// Draws are treated as independent. When they come in clusters (players met in the same game)
// pass designEffect > 1: samples are then drawn at the effective size n / designEffect, which
// widens every band.

export const STATS = ['median', 'p25', 'p75', 'iqr', 'mean', 'skew', 'shape'] as const;
export type Stat = typeof STATS[number];
export type Stats = Record<Stat, number>;

export interface NullSpec {
  kind: 'population' | 'matched';
  /** matched: where the null's median sits, or 'fit' to match the sample's median. */
  center?: number | 'fit';
  /** matched: the kernel's standard deviation in bins, or 'fit' to match the sample's middle half. */
  spread?: number | 'fit';
}

export interface StatTest { lo: number; mid: number; hi: number; sd: number; p: number; z: number | null; fitted?: boolean }

export interface NullResult {
  spec: NullSpec;
  center: number | null;
  spread: number | null;
  /** The null's share per bin (what an infinitely large sample would look like). */
  shares: number[];
  /** 2.5th and 97.5th percentile of a simulated sample's share in each bin. */
  bandLo: number[];
  bandHi: number[];
  /** The null's own statistics (exact, no sampling noise). */
  exact: Stats;
  n: number;
  sims: number;
  tests: Record<Stat, StatTest>;
}

/** Seeded generator (mulberry32), so a tile shows the same simulation every time it draws. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Statistics of bin counts (or shares). expected: the null shares the shape distance is taken against. */
export function statsOf(counts: number[], expected?: number[]): Stats {
  const n = counts.reduce((s, c) => s + c, 0) || 1;
  const q = (p: number) => {
    let before = 0;
    for (let i = 0; i < counts.length; i++) {
      const s = counts[i] / n;
      if (s > 0 && before + s >= p - 1e-12) return i + Math.min(1, Math.max(0, (p - before) / s));
      before += s;
    }
    return counts.length;
  };
  let m1 = 0; for (let i = 0; i < counts.length; i++) m1 += counts[i] / n * (i + 0.5);
  let m2 = 0, m3 = 0;
  for (let i = 0; i < counts.length; i++) { const d = i + 0.5 - m1, w = counts[i] / n; m2 += w * d * d; m3 += w * d * d * d; }
  let shape = 0;
  if (expected) for (let i = 0; i < counts.length; i++) shape += Math.abs(counts[i] / n - expected[i]) / 2;
  const p25 = q(0.25), p75 = q(0.75);
  return { median: q(0.5), p25, p75, iqr: p75 - p25, mean: m1, skew: m2 > 0 ? m3 / Math.pow(m2, 1.5) : 0, shape };
}

/** The matched null's shares: population share times a normal kernel around center (at bin midpoints). */
export function kernelShares(pop: number[], center: number, spread: number): number[] {
  const w = pop.map((p, i) => p * Math.exp(-0.5 * ((i + 0.5 - center) / spread) ** 2));
  const t = w.reduce((s, x) => s + x, 0);
  return t > 0 ? w.map(x => x / t) : pop.map(() => 1 / pop.length);
}

/** The center whose kernel null has the target median (the median rises with the center). */
function fitCenter(pop: number[], spread: number, target: number) {
  let lo = -5, hi = pop.length + 5;
  for (let k = 0; k < 50; k++) { const mid = (lo + hi) / 2; if (statsOf(kernelShares(pop, mid, spread)).median < target) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
}

/** The kernel for a target median, with the given spread or the spread that gives the target middle half. */
function fitKernel(pop: number[], targetMedian: number, targetIqr: number, spread?: number) {
  if (spread != null) return { center: fitCenter(pop, spread, targetMedian), spread };
  let lo = 0.05, hi = pop.length;
  for (let k = 0; k < 40; k++) {
    const s = (lo + hi) / 2, c = fitCenter(pop, s, targetMedian);
    if (statsOf(kernelShares(pop, c, s)).iqr < targetIqr) lo = s; else hi = s;
  }
  const s = (lo + hi) / 2;
  return { center: fitCenter(pop, s, targetMedian), spread: s };
}

function sampleCounts(cum: number[], n: number, r: () => number, out: number[]) {
  out.fill(0);
  const B = cum.length;
  for (let k = 0; k < n; k++) {
    const u = r();
    let lo = 0, hi = B - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid] < u) lo = mid + 1; else hi = mid; }
    out[lo]++;
  }
  return out;
}

const pctl = (sorted: number[], p: number) => { const pos = p * (sorted.length - 1), lo = Math.floor(pos); return lo + 1 < sorted.length ? sorted[lo] + (pos - lo) * (sorted[lo + 1] - sorted[lo]) : sorted[lo]; };

/**
 * Simulate `sims` samples of size n (default: the sample's own size, divided by designEffect) from
 * each null and test the sample's statistics against them.
 */
export function sampleTest(sample: number[], population: number[], spec: NullSpec, opts: { sims?: number; n?: number; designEffect?: number; seed?: number } = {}): NullResult | null {
  const nObs = sample.reduce((s, c) => s + c, 0), pt = population.reduce((s, c) => s + c, 0);
  if (!nObs || !pt) return null;
  const pop = population.map(x => x / pt);
  const obs = statsOf(sample);
  let center: number | null = null, spread: number | null = null, shares = pop;
  const fitted = new Set<Stat>();
  if (spec.kind === 'matched') {
    const sp = spec.spread === 'fit' || spec.spread == null ? undefined : spec.spread;
    const fitMedian = spec.center === 'fit' || spec.center == null;
    center = fitMedian ? obs.median : spec.center as number;
    const k = fitKernel(pop, center, obs.iqr, sp);
    spread = k.spread;
    if (fitMedian) fitted.add('median');
    if (sp == null) fitted.add('iqr');
    shares = kernelShares(pop, k.center, k.spread);
  }
  const sims = Math.max(50, Math.min(5000, opts.sims ?? 1000));
  const n = Math.max(1, Math.round(opts.n ?? nObs / Math.max(1, opts.designEffect ?? 1)));
  const cum: number[] = []; let acc = 0; for (const s of shares) cum.push(acc += s); cum[cum.length - 1] = 1;
  const r = rng(opts.seed ?? 20261022);
  const counts = new Array(shares.length).fill(0);
  const draws: Record<Stat, number[]> = Object.fromEntries(STATS.map(s => [s, [] as number[]])) as never;
  const binShares: number[][] = shares.map(() => []);
  for (let k = 0; k < sims; k++) {
    sampleCounts(cum, n, r, counts);
    const st = statsOf(counts, shares);
    for (const s of STATS) draws[s].push(st[s]);
    counts.forEach((c, i) => binShares[i].push(c / n));
  }
  const exact = statsOf(shares, shares);
  const obsShape = statsOf(sample, shares).shape;
  const tests = {} as Record<Stat, StatTest>;
  for (const s of STATS) {
    const d = [...draws[s]].sort((a, b) => a - b);
    const x = s === 'shape' ? obsShape : obs[s];
    const below = d.filter(v => v <= x + 1e-12).length, above = d.filter(v => v >= x - 1e-12).length;
    const p = s === 'shape' ? (above + 1) / (sims + 1) : Math.min(1, 2 * (Math.min(below, above) + 1) / (sims + 1));
    const mu = d.reduce((a, b) => a + b, 0) / d.length, sd = Math.sqrt(d.reduce((a, b) => a + (b - mu) ** 2, 0) / Math.max(1, d.length - 1));
    tests[s] = { lo: pctl(d, 0.025), mid: pctl(d, 0.5), hi: pctl(d, 0.975), sd, p, z: sd > 0 ? (x - mu) / sd : null, ...(fitted.has(s) ? { fitted: true } : {}) };
  }
  const band = binShares.map(b => b.sort((x, y) => x - y));
  return { spec, center, spread, shares, bandLo: band.map(b => pctl(b, 0.025)), bandHi: band.map(b => pctl(b, 0.975)), exact, n, sims, tests };
}

/** The 95% range of the median of a sample of size n from the null: how wide "a realistic sample" is at that size. */
export function medianRange(shares: number[], n: number, sims = 1000, seed = 7): { lo: number; mid: number; hi: number } {
  const cum: number[] = []; let acc = 0; for (const s of shares) cum.push(acc += s); cum[cum.length - 1] = 1;
  const r = rng(seed + n), counts = new Array(shares.length).fill(0), med: number[] = [];
  for (let k = 0; k < sims; k++) med.push(statsOf(sampleCounts(cum, n, r, counts)).median);
  med.sort((a, b) => a - b);
  return { lo: pctl(med, 0.025), mid: pctl(med, 0.5), hi: pctl(med, 0.975) };
}
