// Baseline, Consistency, Peak, Trend: four numbers that describe anything measured over a run of
// rows in sequence (a player over their games, a plot over its seasons, a store over its weeks).
//
//   Baseline     the measure over every row, with the query's own aggregation and weights
//   Consistency  the middle half (p25 to p75): of single rows when the measure is a median or
//                percentile, of rolling windows when it is an average, rate, sum or ratio
//                (a single game's win is 0 or 1, so its spread says nothing)
//   Peak         the best rolling window, better meaning higher or lower by the measure's polarity
//   Trend        the least-squares slope through the single rows, per 100 rows, with a 95% range;
//                called a trend only when that range excludes zero
//
// A peak always sits at or above the baseline by construction: the more rows and the noisier the
// measure, the further. That is why the card shows it next to the baseline, never alone.
import type { Row } from './types';
import { pointsOf, seriesOf, type MeasureFn, type SeriesPoint } from './engine';
import { ols, quantile, slopeSE, t95 } from './stats';

export type Verdict = 'improving' | 'declining' | 'rising' | 'falling' | 'no clear trend';

export interface Band { i: number; v: number; lo: number; hi: number; row: Row }

export interface Profile {
  /** Rows with a value for this measure. */
  n: number;
  window: number;
  baseline: number | null;
  p25: number | null;
  p75: number | null;
  /** What the consistency range is taken over. */
  spreadOf: 'rows' | 'windows';
  peak: number | null;
  peakRow?: Row;
  /** Change per `per` rows, and its 95% range. */
  trend: number;
  trendLow: number | null;
  trendHigh: number | null;
  per: number;
  verdict: Verdict;
  /** True when the trend is good news, false when bad, null when flat or the measure has no direction. */
  good: boolean | null;
  /** Rolling baseline with the middle half of each window, for the ribbon. */
  bands: Band[];
}

const PER_ROW_SPREAD = new Set(['median', 'p25', 'p75', 'iqr', 'min', 'max']);

export function profileOf(f: MeasureFn, rows: Row[], window = 20, per = 100): Profile | null {
  const pts = pointsOf(f, rows);
  const n = pts.length;
  if (n < 3) return null;
  const w = Math.max(2, Math.min(window, n));
  const agg = f.m.agg, weighted = !!f.w;
  const roll: SeriesPoint[] = seriesOf(pts, agg, weighted, 'rolling', w);
  const vals = pts.map(p => p.v);

  const spreadOf = PER_ROW_SPREAD.has(agg) ? 'rows' as const : 'windows' as const;
  const spread = spreadOf === 'rows' ? vals : roll.map(p => p.v);
  const p25 = quantile(spread, 0.25), p75 = quantile(spread, 0.75);

  const lower = f.m.polarity === 'lower';
  let peakP: SeriesPoint | undefined;
  for (const p of roll) if (!peakP || (lower ? p.v < peakP.v : p.v > peakP.v)) peakP = p;

  const fit = ols(vals), se = slopeSE(vals);
  const half = se != null ? t95(n - 2) * se * per : null;
  const trend = fit.slope * per;
  const trendLow = half != null ? trend - half : null, trendHigh = half != null ? trend + half : null;
  const up = trendLow != null && trendLow > 0, down = trendHigh != null && trendHigh < 0;
  let verdict: Verdict = 'no clear trend', good: boolean | null = null;
  if (up || down) {
    if (f.m.polarity === 'neutral') verdict = up ? 'rising' : 'falling';
    else { good = lower ? down : up; verdict = good ? 'improving' : 'declining'; }
  }

  const bands: Band[] = roll.map(p => {
    const slice = vals.slice(p.i - w + 1, p.i + 1);
    return { i: p.i, v: p.v, lo: quantile(slice, 0.25)!, hi: quantile(slice, 0.75)!, row: p.row };
  });

  return {
    n, window: w, baseline: f.value(pts.map(p => p.row)), p25, p75, spreadOf,
    peak: peakP?.v ?? null, peakRow: peakP?.row, trend, trendLow, trendHigh, per, verdict, good, bands,
  };
}
