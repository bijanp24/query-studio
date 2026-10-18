// A distribution against a reference population: how a group of rows spreads over ordered bins
// (players over ranks, plots over yield classes) next to how a larger population spreads over the
// same bins, and where the group sits inside that population.
//
//   Baseline     the bin holding the group's median, and the reference percentile it falls at
//   Consistency  the bins holding the group's 25th and 75th percentiles (the middle half)
//   Peak         the most common bin
//   Shift        the median's reference percentile minus 50: how far the group sits from the
//                middle of the population, in percentile points
//   Superiority  the chance that a random member of the group sits in a higher bin than a random
//                member of the population, ties counted half (0.5 = no difference)
//
// Everything is computed from binned counts, so it works for any ordered dimension and any
// reference that can be counted into the same bins. Percentiles inside a bin are interpolated
// linearly, which assumes members spread evenly across the bin.

export interface BinCount { key: string; order: number; n: number }

export interface Bin {
  key: string;
  order: number;
  n: number;
  share: number;
  ref: number;
  refShare: number;
  /** Reference percentiles (0 to 100) at the bottom and the top of this bin. */
  refLo: number;
  refHi: number;
}

export interface Located { bin: Bin; refPct: number | null }

export interface DistSummary {
  bins: Bin[];
  total: number;
  refTotal: number;
  median: Located;
  p25: Located;
  p75: Located;
  mode: Bin;
  shift: number | null;
  superiority: number | null;
}

export function distribution(sample: BinCount[], reference: BinCount[]): DistSummary | null {
  const by = new Map<string, Bin>();
  const get = (k: string, order: number) => {
    let b = by.get(k);
    if (!b) by.set(k, b = { key: k, order, n: 0, share: 0, ref: 0, refShare: 0, refLo: 0, refHi: 0 });
    else if (Number.isFinite(order) && !(b.order <= order)) b.order = order;
    return b;
  };
  for (const s of sample) if (s.n > 0) get(s.key, s.order).n += s.n;
  for (const r of reference) if (r.n > 0) get(r.key, r.order).ref += r.n;
  const bins = [...by.values()].sort((a, b) => (Number.isFinite(a.order) ? a.order : Infinity) - (Number.isFinite(b.order) ? b.order : Infinity) || a.key.localeCompare(b.key, undefined, { numeric: true }));
  const total = bins.reduce((s, b) => s + b.n, 0), refTotal = bins.reduce((s, b) => s + b.ref, 0);
  if (!total) return null;
  let cum = 0;
  for (const b of bins) {
    b.share = b.n / total;
    b.refShare = refTotal ? b.ref / refTotal : 0;
    b.refLo = cum * 100; cum += b.refShare; b.refHi = cum * 100;
  }
  const locate = (p: number): Located => {
    let before = 0;
    for (const b of bins) {
      if (b.share > 0 && before + b.share >= p - 1e-12) {
        const t = Math.min(1, Math.max(0, (p - before) / b.share));
        return { bin: b, refPct: refTotal ? b.refLo + t * (b.refHi - b.refLo) : null };
      }
      before += b.share;
    }
    const last = [...bins].reverse().find(b => b.share > 0)!;
    return { bin: last, refPct: refTotal ? last.refHi : null };
  };
  const median = locate(0.5);
  const mode = bins.reduce((a, b) => b.n > a.n ? b : a);
  const superiority = refTotal ? bins.reduce((s, b) => s + b.share * (b.refLo / 100 + b.refShare / 2), 0) : null;
  return { bins, total, refTotal, median, p25: locate(0.25), p75: locate(0.75), mode, shift: median.refPct == null ? null : median.refPct - 50, superiority };
}

/** "69th" for 69, "1st", "22nd", "3rd". */
export function ordinal(x: number): string {
  const n = Math.round(x), r100 = n % 100, r10 = n % 10;
  return n + (r100 >= 11 && r100 <= 13 ? 'th' : r10 === 1 ? 'st' : r10 === 2 ? 'nd' : r10 === 3 ? 'rd' : 'th');
}
