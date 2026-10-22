// Visualizations: each takes a query Result and draws it. They read only the Result, the
// visualization's settings and (for the comparison card) the catalog, so any query can feed any
// visualization; a shape that does not fit says so instead of guessing.
import React from 'react';
import type { Row, Value, Visualization } from '../../core/types';
import { fmt, matchFilters, measureFn, pointsOf, reference, seriesOf, WEEKDAY_ORDER, type Catalog, type Group, type Result } from '../../core/engine';
import { fieldExpr, fieldsFor, missingColumns, resolveMeasure, type ResolvedMeasure } from '../../core/semantic';
import { ols, welch, mean, quantile } from '../../core/stats';
import { compile, evaluate, toNum } from '../../core/expr';
import { distribution, hiddenRange, ordinal, type BinCount, type DistSummary } from '../../core/distribution';
import { flowOf, type FlowSummary } from '../../core/flow';
import { profileOf, type Profile } from '../../core/profile';

export const PALETTE = 8;
// Charts draw at the width they get, so text stays the same size on a phone and a full-width tile.
const WidthCtx = React.createContext(460);
const useW = () => React.useContext(WidthCtx);
export const color = (slot: number, i = 0) => `var(--s${((slot - 1 + i) % PALETTE + PALETTE) % PALETTE + 1})`;
const F = (v: number | null | undefined, m?: ResolvedMeasure, signed = false) => fmt(v, m?.format, signed);
const keyText = (k: Value) => k == null ? '(none)' : String(k);

function niceTicks(lo: number, hi: number, n: number) {
  if (hi === lo) hi = lo + 1;
  const step0 = (hi - lo) / n, mag = Math.pow(10, Math.floor(Math.log10(step0))), r = step0 / mag;
  const step = (r < 1.5 ? 1 : r < 3 ? 2 : r < 7 ? 5 : 10) * mag;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(10));
  return out;
}

export function Empty({ msg }: { msg?: string }) { return <div className="empty">{msg || 'No rows match this query.'}</div>; }

function Legend({ items }: { items: [string, string][] }) {
  return <div className="legend">{items.map(([c, t], i) => <span key={i}><i className={c === 'dash' ? 'dash' : ''} style={c === 'dash' ? undefined : { background: c }} />{t}</span>)}</div>;
}

const isPct = (m?: ResolvedMeasure) => m?.format === 'percent';
const better = (diff: number, m?: ResolvedMeasure) => m?.polarity === 'lower' ? diff < 0 : m?.polarity === 'neutral' ? null : diff > 0;
const signedOp = (res: Result) => { const op = res.query.series?.op; return op === 'delta' || op === 'slope'; };

export function CompareLine({ res }: { res: Result }) {
  const c = res.compare, m = res.measures[0];
  if (!c || res.value == null) return null;
  const diff = res.value - c.value;
  const b = better(diff, m);
  return <div className="cmp"><span className={b == null ? 'delta' : b ? 'delta up' : 'delta down'}>{diff >= 0 ? '▲ ' : '▼ '}{F(diff, m, true)}</span> vs {c.label} ({F(c.value, m)}){c.detail ? <span className="muted"> · {c.detail}</span> : null}</div>;
}

// ---------- KPI and gauge ----------
function KPI({ res }: { res: Result }) {
  const ms = res.measures;
  return <div className="kpi">
    <div className="kv">{F(res.value, ms[0], signedOp(res))}</div>
    <div className="kl">{ms[0]?.label}{res.query.series && res.query.series.op !== 'none' ? ` · ${seriesLabel(res)}, latest` : ''} · {res.n.toLocaleString()} {res.grain}{res.n === 1 ? '' : 's'}</div>
    <CompareLine res={res} />
    {ms.length > 1 && <table className="mini"><tbody>{ms.slice(1).map((m, i) => <tr key={i}><td>{m.label}</td><td className="num">{F(res.values[i + 1], m)}</td>{res.unweighted && m.weight ? <td className="num muted">unweighted {F(res.unweighted[i + 1], m)}</td> : null}</tr>)}</tbody></table>}
  </div>;
}

export function seriesLabel(res: Result) {
  const s = res.query.series; if (!s || s.op === 'none') return '';
  const w = s.window, g = res.grain;
  return s.op === 'rolling' ? `rolling ${w}-${g}` : s.op === 'delta' ? `change vs the previous ${w} ${g}s` : s.op === 'slope' ? `rate of change per 10 ${g}s (slope over ${w})` : `running total`;
}

function rowValues(res: Result): number[] {
  const m = res.measures[0]; if (!m) return [];
  const f = measureFn(m);
  return pointsOf(f, res.rows).map(p => p.v).filter(Number.isFinite);
}

function Gauge({ v, res }: { v: Visualization; res: Result }) {
  const val = res.value, m = res.measures[0];
  if (val == null) return <Empty />;
  const vals = rowValues(res);
  const cmp = res.compare?.value;
  let lo = isPct(m) ? 0 : Math.min(...vals, cmp ?? val, val), hi = isPct(m) ? 1 : Math.max(...vals, cmp ?? val, val);
  if (m?.agg === 'count' || m?.agg === 'sum') { lo = 0; hi = Math.max(val, cmp ?? val) * 1.2; }
  if (hi === lo) hi = lo + 1;
  const W = 320, H = 190, cx = 160, cy = 160, R = 120, r = 92;
  const ang = (t: number) => Math.PI * (1 - t), pt = (rad: number, t: number) => [cx + rad * Math.cos(ang(t)), cy - rad * Math.sin(ang(t))];
  const arc = (t0: number, t1: number) => { const [x0, y0] = pt(R, t0), [x1, y1] = pt(R, t1), [x2, y2] = pt(r, t1), [x3, y3] = pt(r, t0); return `M${x0},${y0}A${R},${R},0,0,1,${x1},${y1}L${x2},${y2}A${r},${r},0,0,0,${x3},${y3}Z`; };
  const t = Math.max(0.002, Math.min(1, (val - lo) / (hi - lo)));
  const tb = cmp != null ? Math.max(0, Math.min(1, (cmp - lo) / (hi - lo))) : null;
  return <>
    <svg viewBox={`0 0 ${W} ${H}`} className="gauge" role="img" aria-label={`${m?.label}: ${F(val, m)}`}>
      <path d={arc(0, 1)} fill="var(--surface-2)" />
      <path d={arc(0, t)} fill={color(v.color)}><title>{`${F(val, m)} over ${res.n} ${res.grain}s`}</title></path>
      {tb != null && (() => { const [x0, y0] = pt(r - 6, tb), [x1, y1] = pt(R + 6, tb); return <line x1={x0} y1={y0} x2={x1} y2={y1} className="ref" />; })()}
      <text x={cx} y={cy - 10} textAnchor="middle" className="big">{F(val, m)}</text>
      <text x={cx} y={cy + 10} textAnchor="middle" className="ax">{res.n} {res.grain}s</text>
      <text x={cx - R} y={cy + 16} textAnchor="middle" className="ax">{F(lo, m)}</text>
      <text x={cx + R} y={cy + 16} textAnchor="middle" className="ax">{F(hi, m)}</text>
    </svg>
    <CompareLine res={res} />
  </>;
}

// ---------- grouped charts ----------
function groupsOf(res: Result): Group[] | null { return res.groups && res.groups.length ? res.groups : null; }

/** Without a group-by, bars show the query's measures side by side. */
function measureBars(res: Result): Group[] { return res.measures.map((m, i) => ({ keys: [m.label], n: res.n, values: [res.values[i]], rows: [] })); }

function Bars({ v, res }: { v: Visualization; res: Result }) {
  const two = (res.query.groupBy.length > 1);
  let g = groupsOf(res) || measureBars(res);
  g = g.filter(x => x.values[0] != null);
  if (!g.length) return <Empty />;
  const m = res.measures[0];
  if (two) return <GroupedBars v={v} res={res} g={g} />;
  g = g.slice(0, 30);
  const rowH = 22, padL = 120, W = useW(), H = g.length * rowH + 30;
  const vals = g.map(x => x.values[0] as number);
  const cmps = g.map(x => x.compare).filter((x): x is number => x != null);
  const ref = res.compare?.value;
  const hi = isPct(m) ? Math.max(1, ...vals) : Math.max(...vals, ...cmps, ref ?? 0, 0), lo = Math.min(0, ...vals, ...cmps);
  const x = (val: number) => padL + (val - lo) / (hi - lo || 1) * (W - padL - 70);
  return <>
    <svg viewBox={`0 0 ${W} ${H}`} role="img">
      {niceTicks(lo, hi, 4).map(tv => <g key={tv}><line x1={x(tv)} x2={x(tv)} y1={0} y2={H - 24} className="grid" /><text x={x(tv)} y={H - 10} textAnchor="middle" className="ax">{F(tv, m)}</text></g>)}
      {g.map((d, i) => {
        const y = i * rowH + 2, val = d.values[0] as number;
        return <g key={i}>
          <rect x={x(Math.min(0, val))} y={y} width={Math.max(1, Math.abs(x(val) - x(0)))} height={rowH - 6} rx={3} fill={color(v.color)}><title>{`${d.keys.map(keyText).join(' · ')}: ${F(val, m)} (n=${d.n})${d.compare != null ? `, reference ${F(d.compare, m)}` : ''}`}</title></rect>
          {d.compare != null && <line x1={x(d.compare)} x2={x(d.compare)} y1={y - 1} y2={y + rowH - 5} className="tick" />}
          <text x={padL - 6} y={y + 12} textAnchor="end" className="lab">{keyText(d.keys[0]).slice(0, 18)}</text>
          {v.labels !== false && <text x={x(Math.max(0, val)) + 4} y={y + 12} className="ax">{F(val, m)}{res.groups ? ` · ${d.n}` : ''}</text>}
        </g>;
      })}
      {ref != null && <line x1={x(ref)} x2={x(ref)} y1={0} y2={H - 24} className="ref" />}
    </svg>
    <Legend items={[...(cmps.length ? [['var(--text)', `tick: ${res.compare?.label || 'reference'} for that group`] as [string, string]] : []), ...(ref != null ? [['dash', `${res.compare!.label}: ${F(ref, m)}`] as [string, string]] : [])]} />
  </>;
}

