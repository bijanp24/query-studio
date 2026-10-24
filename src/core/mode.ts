// The mode of a distribution and everything ranked after it: which bin is most common, then the next,
// and so on, read against a reference population and against random samples drawn from it.
//
//   Ranking      every bin by how often it occurs (1st = the mode), with its share, the running total,
//                its place in the reference and the lift (share here ÷ share in the reference)
//   Chance band  the range each bin's share takes in random samples of the same size drawn from the
//                reference (multinomial, seeded); a bin outside it is more or less common than chance
//   Excess       how many rows a bin holds beyond the top of its band: the rows a cleaning step would
//                have to explain (a burst of 1-star reviews, say)
//   Peaks        local maxima of the ordered bins that stand clear of the dip beside them; two peaks
//                where the reference has one is the signature of a second population mixed in
//   Bimodality   Sarle's coefficient over the bin positions, (skew² + 1) / kurtosis; above 5/9 (a
//                uniform spread) leans bimodal. Compared with the reference's, because some shapes are
//                naturally U- or J-shaped (star ratings pile up at 1 and 5)
//
// Rows that come in clusters (players met ten at a time in one game) are less independent than their
// count suggests; effN sets the sample size the chance band is drawn at.
import type { Bin, DistSummary } from './distribution';

export interface RankedBin extends Bin {
  rank: number;
  cumShare: number;
  refRank: number | null;
  lift: number | null;
  /** Chance band: the share this bin takes in random samples of the reference (null without one). */
  lo: number | null;
  hi: number | null;
  /** Share of random samples in which this bin is the mode. */
  pMode: number | null;
  flag: 'above' | 'below' | null;
  /** Rows beyond the top of the band (above) or short of its bottom (below), scaled to the group's size. */
  excess: number;
  peak: boolean;
}

export interface ModeSummary {
  ranked: RankedBin[];
  ordered: RankedBin[];
  total: number;
  hasRef: boolean;
  effN: number;
  sims: number;
  level: number;
  peaks: RankedBin[];
  refPeaks: string[];
  /** The lowest bin between the two highest peaks. */
  valley: RankedBin | null;
  bimodality: number | null;
  refBimodality: number | null;
  refMode: string | null;
  /** Share of random samples whose mode is the reference's mode. */
  refModeHolds: number | null;
  meanPos: number;
  medianKey: string;
  flags: RankedBin[];
}

/** Seeded generator (mulberry32), so a tile draws the same band every time. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32; };
}
function normal(r: () => number) { let u = 0; while (!u) u = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r()); }
/** Binomial draw: inversion for small means, a rounded normal for large ones (bands, not exact tails). */
function binomial(n: number, p: number, r: () => number): number {
  if (n <= 0 || p <= 0) return 0;
  if (p >= 1) return n;
  if (p > 0.5) return n - binomial(n, 1 - p, r);
  const mu = n * p;
  if (mu < 30) {
    let k = 0, q = Math.pow(1 - p, n), c = q, u = r();
    while (u > c && k < n) { q *= (n - k) / (k + 1) * p / (1 - p); c += q; k++; }
    return k;
  }
  return Math.max(0, Math.min(n, Math.round(mu + Math.sqrt(mu * (1 - p)) * normal(r))));
}
/** One multinomial sample of n over the shares p, drawn as a chain of binomials. */
export function multinomial(n: number, p: number[], r: () => number): number[] {
  const out = new Array(p.length).fill(0);
  let left = n, rest = 1;
  for (let i = 0; i < p.length && left > 0; i++) {
    const k = i === p.length - 1 ? left : binomial(left, rest > 0 ? Math.min(1, p[i] / rest) : 0, r);
    out[i] = k; left -= k; rest -= p[i];
  }
  return out;
}

