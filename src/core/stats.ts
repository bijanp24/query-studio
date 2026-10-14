// Statistics used by aggregations, series operators and the trend verdict.
export const mean = (a: number[]) => a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
export function median(a: number[]) {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
export function variance(a: number[]) {
  const m = mean(a); if (m == null || a.length < 2) return 0;
  return a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1);
}
/** Least-squares line through (0..n-1, y). Matches SQL REGR_SLOPE(y, row_index). */
export function ols(y: number[]) {
  const n = y.length;
  if (n < 2) return { slope: 0, intercept: y[0] ?? 0, r2: 0, n };
  const xm = (n - 1) / 2, ym = y.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  y.forEach((v, i) => { sxy += (i - xm) * (v - ym); sxx += (i - xm) ** 2; syy += (v - ym) ** 2; });
  const slope = sxx ? sxy / sxx : 0;
  return { slope, intercept: ym - slope * xm, r2: syy && sxx ? (sxy * sxy) / (sxx * syy) : 0, n };
}
export function pearson(x: number[], y: number[]) {
  const n = Math.min(x.length, y.length); if (n < 3) return null;
  const mx = mean(x.slice(0, n))!, my = mean(y.slice(0, n))!;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2; }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : null;
}

// Student t two-sided p-value through the regularized incomplete beta function.
function lgamma(x: number) {
  const c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let y = x, t = x + 5.5; t -= (x + 0.5) * Math.log(t);
  let ser = 1.000000000190015; for (let j = 0; j < 6; j++) ser += c[j] / ++y;
  return -t + Math.log(2.5066282746310005 * ser / x);
}
function betacf(a: number, b: number, x: number) {
  const MAXIT = 200, EPS = 3e-14, FPMIN = 1e-300;
  const qab = a + b, qap = a + 1, qam = a - 1;
  let c = 1, d = 1 - qab * x / qap; if (Math.abs(d) < FPMIN) d = FPMIN; d = 1 / d; let h = d;
  for (let m = 1; m <= MAXIT; m++) {
    const m2 = 2 * m;
    let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN; c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN; d = 1 / d; h *= d * c;
    aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN; c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN; d = 1 / d;
    const del = d * c; h *= del; if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}
function ibeta(a: number, b: number, x: number) {
  if (x <= 0) return 0; if (x >= 1) return 1;
  const bt = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? bt * betacf(a, b, x) / a : 1 - bt * betacf(b, a, 1 - x) / b;
}
export function tPvalue(t: number, df: number) { if (!isFinite(t) || !(df > 0)) return 1; return ibeta(df / 2, 0.5, df / (df + t * t)); }
/** Welch two-sample t-test of b against a. */
export function welch(a: number[], b: number[]) {
  const ma = mean(a) ?? 0, mb = mean(b) ?? 0;
  const sa = variance(a) / Math.max(1, a.length), sb = variance(b) / Math.max(1, b.length);
  const se = Math.sqrt(sa + sb);
  if (!se) return { diff: mb - ma, t: 0, p: 1, df: 0 };
  const t = (mb - ma) / se;
  const df = (sa + sb) ** 2 / ((sa * sa) / Math.max(1, a.length - 1) + (sb * sb) / Math.max(1, b.length - 1));
  return { diff: mb - ma, t, p: tPvalue(t, df), df };
}