function GroupedBars({ v, res, g }: { v: Visualization; res: Result; g: Group[] }) {
  const m = res.measures[0];
  const ks = [...new Set(g.map(x => keyText(x.keys[0])))].slice(0, 14), k2s = [...new Set(g.map(x => keyText(x.keys[1])))].slice(0, 8);
  const rowH = 12 * k2s.length + 10, padL = 120, W = useW(), H = ks.length * rowH + 30;
  const hi = isPct(m) ? 1 : Math.max(...g.map(x => x.values[0] as number), 0), lo = Math.min(0, ...g.map(x => x.values[0] as number));
  const x = (val: number) => padL + (val - lo) / (hi - lo || 1) * (W - padL - 50);
  return <>
    <svg viewBox={`0 0 ${W} ${H}`} role="img">
      {niceTicks(lo, hi, 4).map(tv => <g key={tv}><line x1={x(tv)} x2={x(tv)} y1={0} y2={H - 24} className="grid" /><text x={x(tv)} y={H - 10} textAnchor="middle" className="ax">{F(tv, m)}</text></g>)}
      {ks.map((k, i) => <g key={k}>
        <text x={padL - 6} y={i * rowH + rowH / 2 + 4} textAnchor="end" className="lab">{k.slice(0, 18)}</text>
        {k2s.map((k2, j) => { const d = g.find(z => keyText(z.keys[0]) === k && keyText(z.keys[1]) === k2); if (!d) return null; const val = d.values[0] as number; return <rect key={k2} x={x(Math.min(0, val))} y={i * rowH + j * 12 + 3} width={Math.max(1, Math.abs(x(val) - x(0)))} height={10} rx={2} fill={color(v.color, j)}><title>{`${k} · ${k2}: ${F(val, m)} (n=${d.n})`}</title></rect>; })}
      </g>)}
    </svg>
    <Legend items={k2s.map((k, j) => [color(v.color, j), k])} />
  </>;
}

function Columns({ v, res }: { v: Visualization; res: Result }) {
  let g = (groupsOf(res) || measureBars(res)).filter(x => x.values[0] != null);
  if (!g.length) return <Empty />;
  const m = res.measures[0], two = res.query.groupBy.length > 1;
  const ks = [...new Set(g.map(x => keyText(x.keys[0])))].slice(0, 24);
  const k2s = two ? [...new Set(g.map(x => keyText(x.keys[1])))].slice(0, 8) : [null];
  g = g.filter(x => ks.includes(keyText(x.keys[0])));
  const stack = two && v.stack;
  const W = useW(), H = 220, pl = 44, pr = 8, pt = 12, pb = 44, bw = (W - pl - pr) / ks.length;
  const find = (k: string, k2: string | null) => g.find(x => keyText(x.keys[0]) === k && (k2 == null || keyText(x.keys[1]) === k2));
  let hi = 0, lo = 0;
  ks.forEach(k => { const vs = k2s.map(k2 => (find(k, k2)?.values[0] as number) ?? 0); hi = Math.max(hi, stack ? vs.reduce((a, b) => a + Math.max(0, b), 0) : Math.max(...vs)); lo = Math.min(lo, ...vs); });
  if (isPct(m) && !stack) hi = Math.max(hi, 1);
  const ref = res.compare?.value; if (ref != null) hi = Math.max(hi, ref);
  if (hi === lo) hi = lo + 1;
  const y = (val: number) => pt + (1 - (val - lo) / (hi - lo)) * (H - pt - pb);
  const rot = ks.length > 8;
  return <>
    <svg viewBox={`0 0 ${W} ${H}`} role="img">
      {niceTicks(lo, hi, 4).map(tv => <g key={tv}><line x1={pl} x2={W - pr} y1={y(tv)} y2={y(tv)} className="grid" /><text x={pl - 4} y={y(tv) + 4} textAnchor="end" className="ax">{F(tv, m)}</text></g>)}
      {ks.map((k, i) => {
        let acc = 0; const n = k2s.length;
        return <g key={k}>
          {k2s.map((k2, j) => {
            const d = find(k, k2); if (!d) return null; const val = d.values[0] as number;
            const w = stack ? bw - 6 : (bw - 6) / n, xx = pl + i * bw + 3 + (stack ? 0 : j * w);
            const y0 = stack ? y(acc + val) : y(Math.max(0, val)), y1 = stack ? y(acc) : y(Math.min(0, val));
            if (stack) acc += val;
            return <g key={String(k2)}>
              <rect x={xx} y={y0} width={Math.max(1, w - (stack ? 0 : 1))} height={Math.max(0, y1 - y0 - (stack ? 1 : 0))} rx={2} fill={color(v.color, j)}><title>{`${k}${k2 != null ? ' · ' + k2 : ''}: ${F(val, m)} (n=${d.n})`}</title></rect>
              {!stack && n === 1 && v.labels !== false && ks.length <= 14 && <text x={xx + w / 2} y={y0 - 3} textAnchor="middle" className="ax">{F(val, m)}</text>}
            </g>;
          })}
          <text x={pl + i * bw + bw / 2} y={H - pb + 14} textAnchor={rot ? 'end' : 'middle'} transform={rot ? `rotate(-35 ${pl + i * bw + bw / 2} ${H - pb + 14})` : undefined} className="lab">{k.slice(0, 12)}</text>
        </g>;
      })}
      {ref != null && <line x1={pl} x2={W - pr} y1={y(ref)} y2={y(ref)} className="ref" />}
    </svg>
    <Legend items={[...(two ? k2s.map((k, j) => [color(v.color, j), String(k)] as [string, string]) : []), ...(ref != null ? [['dash', `${res.compare!.label}: ${F(ref, m)}`] as [string, string]] : [])]} />
  </>;
}

// ---------- lines ----------
interface Line { name: string; pts: { v: number; row?: Row; label?: string }[] }
function linesOf(v: Visualization, res: Result): Line[] {
  const m = res.measures[0]; if (!m) return [];
  if (res.series && !res.groups) return [{ name: seriesLabel(res), pts: res.series.map(p => ({ v: p.v, row: p.row })) }];
  const q = res.query;
  const timeGroup = res.groups && q.groupBy.length === 1 && q.groupBy[0].grain && q.groupBy[0].grain !== 'none';
  if (timeGroup) {
    const g = [...res.groups!].sort((a, b) => q.groupBy[0].grain === 'weekday' ? WEEKDAY_ORDER.indexOf(String(a.keys[0])) - WEEKDAY_ORDER.indexOf(String(b.keys[0])) : String(a.keys[0]).localeCompare(String(b.keys[0]), undefined, { numeric: true }));
    return [{ name: m.label, pts: g.filter(x => x.values[0] != null).map(x => ({ v: x.values[0] as number, label: keyText(x.keys[0]) })) }];
  }
  const f = measureFn(m);
  const op = q.series && q.series.op !== 'none' ? q.series.op : 'rolling';
  const win = q.series && q.series.op !== 'none' ? q.series.window : v.window || 10;
  if (res.groups && q.groupBy.length === 1) {
    return res.groups.slice(0, 4).map(g => ({ name: keyText(g.keys[0]), pts: seriesOf(pointsOf(f, g.rows), m.agg, !!f.w, op, win).map(p => ({ v: p.v, row: p.row })) }));
  }
  return [{ name: `rolling ${win}-${res.grain} ${m.label}`, pts: seriesOf(pointsOf(f, res.rows), m.agg, !!f.w, op, win).map(p => ({ v: p.v, row: p.row })) }];
}

function seqText(res: Result, row?: Row, cat?: Catalog) {
  if (!row) return '';
  const ds = cat?.ws.datasets.find(d => d.id === res.datasetId);
  const s = ds?.sequence ? row[ds.sequence] : null;
  return s == null ? '' : String(s).slice(0, 10);
}