/** Positions of local maxima that rise at least prominence × the top share above the deeper of the dips on each side. */
export function peaksOf(shares: number[], prominence = 0.1): number[] {
  const top = Math.max(...shares), out: number[] = [];
  shares.forEach((s, i) => {
    if (s <= 0 || (i > 0 && shares[i - 1] >= s) || (i < shares.length - 1 && shares[i + 1] > s)) return;
    const dip = (step: number) => { let m = s; for (let j = i + step; j >= 0 && j < shares.length; j += step) { if (shares[j] > s) return m; m = Math.min(m, shares[j]); } return m; };
    // The edge of the scale counts as a floor of zero only when there is nothing beyond it, so a bin at the end can be a peak.
    const left = i === 0 ? 0 : dip(-1), right = i === shares.length - 1 ? 0 : dip(1);
    if (s - Math.max(left, right) >= prominence * top) out.push(i);
  });
  return out;
}

/** Sarle's bimodality coefficient over bin positions 0..k-1 weighted by share; null when it cannot be computed. */
export function bimodality(shares: number[], n: number): number | null {
  const t = shares.reduce((a, b) => a + b, 0); if (!t || n < 4) return null;
  const mu = shares.reduce((s, w, i) => s + w * i, 0) / t;
  let m2 = 0, m3 = 0, m4 = 0;
  shares.forEach((w, i) => { const d = i - mu; m2 += w * d * d; m3 += w * d ** 3; m4 += w * d ** 4; });
  m2 /= t; m3 /= t; m4 /= t;
  if (!(m2 > 0)) return null;
  const g = m3 / m2 ** 1.5, k = m4 / m2 ** 2 - 3;
  return (g * g + 1) / (k + 3 * (n - 1) ** 2 / ((n - 2) * (n - 3)));
}

export function modeOf(d: DistSummary, o: { effN?: number; deff?: number; sims?: number; level?: number; prominence?: number; seed?: number } = {}): ModeSummary {
  const bins = d.bins, k = bins.length, hasRef = d.refTotal > 0;
  const effN = Math.max(1, Math.round(o.effN && o.effN > 0 ? Math.min(o.effN, d.total) : o.deff && o.deff > 1 ? d.total / o.deff : d.total));
  const sims = hasRef ? Math.max(100, Math.min(5000, o.sims ?? 1000)) : 0;
  const level = o.level ?? 99;
  const lo = new Array(k).fill(null), hi = new Array(k).fill(null), wins = new Array(k).fill(0);
  if (hasRef) {
    const r = rng(o.seed ?? 20261024), p = bins.map(b => b.refShare), draws: number[][] = bins.map(() => []);
    for (let s = 0; s < sims; s++) {
      const x = multinomial(effN, p, r);
      let best = 0; for (let i = 1; i < k; i++) if (x[i] > x[best]) best = i;
      wins[best]++;
      x.forEach((c, i) => draws[i].push(c / effN));
    }
    const tail = (100 - level) / 200;
    draws.forEach((a, i) => { a.sort((x, y) => x - y); lo[i] = a[Math.floor(tail * (a.length - 1))]; hi[i] = a[Math.ceil((1 - tail) * (a.length - 1))]; });
  }
  const refOrder = hasRef ? [...bins].sort((a, b) => b.ref - a.ref) : [];
  const shares = bins.map(b => b.share), pk = new Set(peaksOf(shares, o.prominence));
  const ordered: RankedBin[] = bins.map((b, i) => {
    const flag = lo[i] == null ? null : b.share > hi[i] ? 'above' : b.share < lo[i] ? 'below' : null;
    return {
      ...b, rank: 0, cumShare: 0, refRank: hasRef ? refOrder.indexOf(b) + 1 : null, lift: hasRef && b.refShare > 0 ? b.share / b.refShare : null,
      lo: lo[i], hi: hi[i], pMode: hasRef ? wins[i] / sims : null, flag,
      excess: flag === 'above' ? (b.share - hi[i]) * d.total : flag === 'below' ? (b.share - lo[i]) * d.total : 0, peak: pk.has(i),
    };
  });
  // Ties keep the higher bin first, so the ranking is stable.
  const ranked = [...ordered].sort((a, b) => b.n - a.n || bins.indexOf(b) - bins.indexOf(a));
  let cum = 0; ranked.forEach((b, i) => { b.rank = i + 1; cum += b.share; b.cumShare = cum; });
  const peaks = ordered.filter(b => b.peak);
  const top2 = [...peaks].sort((a, b) => b.share - a.share).slice(0, 2).map(b => ordered.indexOf(b)).sort((a, b) => a - b);
  const valley = top2.length === 2 && top2[1] - top2[0] > 1 ? ordered.slice(top2[0] + 1, top2[1]).reduce((a, b) => b.share < a.share ? b : a) : null;
  const refShares = bins.map(b => b.refShare);
  const refMode = hasRef ? refOrder[0].key : null;
  return {
    ranked, ordered, total: d.total, hasRef, effN, sims, level, peaks,
    refPeaks: hasRef ? peaksOf(refShares, o.prominence).map(i => bins[i].key) : [],
    valley, bimodality: bimodality(shares, d.total), refBimodality: hasRef ? bimodality(refShares, d.refTotal) : null,
    refMode, refModeHolds: hasRef ? wins[bins.findIndex(b => b.key === refMode)] / sims : null,
    meanPos: shares.reduce((s, w, i) => s + w * i, 0), medianKey: d.median.bin.key,
    flags: ordered.filter(b => b.flag),
  };
}