function Lines({ v, res, cat, area }: { v: Visualization; res: Result; cat: Catalog; area: boolean }) {
  const lines = linesOf(v, res).filter(l => l.pts.length > 1);
  const m = res.measures[0];
  if (!lines.length) return <Empty msg={`Needs more ${res.grain}s than the ${v.window || 10}-${res.grain} window to draw a line.`} />;
  const zeroLine = signedOp(res);
  const W = useW(), H = 200, pl = 46, pr = 12, pt = 10, pb = 26;
  const vals = lines.flatMap(l => l.pts.map(p => p.v)); const ref = res.compare?.value;
  if (ref != null) vals.push(ref);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (isPct(m)) { lo = Math.min(lo, 0.3); hi = Math.max(hi, 0.7); }
  if (area || zeroLine) lo = Math.min(lo, 0); if (zeroLine) hi = Math.max(hi, 0);
  if (hi === lo) hi = lo + 1;
  const x = (i: number, n: number) => pl + i / Math.max(1, n - 1) * (W - pl - pr), y = (val: number) => pt + (1 - (val - lo) / (hi - lo)) * (H - pt - pb);
  const main = lines[0].pts;
  const firstL = main[0].label ?? seqText(res, main[0].row, cat), lastL = main[main.length - 1].label ?? seqText(res, main[main.length - 1].row, cat);
  return <>
    <svg viewBox={`0 0 ${W} ${H}`} role="img">
      {niceTicks(lo, hi, 4).filter(tv => tv >= lo && tv <= hi).map(tv => <g key={tv}><line x1={pl} x2={W - pr} y1={y(tv)} y2={y(tv)} className="grid" /><text x={pl - 6} y={y(tv) + 4} textAnchor="end" className="ax">{F(tv, m, zeroLine)}</text></g>)}
      <text x={pl} y={H - 6} className="ax">{firstL || 'first'}</text><text x={W - pr} y={H - 6} textAnchor="end" className="ax">{lastL || 'last'}</text>
      {ref != null && <line x1={pl} x2={W - pr} y1={y(ref)} y2={y(ref)} className="ref" />}
      {zeroLine && <line x1={pl} x2={W - pr} y1={y(0)} y2={y(0)} className="zero" />}
      {lines.map((l, si) => {
        const n = l.pts.length;
        const d = l.pts.map((p, i) => (i ? 'L' : 'M') + x(i, n).toFixed(1) + ',' + y(p.v).toFixed(1)).join(' ');
        const lp = l.pts[n - 1];
        return <g key={si}>
          <path d={`${d} L${x(n - 1, n)},${y(Math.max(lo, Math.min(0, hi)) === 0 && (area || zeroLine) ? 0 : lo)} L${x(0, n)},${y(Math.max(lo, Math.min(0, hi)) === 0 && (area || zeroLine) ? 0 : lo)} Z`} fill={color(v.color, si)} opacity={area ? 0.25 : 0.07} />
          <path d={d} fill="none" stroke={color(v.color, si)} strokeWidth={2} strokeLinejoin="round" />
          {l.pts.map((p, i) => <circle key={i} cx={x(i, n)} cy={y(p.v)} r={7} fill="transparent"><title>{`${p.label ?? seqText(res, p.row, cat)} ${F(p.v, m, zeroLine)}`}</title></circle>)}
          <circle cx={x(n - 1, n)} cy={y(lp.v)} r={4} fill={color(v.color, si)} stroke="var(--surface)" strokeWidth={2} />
          {v.labels !== false && <text x={x(n - 1, n) - 6} y={y(lp.v) - 8} textAnchor="end" className="lab">{F(lp.v, m, zeroLine)}</text>}
        </g>;
      })}
    </svg>
    <Legend items={[...lines.map((l, i) => [color(v.color, i), l.name] as [string, string]), ...(ref != null ? [['dash', `${res.compare!.label}: ${F(ref, m)}`] as [string, string]] : [])]} />
  </>;
}

// ---------- distributions ----------
function Hist({ v, res }: { v: Visualization; res: Result }) {
  const vals = rowValues(res), m = res.measures[0];
  if (vals.length < 3) return <Empty msg="Needs at least three rows with a value." />;
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const nb = Math.min(16, Math.max(5, Math.round(Math.sqrt(vals.length)))), step = (hi - lo) / nb || 1;
  const bins = Array.from({ length: nb }, (_, i) => ({ lo: lo + i * step, hi: lo + (i + 1) * step, n: 0 }));
  vals.forEach(x => { bins[Math.min(nb - 1, Math.floor((x - lo) / step))].n++; });
  const W = useW(), H = 180, pl = 30, pb = 26, pt = 8, maxN = Math.max(...bins.map(b => b.n));
  const bw = (W - pl - 10) / nb, X = (val: number) => pl + (val - lo) / (hi - lo || 1) * (W - pl - 10), Y = (n: number) => pt + (1 - n / maxN) * (H - pt - pb);
  const ref = res.compare?.value;
  // The four numbers a distribution is read by: where the middle is, how wide the middle half is, where it peaks, and the average.
  const med = quantile(vals, 0.5)!, q1 = quantile(vals, 0.25)!, q3 = quantile(vals, 0.75)!, mu = mean(vals)!;
  const top = bins.reduce((a, b) => b.n > a.n ? b : a);
  return <>
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${m?.label}: median ${F(med, m)}, middle half ${F(q1, m)} to ${F(q3, m)}`}>
      <rect x={X(q1)} y={pt} width={Math.max(1, X(q3) - X(q1))} height={H - pb - pt} fill="var(--surface-2)" />
      {bins.map((b, i) => <rect key={i} x={pl + i * bw + 1} y={Y(b.n)} width={bw - 2} height={H - pb - Y(b.n)} rx={3} fill={color(v.color)}><title>{`${F(b.lo, m)} to ${F(b.hi, m)}: ${b.n} ${res.grain}s`}</title></rect>)}
      {niceTicks(lo, hi, 5).filter(t => t >= lo && t <= hi).map(tv => <text key={tv} x={X(tv)} y={H - 8} textAnchor="middle" className="ax">{F(tv, m)}</text>)}
      <line x1={X(med)} x2={X(med)} y1={pt} y2={H - pb} className="solid" /><text x={X(med) + 4} y={pt + 10} className="lab">median {F(med, m)}</text>
      {ref != null && ref >= lo && ref <= hi && <line x1={X(ref)} x2={X(ref)} y1={pt} y2={H - pb} className="ref" />}
    </svg>
    <Legend items={[['var(--surface-2)', 'shaded: middle half'], ...(ref != null ? [['dash', `${res.compare!.label}: ${F(ref, m)}`] as [string, string]] : [])]} />
    <div className="trendstats">
      <div><div className="k">median</div><div className="v">{F(med, m)}</div></div>
      <div><div className="k">middle half</div><div className="v">{F(q1, m)} to {F(q3, m)}</div></div>
      <div><div className="k">most common</div><div className="v">{F(top.lo, m)} to {F(top.hi, m)}</div></div>
      <div><div className="k">mean</div><div className="v">{F(mu, m)}</div></div>
    </div>
  </>;
}

// ---------- distribution against a reference population ----------
/** Bins of the query (its first group-by) and of the reference dataset counted into the same bins. */
export function distOf(v: Visualization, res: Result, cat: Catalog): { d: DistSummary | null; label: string; msg?: string } {
  const q = res.query, g0 = q.groupBy[0], m = res.measures[0];
  if (!g0 || !res.groups || q.groupBy.length !== 1) return { d: null, label: '', msg: 'A distribution needs a query grouped by one field: the bins.' };
  const fields = fieldsFor(cat.ws, res.datasetId, cat.tables[res.datasetId]);
  const sortOf = (fs: typeof fields) => fs.find(f => f.id === g0.field)?.sortBy;
  const orderFn = (src: string | undefined) => { if (!src) return null; try { const n = compile(src); return (r: Row) => toNum(evaluate(n, r)); } catch { return null; } };
  const so = orderFn(sortOf(fields));
  const sample: BinCount[] = res.groups.filter(g => g.keys[0] != null && g.values[0] != null).map((g, i) => ({ key: keyText(g.keys[0]), order: so && g.rows[0] ? so(g.rows[0]) ?? NaN : i, n: g.values[0] as number }));
  const refId = v.dist?.dataset || (q.compare.kind === 'reference' ? q.compare.dataset : undefined);
  const rt = refId ? cat.tables[refId] : undefined;
  const label = v.dist?.label || (refId ? cat.ws.datasets.find(d => d.id === refId)?.name || refId : '');
  const refBins: BinCount[] = [];
  let msg: string | undefined;
  if (refId && !rt) msg = `The reference dataset ${refId} has not loaded.`;
  if (rt) {
    const rfields = fieldsFor(cat.ws, refId!, rt);
    const keyE = fieldExpr(g0.field, rfields);
    const rf = rfields.find(f => f.id === m?.fieldId && f.role === 'measure');
    const wE = v.dist?.weight || (rf && (rf.agg === 'sum' || rf.agg === 'count') ? rf.expr : '1');
    const miss = [...missingColumns(keyE, rt), ...missingColumns(wE, rt)];
    if (miss.length) msg = `The reference dataset has no ${miss.join(', ')}.`;
    else {
      const kn = compile(keyE), wn = compile(wE), ro = orderFn(sortOf(rfields) && !missingColumns(sortOf(rfields)!, rt).length ? sortOf(rfields) : undefined);
      const exprOf = (name: string) => compile(fieldExpr(name, rfields));
      const acc = new Map<string, BinCount>();
      for (const r of rt.rows) {
        if (v.dist?.filters?.length && !matchFilters(r, v.dist.filters, exprOf)) continue;
        const k = evaluate(kn, r), w = toNum(evaluate(wn, r));
        if (k == null || w == null) continue;
        const key = String(k);
        let b = acc.get(key); if (!b) acc.set(key, b = { key, order: ro ? ro(r) ?? NaN : sample.find(s => s.key === key)?.order ?? NaN, n: 0 });
        b.n += w;
      }
      refBins.push(...acc.values());
    }
  }
  return { d: distribution(sample, refBins), label, msg };
}

function Distribution({ v, res, cat }: { v: Visualization; res: Result; cat: Catalog }) {
  const { d, label, msg } = distOf(v, res, cat);
  const [share, setShare] = React.useState<number | null>(null);
  if (!d) return <Empty msg={msg || 'No rows match this query.'} />;
  const hasRef = d.refTotal > 0;
  const W = useW(), H = 230, pl = 40, pr = 8, pt = 12, pb = 56;
  const bins = d.bins, bw = (W - pl - pr) / bins.length;
  const hi = (Math.max(...bins.map(b => Math.max(b.share, b.refShare))) || 1) * 1.08;
  const Y = (x: number) => pt + (1 - x / hi) * (H - pt - pb);
  const X = (i: number) => pl + i * bw;
  const idx = (k: string) => bins.findIndex(b => b.key === k);
  const i1 = idx(d.p25.bin.key), i3 = idx(d.p75.bin.key), im = idx(d.median.bin.key);
  const pct = (x: number) => (x * 100).toFixed(1) + '%';
  const at = (x: number | null) => x == null ? '' : `${ordinal(x)} percentile`;
  const g = res.grain;
  const rot = bins.length > 8;
  return <>
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${res.n} ${g}s by ${res.query.groupBy[0].field}${hasRef ? ` against ${label}` : ''}; median ${d.median.bin.key}`}>
      <rect x={X(i1)} y={pt} width={(i3 - i1 + 1) * bw} height={H - pt - pb} fill="var(--surface-2)" />
      {niceTicks(0, hi, 4).filter(t => t <= hi).map(tv => <g key={tv}><line x1={pl} x2={W - pr} y1={Y(tv)} y2={Y(tv)} className="grid" /><text x={pl - 4} y={Y(tv) + 4} textAnchor="end" className="ax">{Math.round(tv * 100)}%</text></g>)}
      {bins.map((b, i) => <g key={b.key}>
        <rect x={X(i) + 2} y={Y(b.share)} width={Math.max(1, bw - 4)} height={H - pb - Y(b.share)} rx={2} fill={color(v.color)}><title>{`${b.key}: ${b.n.toLocaleString()} ${g}s, ${pct(b.share)}${hasRef ? `; ${label} ${pct(b.refShare)}, its ${b.refLo.toFixed(0)}th to ${b.refHi.toFixed(0)}th percentile` : ''}`}</title></rect>
        {hasRef && <path d={`M${X(i) + 1},${H - pb} V${Y(b.refShare)} H${X(i + 1) - 1} V${H - pb}`} fill="none" stroke="var(--text)" strokeWidth={1.5} />}
        <text x={X(i) + bw / 2} y={H - pb + 12} textAnchor={rot ? 'end' : 'middle'} transform={rot ? `rotate(-45 ${X(i) + bw / 2} ${H - pb + 12})` : undefined} className={'lab' + (i === im ? ' strong' : '')}>{b.key.slice(0, 12)}</text>
      </g>)}
      <line x1={X(im) + bw / 2} x2={X(im) + bw / 2} y1={pt} y2={H - pb} className="solid" />
    </svg>
    <Legend items={[[color(v.color), `${d.total.toLocaleString()} ${g}s, share per bin`], ...(hasRef ? [['var(--text)', `outline: ${label}`] as [string, string]] : []), ['var(--surface-2)', 'shaded: middle half'], ['var(--text)', `line: median`]]} />
    <div className="trendstats">
      <div><div className="k">Baseline (median)</div><div className="v">{d.median.bin.key}</div><div className="small muted">{hasRef ? at(d.median.refPct) + ' of ' + label : ''}</div></div>
      <div><div className="k">Consistency (middle half)</div><div className="v">{d.p25.bin.key === d.p75.bin.key ? d.p25.bin.key : `${d.p25.bin.key} to ${d.p75.bin.key}`}</div><div className="small muted">{hasRef && d.p25.refPct != null ? `${ordinal(d.p25.refPct)} to ${at(d.p75.refPct)}` : ''}</div></div>
      <div><div className="k">Peak (most common)</div><div className="v">{d.mode.key}</div><div className="small muted">{pct(d.mode.share)} of {g}s{hasRef ? `, ${pct(d.mode.refShare)} of ${label}` : ''}</div></div>
      {hasRef && <div><div className="k">Against {label}</div><div className="v">{d.shift == null ? '—' : `${d.shift >= 0 ? '+' : ''}${d.shift.toFixed(0)} pts`}</div><div className="small muted">{d.superiority == null ? '' : `ranks higher ${(d.superiority * 100).toFixed(0)}% of the time`}</div></div>}
    </div>
    {v.hidden && <Hidden d={d} label={label} g={g} what={v.hidden.label || 'hidden'} share={share ?? v.hidden.share} setShare={setShare} />}
    {(W >= 700 || !hasRef || msg) && <div className="small muted">{!hasRef ? 'Pick a reference dataset to compare this distribution with a population.' : W >= 700 ? `Shift: the median's percentile in ${label} minus 50. "Ranks higher" is the chance that a random ${g} here sits in a higher bin than a random member of ${label}, ties counted half; 50% would be no difference. Percentiles inside a bin are interpolated.` : ''}{msg ? ' ' + msg : ''}</div>}
  </>;
}

/** What if part of the group is shown below its median but belongs above it: the range the median can move. */
function Hidden({ d, label, g, what, share, setShare }: { d: DistSummary; label: string; g: string; what: string; share: number; setShare: (x: number) => void }) {
  const r = hiddenRange(d, share / 100);
  const at = (x: number | null) => x == null ? '' : ordinal(x);
  const moved = r.high.bin.key !== r.low.bin.key || (r.high.refPct != null && r.low.refPct != null && r.high.refPct - r.low.refPct >= 0.5);
  return <div className="hidden-whatif">
    <label className="inline small">If <input type="range" min={0} max={30} step={1} value={share} onChange={e => setShare(Number(e.target.value))} aria-label={`share of ${g}s who are ${what}`} /> <b>{share}%</b> of these {g}s are {what} shown below the median</label>
    <div className="small">the median stays at <b>{r.low.bin.key}</b>{r.low.refPct != null ? ` (${at(r.low.refPct)} percentile of ${label})` : ''} if they belong exactly at it, and rises at most to <b>{r.high.bin.key}</b>{r.high.refPct != null ? ` (${at(r.high.refPct)})` : ''} if all of them belong above it{moved ? '' : ': no visible change at this share'}.</div>
  </div>;
}

function Scatter({ v, res, cat }: { v: Visualization; res: Result; cat: Catalog }) {
  const m = res.measures[0]; if (!m) return <Empty />;
  const fields = fieldsFor(cat.ws, res.datasetId, cat.tables[res.datasetId]);
  const xField = v.x || fields.find(f => f.role === 'measure' && f.expr !== m.expr)?.id;
  if (!xField) return <Empty msg="Pick a field for the horizontal axis." />;
  const xs0 = measureFn({ ...m, expr: fieldExpr(xField, fields), agg: 'avg', weight: undefined, denominator: undefined });
  const f = measureFn(m);
  const yp = f.parts(res.rows), xp = xs0.parts(res.rows);
  const pts: { x: number; y: number; row: Row }[] = [];
  res.rows.forEach((r, i) => { const xv = toNum(xp[i].x), yv0 = toNum(yp[i].x); const yv = yv0 != null && m.denominator ? (yp[i].d ? yv0 / yp[i].d! : null) : yv0; if (xv != null && yv != null && Number.isFinite(yv)) pts.push({ x: xv, y: yv, row: r }); });
  if (pts.length < 2) return <Empty />;
  const xl = fields.find(x => x.id === xField)?.label || xField;
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  const xlo = Math.min(...xs), xhi = Math.max(...xs), ylo = Math.min(...ys), yhi = Math.max(...ys);
  const W = useW(), H = 220, pl = 46, pr = 12, pt = 10, pb = 30;
  const X = (val: number) => pl + (val - xlo) / (xhi - xlo || 1) * (W - pl - pr), Y = (val: number) => pt + (1 - (val - ylo) / (yhi - ylo || 1)) * (H - pt - pb);
  const mx = mean(xs)!, my = mean(ys)!; let num = 0, den = 0; xs.forEach((val, i) => { num += (val - mx) * (ys[i] - my); den += (val - mx) ** 2; });
  const b = den ? num / den : 0, a = my - b * mx;
  return <>
    <svg viewBox={`0 0 ${W} ${H}`} role="img">
      {niceTicks(ylo, yhi, 4).filter(t => t >= ylo && t <= yhi).map(tv => <g key={tv}><line x1={pl} x2={W - pr} y1={Y(tv)} y2={Y(tv)} className="grid" /><text x={pl - 6} y={Y(tv) + 4} textAnchor="end" className="ax">{F(tv, m)}</text></g>)}
      {niceTicks(xlo, xhi, 5).filter(t => t >= xlo && t <= xhi).map(tv => <text key={tv} x={X(tv)} y={H - 14} textAnchor="middle" className="ax">{String(+tv.toFixed(2))}</text>)}
      <text x={W - pr} y={H - 2} textAnchor="end" className="ax">{xl} →</text>
      {pts.map((p, i) => <circle key={i} cx={X(p.x)} cy={Y(p.y)} r={4} fill={color(v.color)} stroke="var(--surface)" strokeWidth={1.2} opacity={0.85}><title>{`${xl} ${+p.x.toFixed(2)}, ${m.label} ${F(p.y, m)}`}</title></circle>)}
      {den ? <line x1={X(xlo)} y1={Y(a + b * xlo)} x2={X(xhi)} y2={Y(a + b * xhi)} className="ref" /> : null}
    </svg>
    <Legend items={[[color(v.color), `${pts.length} ${res.grain}s`], ['dash', `linear fit: ${b >= 0 ? '+' : ''}${b.toPrecision(3)} per unit of ${xl}`]]} />
  </>;
}