const P = (x: number) => (x * 100).toFixed(x < 0.1 ? 1 : 0) + '%';

/** Plain sentences a tile prints under the chart: the ranking, the peaks, what chance allows, where the mode sits. */
export function modeFindings(s: ModeSummary, label: string, grain: string): string[] {
  const out: string[] = [];
  const [a, b, c] = s.ranked.filter(x => x.n > 0);
  const rows = (n: number) => `${Math.round(n).toLocaleString()} ${grain}${Math.round(n) === 1 ? '' : 's'}`;
  out.push(`Most common: ${a.key} (${P(a.share)})${b ? `, then ${b.key} (${P(b.share)})` : ''}${c ? `, then ${c.key} (${P(c.share)})` : ''}.` + (s.ranked.length > 3 ? ` The top three hold ${P(s.ranked[Math.min(2, s.ranked.length - 1)].cumShare)}.` : ''));
  if (s.hasRef) {
    out.push(a.key === s.refMode
      ? `${label} peaks at the same place.`
      : `${label} peaks at ${s.refMode}; ${a.key} is the mode of only ${P(a.pMode || 0)} of random samples of ${s.effN.toLocaleString()} drawn from it, and ${s.refMode} of ${P(s.refModeHolds || 0)}.`);
  }
  const pk = s.peaks.map(x => x.key);
  if (pk.length >= 2) {
    out.push(`${pk.length} peaks: ${pk.join(' and ')}${s.valley ? `, with a dip at ${s.valley.key} (${P(s.valley.share)})` : ''}.` + (s.hasRef ? ` ${label} has ${s.refPeaks.length === 1 ? 'one' : s.refPeaks.length} (${s.refPeaks.join(', ')}).` : ''));
  } else if (s.hasRef && s.refPeaks.length >= 2) out.push(`One peak, where ${label} has ${s.refPeaks.length} (${s.refPeaks.join(', ')}).`);
  if (s.bimodality != null && s.hasRef && s.refBimodality != null && s.bimodality > 5 / 9 && s.bimodality - s.refBimodality > 0.05)
    out.push(`Bimodality coefficient ${s.bimodality.toFixed(2)} against ${s.refBimodality.toFixed(2)} for ${label} (above 0.56 leans bimodal).`);
  const up = s.flags.filter(f => f.flag === 'above').sort((x, y) => y.excess - x.excess);
  if (s.hasRef && up.length) {
    const t = up.slice(0, 3).map(f => `${f.key} ${P(f.share)} where chance allows up to ${P(f.hi!)} (about ${rows(f.excess)} over)`);
    out.push(`More common than ${label} explains at ${s.level}%: ${t.join('; ')}${up.length > 3 ? `; and ${up.length - 3} more` : ''}.`);
  } else if (s.hasRef) out.push(`Every bin sits inside what random samples of ${label} produce at ${s.level}%.`);
  const mi = s.ordered.findIndex(x => x.key === a.key), md = s.ordered.findIndex(x => x.key === s.medianKey);
  if (mi !== md) out.push(`The mode sits ${mi > md ? 'above' : 'below'} the median (${s.medianKey}), so the bulk is ${mi > md ? 'higher' : 'lower'} than the middle and the longer tail runs ${mi > md ? 'down' : 'up'}.`);
  return out;
}