function Heat({ res }: { res: Result }) {
  const g = (res.groups || []).filter(x => x.values[0] != null);
  if (res.query.groupBy.length < 2 || !g.length) return <Empty msg="A heatmap needs a query grouped by two fields." />;
  const m = res.measures[0], q = res.query;
  const order = (i: number) => (a: string, b: string) => q.groupBy[i].grain === 'weekday' ? WEEKDAY_ORDER.indexOf(a) - WEEKDAY_ORDER.indexOf(b) : a.localeCompare(b, undefined, { numeric: true });
  const ks = [...new Set(g.map(x => keyText(x.keys[0])))].sort(order(0)).slice(0, 20), k2s = [...new Set(g.map(x => keyText(x.keys[1])))].sort(order(1)).slice(0, 24);
  const W0 = useW(); const cw = Math.max(18, Math.min(48, Math.floor((W0 - 102) / k2s.length))), ch = 20, pl = 92, W = pl + cw * k2s.length + 10, H = ch * ks.length + 30;
  const vals = g.map(x => x.values[0] as number), lo = isPct(m) ? 0 : Math.min(...vals), hi = isPct(m) ? 1 : Math.max(...vals);
  return <>
    <svg viewBox={`0 0 ${W} ${H}`} role="img" style={{ maxWidth: W }}>
      {k2s.map((k2, j) => <text key={k2} x={pl + j * cw + cw / 2} y={12} textAnchor="middle" className="ax">{k2.slice(0, 5)}</text>)}
      {ks.map((k, i) => <g key={k}>
        <text x={pl - 6} y={20 + i * ch + 14} textAnchor="end" className="lab">{k.slice(0, 14)}</text>
        {k2s.map((k2, j) => { const d = g.find(z => keyText(z.keys[0]) === k && keyText(z.keys[1]) === k2); if (!d) return null; const t = ((d.values[0] as number) - lo) / (hi - lo || 1); return <rect key={k2} x={pl + j * cw + 1} y={20 + i * ch + 1} width={cw - 2} height={ch - 2} rx={3} fill={`var(--q${Math.min(7, Math.max(1, 1 + Math.floor(t * 6.999)))})`}><title>{`${k} × ${k2}: ${F(d.values[0], m)} (n=${d.n})`}</title></rect>; })}
      </g>)}
    </svg>
    <Legend items={[['var(--q1)', F(lo, m)], ['var(--q7)', F(hi, m)]]} />
  </>;
}

// ---------- tables ----------
function ResultTable({ res, cat }: { res: Result; cat: Catalog }) {
  const ms = res.measures, q = res.query;
  const fields = fieldsFor(cat.ws, res.datasetId, cat.tables[res.datasetId]);
  const dimLabel = (i: number) => { const g = q.groupBy[i]; const f = fields.find(x => x.id === g.field); return (f?.label || g.field) + (g.grain && g.grain !== 'none' ? ` (${g.grain})` : ''); };
  const hasCmp = res.groups?.some(g => g.compare != null);
  if (!res.groups) {
    return <div className="tscroll"><table className="data"><thead><tr><th>measure</th><th className="num">value</th>{res.unweighted && <th className="num">unweighted</th>}</tr></thead>
      <tbody>{ms.map((m, i) => <tr key={i}><td>{m.label}<span className="muted small"> · {m.agg}{m.weight ? ` weighted by ${m.weight}` : ''}{m.denominator ? ` ÷ ${m.denominator}` : ''}</span></td><td className="num">{F(res.values[i], m)}</td>{res.unweighted && <td className="num muted">{m.weight ? F(res.unweighted[i], m) : ''}</td>}</tr>)}
        <tr className="foot"><td>rows</td><td className="num">{res.n.toLocaleString()}</td>{res.unweighted && <td />}</tr></tbody></table><CompareLine res={res} /></div>;
  }
  // Totals go after the groups they summarise.
  const rows: { g: Group; total?: 'subtotal' | 'grand' }[] = [];
  const subs = new Map((res.totals || []).filter(t => t.total === 'subtotal').map(t => [keyText(t.keys[0]), t]));
  const two = q.groupBy.length > 1;
  let last: string | null = null;
  const flush = () => { if (two && last != null && subs.has(last)) { rows.push({ g: subs.get(last)!, total: 'subtotal' }); subs.delete(last); } };
  for (const g of res.groups) { const k = keyText(g.keys[0]); if (two && last != null && k !== last) flush(); last = k; rows.push({ g }); }
  flush();
  const grand = res.totals?.find(t => t.total === 'grand'); if (grand) rows.push({ g: grand, total: 'grand' });
  return <div className="tscroll"><table className="data">
    <thead><tr>{q.groupBy.map((_, i) => <th key={i}>{dimLabel(i)}</th>)}{ms.map((m, i) => <th key={i} className="num">{m.label}</th>)}<th className="num">rows</th>{hasCmp && <th className="num">{res.query.compare.kind === 'paired' ? res.query.compare.label || 'paired' : 'reference'}</th>}</tr></thead>
    <tbody>{rows.slice(0, 400).map(({ g, total }, i) => <tr key={i} className={total ? 'total ' + total : ''}>
      {q.groupBy.map((_, j) => <td key={j}>{total === 'grand' ? (j === 0 ? 'All' : '') : total === 'subtotal' && j > 0 ? 'subtotal' : keyText(g.keys[j])}</td>)}
      {ms.map((m, j) => <td key={j} className="num">{F(g.values[j], m)}</td>)}
      <td className="num muted">{g.n.toLocaleString()}</td>
      {hasCmp && <td className="num">{F(g.compare, ms[0])}</td>}
    </tr>)}</tbody></table>
    {!hasCmp && <CompareLine res={res} />}</div>;
}

function Spark({ vals, c }: { vals: number[]; c: string }) {
  const W = 120, H = 26, lo = Math.min(...vals), hi = Math.max(...vals);
  const x = (i: number) => 2 + i / Math.max(1, vals.length - 1) * (W - 4), y = (val: number) => 2 + (1 - (val - lo) / (hi - lo || 1)) * (H - 4);
  return <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="inline"><path d={vals.map((val, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ',' + y(val).toFixed(1)).join(' ')} fill="none" stroke={c} strokeWidth={1.5} /><circle cx={x(vals.length - 1)} cy={y(vals[vals.length - 1])} r={2.5} fill={c} /></svg>;
}

function SparkTable({ v, res, cat }: { v: Visualization; res: Result; cat: Catalog }) {
  const g = (res.groups || []).slice(0, 25), m = res.measures[0];
  if (!g.length || !m) return <Empty msg="A trend table needs a query grouped by a field." />;
  const f = measureFn(m), win = v.window || 10;
  const hasCmp = g.some(x => x.compare != null);
  const fields = fieldsFor(cat.ws, res.datasetId, cat.tables[res.datasetId]);
  const dim = fields.find(x => x.id === res.query.groupBy[0].field)?.label || res.query.groupBy[0].field;
  return <div className="tscroll"><table className="data">
    <thead><tr><th>{dim}</th><th className="num">{res.grain}s</th><th className="num">{m.label}</th>{hasCmp && <th className="num">{res.query.compare.kind === 'reference' ? res.query.compare.label || 'reference' : 'compare'}</th>}<th className="num">recent half vs earlier</th><th>rolling {win}</th></tr></thead>
    <tbody>{g.map((d, i) => {
      const half = Math.floor(d.rows.length / 2);
      const recent = f.value(d.rows.slice(half)), earlier = half ? f.value(d.rows.slice(0, half)) : null;
      const diff = recent != null && earlier != null ? recent - earlier : null;
      const pts = seriesOf(pointsOf(f, d.rows), m.agg, !!f.w, 'rolling', Math.min(win, Math.max(2, d.rows.length))).map(p => p.v);
      const b = diff == null ? null : better(diff, m);
      const cb = d.compare != null && d.values[0] != null ? better((d.values[0] as number) - d.compare, m) : null;
      return <tr key={i}><td>{keyText(d.keys[0])}</td><td className="num muted">{d.n}</td><td className={'num ' + (cb == null ? '' : cb ? 'pos' : 'neg')}>{F(d.values[0], m)}</td>{hasCmp && <td className="num">{F(d.compare, m)}</td>}
        <td className={'num ' + (b == null ? '' : b ? 'pos' : 'neg')}>{diff == null ? '—' : (diff >= 0 ? '▲ ' : '▼ ') + F(diff, m, true)}</td>
        <td>{pts.length > 1 ? <Spark vals={pts} c={color(v.color)} /> : '·'}</td></tr>;
    })}</tbody></table></div>;
}

// ---------- trend tile: is it moving, and is the movement more than noise? ----------
function Trend({ v, res, cat }: { v: Visualization; res: Result; cat: Catalog }) {
  const m = res.measures[0]; if (!m) return <Empty />;
  const f = measureFn(m);
  const raw = pointsOf(f, res.rows);
  if (raw.length < 6) return <Empty msg={`Needs at least 6 ${res.grain}s to judge a trend.`} />;
  const vals = raw.map(p => p.v);
  const win = Math.max(2, Math.min(v.window || 10, raw.length));
  const roll = seriesOf(raw, m.agg, !!f.w, 'rolling', win);
  const fit = ols(vals);
  const h = Math.floor(vals.length / 2), a = vals.slice(0, h), b = vals.slice(vals.length - h);
  const t = welch(a, b);
  const dir = t.diff * (m.polarity === 'lower' ? -1 : 1);
  const neutral = m.polarity === 'neutral';
  const verdict = t.p < 0.05 ? (neutral ? (t.diff > 0 ? 'rising' : 'falling') : dir > 0 ? 'improving' : 'declining') : t.p < 0.2 ? (neutral ? (t.diff > 0 ? 'leaning up' : 'leaning down') : dir > 0 ? 'leaning better' : 'leaning worse') : 'no clear trend';
  const cls = t.p < 0.05 && !neutral ? (dir > 0 ? 'pos' : 'neg') : '';
  const rate = isPct(m);
  const ref = res.compare?.value;
  const all = [...(rate ? [] : vals), ...roll.map(p => p.v), fit.intercept, fit.intercept + fit.slope * (vals.length - 1), ...(ref != null ? [ref] : [])];
  let lo = Math.min(...all), hi = Math.max(...all);
  if (rate) { lo = Math.max(0, Math.min(lo, 0.3)); hi = Math.min(1, Math.max(hi, 0.7)); }
  if (hi === lo) hi = lo + 1;
  const W = useW(), H = 200, pl = 46, pr = 12, pt = 10, pb = 26;
  const X = (i: number) => pl + i / Math.max(1, vals.length - 1) * (W - pl - pr), Y = (val: number) => pt + (1 - (val - lo) / (hi - lo)) * (H - pt - pb);
  const firstHalf = f.value(raw.slice(0, h).map(p => p.row)), lastHalf = f.value(raw.slice(raw.length - h).map(p => p.row));
  return <>
    <svg viewBox={`0 0 ${W} ${H}`} role="img">
      {niceTicks(lo, hi, 4).filter(tv => tv >= lo && tv <= hi).map(tv => <g key={tv}><line x1={pl} x2={W - pr} y1={Y(tv)} y2={Y(tv)} className="grid" /><text x={pl - 6} y={Y(tv) + 4} textAnchor="end" className="ax">{F(tv, m)}</text></g>)}
      <text x={pl} y={H - 6} className="ax">{seqText(res, raw[0].row, cat) || 'first'}</text><text x={W - pr} y={H - 6} textAnchor="end" className="ax">{seqText(res, raw[raw.length - 1].row, cat) || 'last'}</text>
      {ref != null && <line x1={pl} x2={W - pr} y1={Y(ref)} y2={Y(ref)} className="ref" />}
      {!rate && raw.map((p, i) => <circle key={i} cx={X(i)} cy={Y(p.v)} r={2.2} fill={color(v.color)} opacity={0.35}><title>{`${seqText(res, p.row, cat)}: ${F(p.v, m)}`}</title></circle>)}
      {roll.length > 1 && <path d={roll.map((p, i) => (i ? 'L' : 'M') + X(p.i).toFixed(1) + ',' + Y(p.v).toFixed(1)).join(' ')} fill="none" stroke={color(v.color)} strokeWidth={2} strokeLinejoin="round" />}
      <line x1={X(0)} y1={Y(fit.intercept)} x2={X(vals.length - 1)} y2={Y(fit.intercept + fit.slope * (vals.length - 1))} stroke={color(v.color, 1)} strokeWidth={2} strokeDasharray="6 4" />
      <line x1={X(h - 0.5)} x2={X(h - 0.5)} y1={pt} y2={H - pb} className="half" />
    </svg>
    <Legend items={[[color(v.color), `rolling ${win}-${res.grain} ${m.label}${rate ? '' : ` (dots: single ${res.grain}s)`}`], [color(v.color, 1), 'least-squares trend'], ...(ref != null ? [['dash', `${res.compare!.label}: ${F(ref, m)}`] as [string, string]] : [])]} />
    <div className="trendstats">
      <div><div className="k">rate of change / 10 {res.grain}s</div><div className="v">{F(fit.slope * 10, m, true)}</div></div>
      <div><div className="k">last {h} vs first {h}</div><div className="v">{F(t.diff, m, true)} <span className="small muted">({F(firstHalf, m)} → {F(lastHalf, m)})</span></div></div>
      <div><div className="k">confidence</div><div className="v">{t.p < 0.001 ? 'p < 0.001' : 'p = ' + t.p.toFixed(2)}</div></div>
      <div><div className="k">verdict</div><div className={'v ' + cls}>{verdict}</div></div>
    </div>
    <div className="small muted">{vals.length} {res.grain}s. The verdict is a two-sample t-test between the halves: p &lt; 0.05 is called a trend, 0.05 to 0.2 a lean, otherwise noise. The straight line explains {(fit.r2 * 100).toFixed(0)}% of the variance.</div>
  </>;
}


// ---------- flow: where each "from" category went ----------
export function flowFor(res: Result, cat: Catalog): { f: FlowSummary | null; msg?: string } {
  const q = res.query;
  if (q.groupBy.length !== 2 || !res.groups) return { f: null, msg: 'A flow needs a query grouped by two fields: where rows started and where they ended up.' };
  const fields = fieldsFor(cat.ws, res.datasetId, cat.tables[res.datasetId]);
  // Each side orders its categories by its own sortBy; a category seen on both sides keeps the first order found.
  const order = new Map<string, number>();
  q.groupBy.forEach((gb, side) => {
    const src = fields.find(x => x.id === gb.field)?.sortBy; if (!src) return;
    let n; try { n = compile(src); } catch { return; }
    for (const g of res.groups!) { const k = g.keys[side]; if (k == null || order.has(String(k)) || !g.rows[0]) continue; const v = toNum(evaluate(n, g.rows[0])); if (v != null) order.set(String(k), v); }
  });
  const cells = res.groups.filter(g => g.keys[0] != null && g.keys[1] != null && g.values[0] != null).map(g => ({ from: String(g.keys[0]), to: String(g.keys[1]), n: g.values[0] as number }));
  return { f: flowOf(cells, k => order.get(k) ?? null) };
}

function Flow({ v, res, cat }: { v: Visualization; res: Result; cat: Catalog }) {
  const { f, msg } = flowFor(res, cat);
  if (!f) return <Empty msg={msg} />;
  const W = useW(), g = res.measures[0]?.agg === 'count' ? `${res.grain}s` : res.measures[0]?.label || `${res.grain}s`, pct = (x: number) => (x / f.total * 100).toFixed(1) + '%';
  const dirColor = { up: 'var(--ok)', down: 'var(--bad)', same: 'var(--text-3)', changed: color(v.color) };
  const fields = fieldsFor(cat.ws, res.datasetId, cat.tables[res.datasetId]);
  const sideLabel = (i: number) => fields.find(x => x.id === res.query.groupBy[i].field)?.label || res.query.groupBy[i].field;
  const readout = <div className="trendstats">
    {f.ordered ? <>
      <div><div className="k">stayed</div><div className="v">{pct(f.stayed)}</div><div className="small muted">{f.stayed.toLocaleString()} {g}</div></div>
      <div><div className="k">moved up</div><div className="v pos">{pct(f.up)}</div><div className="small muted">{f.up.toLocaleString()} {g}</div></div>
      <div><div className="k">moved down</div><div className="v neg">{pct(f.down)}</div><div className="small muted">{f.down.toLocaleString()} {g}</div></div>
    </> : <>
      <div><div className="k">stayed</div><div className="v">{pct(f.stayed)}</div></div>
      <div><div className="k">changed</div><div className="v">{pct(f.changed)}</div></div>
      <div />
    </>}
    <div><div className="k">net change</div><div className="v">{f.gainer ? `${f.gainer.key} +${(f.gainer.in - f.gainer.out).toLocaleString()}` : '—'}</div><div className="small muted">{f.loser ? `${f.loser.key} ${(f.loser.in - f.loser.out).toLocaleString()}` : ''}</div></div>
  </div>;
  // Many categories: a matrix of row shares (where each starting category went) reads better than bands.
  if (f.nodes.length > 12) {
    const from = f.nodes.filter(x => x.out > 0), to = f.nodes.filter(x => x.in > 0);
    const cw = Math.max(12, Math.min(28, Math.floor((W - 96) / to.length))), ch = Math.max(12, Math.min(20, cw)), pl = 90, pt = 60;
    const Wm = pl + cw * to.length + 6, Hm = pt + ch * from.length + 4;
    const cell = new Map(f.cells.map(c => [c.from + '\u0001' + c.to, c]));
    return <>
      <div className="tscroll"><svg viewBox={`0 0 ${Wm} ${Hm}`} role="img" style={{ maxWidth: Wm }} aria-label={`Flow from ${sideLabel(0)} to ${sideLabel(1)}`}>
        {to.map((t, j) => <text key={t.key} x={pl + j * cw + cw / 2} y={pt - 6} transform={`rotate(-55 ${pl + j * cw + cw / 2} ${pt - 6})`} className="ax">{t.key.slice(0, 11)}</text>)}
        {from.map((s, i) => <g key={s.key}>
          <text x={pl - 6} y={pt + i * ch + ch / 2 + 4} textAnchor="end" className="lab">{s.key.slice(0, 12)}</text>
          {to.map((t, j) => { const c = cell.get(s.key + '\u0001' + t.key); if (!c) return null; const share = c.n / s.out; return <rect key={t.key} x={pl + j * cw + 1} y={pt + i * ch + 1} width={cw - 2} height={ch - 2} rx={2} fill={dirColor[c.dir]} opacity={0.15 + 0.85 * Math.sqrt(share)}><title>{`${s.key} → ${t.key}: ${c.n.toLocaleString()} ${g}, ${(share * 100).toFixed(1)}% of ${s.key}`}</title></rect>; })}
        </g>)}
      </svg></div>
      <Legend items={[['var(--ok)', 'moved up'], ['var(--text-3)', 'stayed'], ['var(--bad)', 'moved down'], ['var(--surface-2)', `rows: ${sideLabel(0)}; columns: ${sideLabel(1)}; darker = larger share of the row`]]} />
      {readout}
    </>;
  }
  // Few categories: bands from each starting category (left) to where it ended up (right), highest first.
  const nodes = [...f.nodes].reverse();
  const H = Math.max(220, nodes.length * 34), pt = 8, pb = 8, gap = 6, nw = 12, lw = Math.min(110, W * 0.22);
  const x0 = lw, x1 = W - lw;
  const scale = (H - pt - pb - gap * (nodes.length - 1)) / f.total;
  const place = (side: 'out' | 'in') => { let y = pt; const m = new Map<string, number>(); for (const n of nodes) { m.set(n.key, y); y += n[side] * scale + (n[side] ? gap : 0); } return m; };
  const yl = place('out'), yr = place('in');
  const rank = new Map(nodes.map((n, i) => [n.key, i]));
  const offL = new Map<string, number>(), offR = new Map<string, number>();
  const bands = [...f.cells].sort((a, b) => rank.get(a.from)! - rank.get(b.from)! || rank.get(a.to)! - rank.get(b.to)!).map(c => {
    const h = c.n * scale;
    const ya = yl.get(c.from)! + (offL.get(c.from) || 0); offL.set(c.from, (offL.get(c.from) || 0) + h);
    return { c, h, ya };
  });
  // Right-hand offsets go in order of where the band came from, so bands do not cross inside a node.
  [...bands].sort((a, b) => rank.get(a.c.to)! - rank.get(b.c.to)! || rank.get(a.c.from)! - rank.get(b.c.from)!).forEach(b => { (b as typeof b & { yb: number }).yb = yr.get(b.c.to)! + (offR.get(b.c.to) || 0); offR.set(b.c.to, (offR.get(b.c.to) || 0) + b.h); });
  const mx = (x0 + nw + x1) / 2;
  return <>
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Flow from ${sideLabel(0)} to ${sideLabel(1)}: ${pct(f.stayed)} stayed${f.ordered ? `, ${pct(f.up)} moved up, ${pct(f.down)} moved down` : ''}`}>
      {bands.map((b, i) => { const yb = (b as typeof b & { yb: number }).yb; return <path key={i} d={`M${x0 + nw},${b.ya} C${mx},${b.ya} ${mx},${yb} ${x1},${yb} L${x1},${yb + b.h} C${mx},${yb + b.h} ${mx},${b.ya + b.h} ${x0 + nw},${b.ya + b.h} Z`} fill={dirColor[b.c.dir]} opacity={b.c.dir === 'same' ? 0.28 : 0.55}><title>{`${b.c.from} → ${b.c.to}: ${b.c.n.toLocaleString()} ${g} (${(b.c.n / f.nodes.find(n => n.key === b.c.from)!.out * 100).toFixed(1)}% of ${b.c.from})`}</title></path>; })}
      {nodes.map(n => <g key={n.key}>
        {n.out > 0 && <><rect x={x0} y={yl.get(n.key)} width={nw} height={Math.max(1, n.out * scale)} rx={2} fill={color(v.color)} /><text x={x0 - 6} y={yl.get(n.key)! + n.out * scale / 2 + 4} textAnchor="end" className="lab">{n.key} <tspan className="ax">{n.out.toLocaleString()}</tspan></text></>}
        {n.in > 0 && <><rect x={x1} y={yr.get(n.key)} width={nw} height={Math.max(1, n.in * scale)} rx={2} fill={color(v.color)} /><text x={x1 + nw + 6} y={yr.get(n.key)! + n.in * scale / 2 + 4} className="lab">{n.key} <tspan className="ax">{n.in.toLocaleString()}</tspan></text></>}
      </g>)}
    </svg>
    <Legend items={[...(f.ordered ? [['var(--ok)', 'moved up'], ['var(--bad)', 'moved down']] as [string, string][] : [[color(v.color), 'changed'] as [string, string]]), ['var(--text-3)', 'stayed'], ['var(--surface-2)', `left: ${sideLabel(0)}; right: ${sideLabel(1)}`]]} />
    {readout}
  </>;
}

// ---------- player card: Baseline, Consistency, Peak, Trend for every measure of the query ----------
const VERDICT_TEXT: Record<Profile['verdict'], string> = { improving: 'Improving', declining: 'Declining', rising: 'Rising', falling: 'Falling', 'no clear trend': 'No clear trend' };
function ProfileCard({ v, res, cat }: { v: Visualization; res: Result; cat: Catalog }) {
  const win = v.window || 20;
  const cards = res.measures.map(m => ({ m, p: profileOf(measureFn(m), res.rows, win, v.per || 100) })).filter((c): c is { m: ResolvedMeasure; p: Profile } => !!c.p);
  if (!cards.length) return <Empty msg={`Needs at least 3 ${res.grain}s with a value.`} />;
  const g = res.grain;
  return <>
    <div className="profile">
      {cards.map(({ m, p }, i) => <div key={i} className="pcard">
        <div className="pl">{m.label}</div>
        <div className="pk">Baseline</div>
        <div className="pv">{F(p.baseline, m)}</div>
        <dl>
          <dt>Consistency</dt><dd>{F(p.p25, m)} to {F(p.p75, m)}<span className="muted"> · middle half of {p.spreadOf === 'rows' ? `single ${g}s` : `${p.window}-${g} stretches`}</span></dd>
          <dt>Peak</dt><dd>{F(p.peak, m)}<span className="muted"> · best {p.window}-{g} stretch{p.peakRow ? `, to ${seqText(res, p.peakRow, cat)}` : ''}</span></dd>
          <dt>Trend</dt><dd>{F(p.trend, m, true)} per {p.per} {g}s{p.trendLow != null && <span className="muted"> · 95% range {F(p.trendLow, m, true)} to {F(p.trendHigh, m, true)}</span>}</dd>
        </dl>
        <span className={'vchip2 ' + (p.good === true ? 'up' : p.good === false ? 'down' : p.verdict === 'no clear trend' ? 'flat' : 'side')}>{VERDICT_TEXT[p.verdict]}</span>
      </div>)}
    </div>
    <div className="small muted">{cards[0].p.n} {g}s{res.query.weight ? `, weighted by ${res.query.weight}` : ''}. Baseline is each measure over all of them. A trend is called only when its 95% range excludes zero. The peak is the best {cards[0].p.window}-{g} stretch, so it sits above the baseline by luck alone; read the two together.</div>
  </>;
}

// ---------- ribbon: rolling baseline, the middle half of each window, single rows, and the peak ----------
function Ribbon({ v, res, cat }: { v: Visualization; res: Result; cat: Catalog }) {
  const m = res.measures[0]; if (!m) return <Empty />;
  const p = profileOf(measureFn(m), res.rows, v.window || 20);
  if (!p || p.bands.length < 2) return <Empty msg={`Needs more ${res.grain}s than the ${v.window || 20}-${res.grain} window to draw a ribbon.`} />;
  const raw = pointsOf(measureFn(m), res.rows);
  const rate = isPct(m) || raw.every(x => x.v === 0 || x.v === 1);
  const all = [...p.bands.flatMap(b => [b.lo, b.hi, b.v]), ...(rate ? [] : raw.map(x => x.v))];
  let lo = Math.min(...all), hi = Math.max(...all);
  if (rate) { lo = Math.max(0, lo); hi = Math.min(1, hi); }
  if (hi === lo) hi = lo + 1;
  const W = useW(), H = 220, pl = 46, pr = 12, pt = 10, pb = 26;
  const X = (i: number) => pl + i / Math.max(1, raw.length - 1) * (W - pl - pr), Y = (val: number) => pt + (1 - (val - lo) / (hi - lo)) * (H - pt - pb);
  const line = p.bands.map((b, k) => (k ? 'L' : 'M') + X(b.i).toFixed(1) + ',' + Y(b.v).toFixed(1)).join(' ');
  const band = p.bands.map((b, k) => (k ? 'L' : 'M') + X(b.i).toFixed(1) + ',' + Y(b.hi).toFixed(1)).join(' ') + ' ' + [...p.bands].reverse().map(b => 'L' + X(b.i).toFixed(1) + ',' + Y(b.lo).toFixed(1)).join(' ') + ' Z';
  const pk = p.bands.find(b => b.row === p.peakRow);
  const last = p.bands[p.bands.length - 1];
  return <>
    <svg viewBox={`0 0 ${W} ${H}`} role="img">
      {niceTicks(lo, hi, 4).filter(tv => tv >= lo && tv <= hi).map(tv => <g key={tv}><line x1={pl} x2={W - pr} y1={Y(tv)} y2={Y(tv)} className="grid" /><text x={pl - 6} y={Y(tv) + 4} textAnchor="end" className="ax">{F(tv, m)}</text></g>)}
      <text x={pl} y={H - 6} className="ax">{seqText(res, raw[0].row, cat) || 'first'}</text><text x={W - pr} y={H - 6} textAnchor="end" className="ax">{seqText(res, raw[raw.length - 1].row, cat) || 'last'}</text>
      <path d={band} fill={color(v.color)} opacity={0.16} />
      {!rate && raw.map((x, i) => <circle key={i} cx={X(i)} cy={Y(x.v)} r={2} fill="var(--text-2)" opacity={0.35}><title>{`${seqText(res, x.row, cat)}: ${F(x.v, m)}`}</title></circle>)}
      <path d={line} fill="none" stroke={color(v.color)} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      {p.bands.map((b, k) => <circle key={k} cx={X(b.i)} cy={Y(b.v)} r={6} fill="transparent"><title>{`${seqText(res, b.row, cat)}: baseline ${F(b.v, m)}, middle half ${F(b.lo, m)} to ${F(b.hi, m)}`}</title></circle>)}
      {pk && <circle cx={X(pk.i)} cy={Y(pk.v)} r={6} fill="none" stroke={color(v.color, 1)} strokeWidth={2} />}
      <circle cx={X(last.i)} cy={Y(last.v)} r={4} fill={color(v.color)} stroke="var(--surface)" strokeWidth={2} />
      {v.labels !== false && <text x={X(last.i) - 6} y={Y(last.v) - 8} textAnchor="end" className="lab">{F(last.v, m)}</text>}
    </svg>
    <Legend items={[[color(v.color), `${p.window}-${res.grain} baseline (${m.label}), band: middle half of each window`], [color(v.color, 1), `peak ${F(p.peak, m)}`]]} />
  </>;
}

// ---------- comparison card: rows of measures × columns of groups to compare with ----------
function Card({ v, res, cat }: { v: Visualization; res: Result; cat: Catalog }) {
  const card = v.card;
  if (!card || !card.rows.length) return <Empty msg="This card has no rows yet. Add them in the visualization editor." />;
  const table = cat.tables[res.datasetId];
  const fields = fieldsFor(cat.ws, res.datasetId, table);
  const rows = res.rows;
  if (!rows.length) return <Empty />;
  const out = card.rows.map(cr => {
    const m = resolveMeasure({ field: cr.field }, fields, res.query.weight);
    if (!m) return null;
    const plainM = m;
    const self = measureFn(plainM).value(rows);
    const cells = card.columns.map(col => {
      if (col.kind === 'self') return self;
      if (col.kind === 'paired') {
        const name = (col.pattern || '{f}').replace('{f}', cr.field).replace('{alias}', cr.alias || cr.field);
        const e = fieldExpr(name, fields);
        if (missingColumns(e, table).length) return null;
        return measureFn({ ...plainM, expr: e, agg: plainM.agg === 'count' ? 'sum' : plainM.agg }).value(rows);
      }
      if (col.kind === 'reference' && col.dataset) return reference(cat, { kind: 'reference', dataset: col.dataset, filters: col.filters, weightBy: col.weightBy }, m, rows, '')?.value ?? null;
      return null;
    });
    return { cr, m, cells };
  }).filter((x): x is NonNullable<typeof x> => !!x && x.cells[0] != null);
  if (!out.length) return <Empty msg="None of the card's rows exist on this dataset." />;
  return <>
    <div className="tscroll"><table className="data card">
      <thead><tr><th>stat</th>{card.columns.map((c, i) => <th key={i} className="num">{c.label}</th>)}<th /></tr></thead>
      <tbody>{out.map(({ cr, m, cells }, i) => {
        const pol = cr.polarity || m.polarity;
        const dots = cells.map((c, j) => [c, j] as const).filter(([c, j]) => c != null && !card.columns[j].signed) as [number, number][];
        const lo = Math.min(...dots.map(d => d[0])), hi = Math.max(...dots.map(d => d[0]));
        const W = 140, Hh = 18, x = (val: number) => 6 + (hi > lo ? (val - lo) / (hi - lo) : 0.5) * (W - 12);
        return <tr key={i}><td>{cr.label}</td>
          {cells.map((c, j) => {
            let cls = '';
            if (j === 0 && cells[1] != null && pol !== 'neutral') cls = (pol === 'lower' ? c! < cells[1]! : c! > cells[1]!) ? 'pos' : 'neg';
            return <td key={j} className={'num ' + cls}>{F(c, m, !!card.columns[j].signed)}</td>;
          })}
          <td>{dots.length > 1 && <svg viewBox={`0 0 ${W} ${Hh}`} width={W} height={Hh} className="inline"><line x1={6} x2={W - 6} y1={Hh / 2} y2={Hh / 2} className="grid" />{dots.map(([c, j]) => <circle key={j} cx={x(c)} cy={Hh / 2} r={5} fill={color(v.color, j)} stroke="var(--surface)" strokeWidth={1.5}><title>{`${card.columns[j].label}: ${F(c, m)}`}</title></circle>)}</svg>}</td>
        </tr>;
      })}</tbody></table></div>
    <Legend items={card.columns.filter(c => !c.signed).map((c) => [color(v.color, card.columns.indexOf(c)), c.label])} />
  </>;
}

export const VIZ_TYPES: { id: Visualization['type']; name: string; needs?: string }[] = [
  { id: 'kpi', name: 'KPI number' }, { id: 'gauge', name: 'Gauge' }, { id: 'trend', name: 'Trend test' },
  { id: 'bar', name: 'Bars (horizontal)' }, { id: 'column', name: 'Columns' }, { id: 'line', name: 'Line' }, { id: 'area', name: 'Area' },
  { id: 'hist', name: 'Histogram' }, { id: 'scatter', name: 'Scatter' }, { id: 'heatmap', name: 'Heatmap', needs: 'two group-bys' },
  { id: 'table', name: 'Table' }, { id: 'sparktable', name: 'Trend table', needs: 'a group-by' }, { id: 'card', name: 'Comparison card' },
  { id: 'profile', name: 'Player card (baseline, consistency, peak, trend)' }, { id: 'ribbon', name: 'Ribbon (rolling baseline and spread)' },
  { id: 'distribution', name: 'Distribution vs a population', needs: 'one group-by (the bins) and a reference dataset' },
  { id: 'flow', name: 'Flow (where each group went)', needs: 'two group-bys: where rows started and where they ended up' },
];

export function Viz(props: { v: Visualization; res: Result; cat: Catalog }) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [w, setW] = React.useState(460);
  React.useLayoutEffect(() => {
    const el = ref.current; if (!el) return;
    setW(el.clientWidth || 460);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(e => { const x = Math.round(e[0].contentRect.width); if (x > 0) setW(x); });
    ro.observe(el); return () => ro.disconnect();
  }, []);
  return <div ref={ref} className="vizwrap"><WidthCtx.Provider value={Math.max(300, Math.min(w, 1600))}><VizInner {...props} /></WidthCtx.Provider></div>;
}

function VizInner({ v, res, cat }: { v: Visualization; res: Result; cat: Catalog }) {
  if (!cat.tables[res.datasetId]) return <Empty msg="This dataset has not loaded." />;
  if (!res.n && v.type !== 'table') return <Empty />;
  switch (v.type) {
    case 'kpi': return <KPI res={res} />;
    case 'gauge': return <Gauge v={v} res={res} />;
    case 'bar': return <Bars v={v} res={res} />;
    case 'column': return <Columns v={v} res={res} />;
    case 'line': return <Lines v={v} res={res} cat={cat} area={false} />;
    case 'area': return <Lines v={v} res={res} cat={cat} area />;
    case 'hist': return <Hist v={v} res={res} />;
    case 'scatter': return <Scatter v={v} res={res} cat={cat} />;
    case 'heatmap': return <Heat res={res} />;
    case 'table': return <ResultTable res={res} cat={cat} />;
    case 'sparktable': return <SparkTable v={v} res={res} cat={cat} />;
    case 'trend': return <Trend v={v} res={res} cat={cat} />;
    case 'card': return <Card v={v} res={res} cat={cat} />;
    case 'profile': return <ProfileCard v={v} res={res} cat={cat} />;
    case 'ribbon': return <Ribbon v={v} res={res} cat={cat} />;
    case 'distribution': return <Distribution v={v} res={res} cat={cat} />;
    case 'flow': return <Flow v={v} res={res} cat={cat} />;
  }
  return <Empty msg={`Unknown visualization ${v.type}`} />;
}

/** A default visualization for a query being edited. */
export function autoType(res: Result): Visualization['type'] {
  const q = res.query;
  if (q.groupBy.length > 1) return q.groupBy.some(g => g.grain && g.grain !== 'none') ? 'heatmap' : 'table';
  if (q.groupBy.length === 1) return q.groupBy[0].grain && q.groupBy[0].grain !== 'none' ? 'column' : 'bar';
  if (q.series && q.series.op !== 'none') return 'line';
  return 'kpi';
}
