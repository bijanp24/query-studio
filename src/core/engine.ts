// The local query engine: runs a Query against built datasets in memory. Every step has a SQL
// twin in sql.ts (compileQuery), and test/parity.mjs checks both give the same numbers in DuckDB.
//
// Logical order, same as SQL:
//   FROM dataset → WHERE (query + dashboard filters) → last N by sequence
//   → per-row measure parts (value, weight, denominator)
//   → GROUP BY up to two dimensions (time grains allowed) → aggregate → HAVING / min rows
//   → ORDER BY → top N (per first dimension when there are two) → ROLLUP subtotals
//   → series operator along the sequence (window functions) → comparison value
import type { Agg, Compare, Dashboard, Field, Filter, Query, Row, Table, TimeGrain, Value, Workspace } from './types';
import { compile, evaluate, toNum, toTime, type Node } from './expr';
import { fieldExpr, fieldsFor, missingColumns, resolveMeasure, type ResolvedMeasure } from './semantic';
import { ols, quantile } from './stats';

export interface Group { keys: Value[]; n: number; values: (number | null)[]; rows: Row[]; compare?: number | null; total?: 'subtotal' | 'grand' }
export interface SeriesPoint { v: number; row: Row; i: number }
export interface CompareResult { value: number; label: string; n?: number; detail?: string }
export interface Result {
  query: Query;
  datasetId: string;
  grain: string;
  rows: Row[];
  n: number;
  measures: ResolvedMeasure[];
  value: number | null;
  values: (number | null)[];
  /** Same measures without weights, shown beside weighted results so a weighting never hides. */
  unweighted?: (number | null)[];
  groups?: Group[];
  totals?: Group[];
  series?: SeriesPoint[];
  compare?: CompareResult | null;
  warnings: string[];
}

export interface Catalog { ws: Workspace; tables: Record<string, Table | undefined> }

// ---------- filters ----------
export function matchFilter(v: Value, f: Filter): boolean {
  if (f.op === 'is_null') return v == null;
  if (f.op === 'not_null') return v != null;
  if (v == null) return false;
  const val = f.value;
  switch (f.op) {
    case '=': return typeof v === 'number' ? v === Number(val) : String(v) === val;
    case '!=': return typeof v === 'number' ? v !== Number(val) : String(v) !== val;
    case '>': case '<': case '>=': case '<=': {
      const a = typeof v === 'number' ? v : NaN, b = Number(val);
      const [x, y] = isNaN(a) || isNaN(b) ? [String(v), val] as const : [a, b] as const;
      return f.op === '>' ? x > y : f.op === '<' ? x < y : f.op === '>=' ? x >= y : x <= y;
    }
    case 'in': { const set = val.split(',').map(s => s.trim()); return typeof v === 'number' ? set.map(Number).includes(v) : set.includes(String(v)); }
    case 'contains': return String(v).toLowerCase().includes(val.toLowerCase());
  }
  return true;
}
export const filterActive = (f: Filter) => !!f.field && (f.op === 'is_null' || f.op === 'not_null' || (f.value != null && f.value !== ''));
export function matchFilters(r: Row, filters: Filter[], exprOf?: (field: string) => Node): boolean {
  for (const f of filters) {
    if (!filterActive(f)) continue;
    const v = exprOf ? evaluate(exprOf(f.field), r) : (r[f.field] ?? null);
    if (!matchFilter(v, f)) return false;
  }
  return true;
}

// ---------- aggregation ----------
/** One row's contribution to a measure. */
export interface Part { x: Value; w: number | null; d: number | null }

export function aggregate(vals: Value[], agg: Agg, rowCount?: number): number | null {
  return aggregateParts(vals.map(x => ({ x, w: null, d: null })), agg, false, rowCount);
}

/**
 * NULL rules follow SQL: COUNT(*) counts rows, every other aggregate skips NULL values.
 * Weighted: avg = Σ(x·w)/Σw and sum = Σ(x·w) over rows where x and w are both present;
 * count = Σw; median = weighted median. Ratio = Σx/Σd over rows where both are present.
 */
export function aggregateParts(parts: Part[], agg: Agg, weighted: boolean, rowCount?: number): number | null {
  if (agg === 'count') {
    if (!weighted) return rowCount ?? parts.length;
    let s = 0; for (const p of parts) if (p.w != null) s += p.w; return s;
  }
  if (agg === 'count_distinct') return new Set(parts.filter(p => p.x != null).map(p => String(p.x))).size;
  if (agg === 'ratio') {
    let sx = 0, sd = 0, n = 0;
    for (const p of parts) { const x = toNum(p.x); if (x != null && p.d != null) { sx += x; sd += p.d; n++; } }
    return n && sd !== 0 ? sx / sd : null;
  }
  if (agg === 'mode') {
    // Most common value, counted with weight when there is one; ties go to the smallest value.
    const c = new Map<number, number>();
    for (const p of parts) { const x = toNum(p.x), w = weighted ? p.w : 1; if (x != null && w != null) c.set(x, (c.get(x) || 0) + w); }
    let best: number | null = null, bc = -Infinity;
    for (const [x, n] of c) if (n > bc || (n === bc && x < best!)) { best = x; bc = n; }
    return best;
  }
  if (weighted && (agg === 'avg' || agg === 'rate' || agg === 'sum' || agg === 'median')) {
    const xs: [number, number][] = [];
    for (const p of parts) { const x = toNum(p.x); if (x != null && p.w != null) xs.push([x, p.w]); }
    if (!xs.length) return null;
    if (agg === 'sum') return xs.reduce((s, [x, w]) => s + x * w, 0);
    const sw = xs.reduce((s, [, w]) => s + w, 0);
    if (agg === 'median') {
      if (!(sw > 0)) return null;
      xs.sort((a, b) => a[0] - b[0]);
      let c = 0; for (const [x, w] of xs) { c += w; if (c >= sw / 2) return x; }
      return xs[xs.length - 1][0];
    }
    return sw === 0 ? null : xs.reduce((s, [x, w]) => s + x * w, 0) / sw;
  }
  const xs: number[] = [];
  if (agg === 'count_values') { let n = 0; for (const p of parts) if (p.x != null) n++; return n; }
  for (const p of parts) { const x = toNum(p.x); if (x != null) xs.push(x); }
  if (!xs.length) return null;
  switch (agg) {
    case 'sum': return xs.reduce((a, b) => a + b, 0);
    case 'avg': case 'rate': return xs.reduce((a, b) => a + b, 0) / xs.length;
    case 'median': { const s = xs.sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
    case 'p25': return quantile(xs, 0.25);
    case 'p75': return quantile(xs, 0.75);
    case 'iqr': return quantile(xs, 0.75)! - quantile(xs, 0.25)!;
    case 'min': return Math.min(...xs);
    case 'max': return Math.max(...xs);
  }
  return null;
}

/** Compiled parts of one measure, reusable over many row sets. */
export interface MeasureFn { m: ResolvedMeasure; x: Node; w?: Node; d?: Node; parts(rows: Row[]): Part[]; value(rows: Row[]): number | null; plain(rows: Row[]): number | null }
export function measureFn(m: ResolvedMeasure): MeasureFn {
  const x = compile(m.expr);
  const w = m.weight ? compile(m.weight) : undefined;
  const d = m.denominator ? compile(m.denominator) : undefined;
  const parts = (rows: Row[]) => rows.map(r => ({ x: evaluate(x, r), w: w ? toNum(evaluate(w, r)) : null, d: d ? toNum(evaluate(d, r)) : null }));
  return {
    m, x, w, d, parts,
    value: rows => aggregateParts(parts(rows), m.agg, !!w, rows.length),
    plain: rows => aggregateParts(parts(rows), m.agg, false, rows.length),
  };
}

// ---------- time grains ----------
const pad = (n: number) => String(n).padStart(2, '0');
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const WEEKDAY_ORDER = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export function grainKey(v: Value, g: TimeGrain | undefined): Value {
  if (!g || g === 'none' || v == null) return v;
  const d = toTime(v); if (!d) return null;
  const Y = d.getUTCFullYear(), M = d.getUTCMonth() + 1;
  switch (g) {
    case 'hour': return d.getUTCHours();
    case 'day': return `${Y}-${pad(M)}-${pad(d.getUTCDate())}`;
    case 'weekday': return WD[d.getUTCDay()];
    case 'week': { const m = new Date(Date.UTC(Y, M - 1, d.getUTCDate() - ((d.getUTCDay() + 6) % 7))); return `${m.getUTCFullYear()}-${pad(m.getUTCMonth() + 1)}-${pad(m.getUTCDate())}`; }
    case 'month': return `${Y}-${pad(M)}`;
    case 'quarter': return `${Y}-Q${Math.floor((M - 1) / 3) + 1}`;
    case 'year': return Y;
  }
  return v;
}

// ---------- series (window functions over the sequence) ----------
interface Pt { p: Part; row: Row; v: number }
export function seriesOf(pts: Pt[], agg: Agg, weighted: boolean, op: string, win: number): SeriesPoint[] {
  const n = pts.length; if (!n) return [];
  const w = Math.max(2, Math.min(win, n));
  const wagg: Agg = agg === 'count' && !weighted ? 'count' : agg === 'count_distinct' || agg === 'count_values' ? 'count' : agg;
  const A = (s: Pt[]) => aggregateParts(s.map(q => q.p), wagg, weighted, s.length) ?? NaN;
  const out: SeriesPoint[] = [];
  if (op === 'cumulative') { for (let i = 0; i < n; i++) out.push({ v: A(pts.slice(0, i + 1)), row: pts[i].row, i }); return out.filter(p => Number.isFinite(p.v)); }
  const roll: number[] = [];
  for (let i = 0; i < n; i++) roll.push(i >= w - 1 ? A(pts.slice(i - w + 1, i + 1)) : NaN);
  if (op === 'rolling' || op === 'none') { for (let i = w - 1; i < n; i++) out.push({ v: roll[i], row: pts[i].row, i }); }
  else if (op === 'delta') { for (let i = 2 * w - 1; i < n; i++) out.push({ v: roll[i] - roll[i - w], row: pts[i].row, i }); }
  else if (op === 'slope') { for (let i = w - 1; i < n; i++) out.push({ v: ols(pts.slice(i - w + 1, i + 1).map(p => p.v)).slope * 10, row: pts[i].row, i }); }
  return out.filter(p => Number.isFinite(p.v));
}
/** Per-row points for a series: rows where the measure (and weight/denominator) is present. */
export function pointsOf(f: MeasureFn, rows: Row[]): Pt[] {
  const parts = f.parts(rows);
  const out: Pt[] = [];
  parts.forEach((p, i) => {
    const x = toNum(p.x); if (x == null) return;
    if (f.w && p.w == null) return;
    if (f.d && p.d == null) return;
    out.push({ p, row: rows[i], v: f.d ? (p.d ? x / p.d : NaN) : x });
  });
  return out.filter(p => Number.isFinite(p.v) || !f.d);
}

// ---------- the effective query (dashboard filters applied) ----------
export function effectiveQuery(q: Query, d: Dashboard | undefined, fields: Field[], table: Table | undefined): Query {
  if (!d || !q.followDashboard) return q;
  const have = new Set([...(table?.columns.map(c => c.name) || []), ...fields.map(f => f.id)]);
  const extra = d.filters.filter(f => filterActive(f) && have.has(f.field));
  const e: Query = { ...q, filters: [...q.filters, ...extra] };
  if (d.last != null && d.last >= 0 && !Number.isNaN(d.last)) e.last = d.last;
  return e;
}

export function datasetOf(ws: Workspace, id: string) { return ws.datasets.find(d => d.id === id); }

/** Rows of a dataset after filters and "last N", oldest first. offset skips the newest N (previous window). */
export function selectRows(cat: Catalog, q: Query, offset = 0): Row[] {
  const table = cat.tables[q.dataset]; if (!table) return [];
  const fields = fieldsFor(cat.ws, q.dataset, table);
  const exprCache = new Map<string, Node>();
  const exprOf = (name: string) => { let n = exprCache.get(name); if (!n) { n = compile(fieldExpr(name, fields)); exprCache.set(name, n); } return n; };
  let rows = table.rows.filter(r => matchFilters(r, q.filters, exprOf));
  const ds = datasetOf(cat.ws, q.dataset);
  if (q.last > 0 && ds?.sequence) {
    const end = rows.length - offset;
    rows = end <= 0 ? [] : rows.slice(Math.max(0, end - q.last), end);
  } else if (offset) rows = [];
  return rows;
}

export function resolveMeasures(cat: Catalog, q: Query, fields: Field[]) {
  return (q.measures.length ? q.measures : [{ agg: 'count' as Agg }]).map(m => resolveMeasure(m, fields, q.weight)).filter((m): m is ResolvedMeasure => !!m);
}

export function run(cat: Catalog, q0: Query, dash?: Dashboard): Result {
  const table = cat.tables[q0.dataset];
  const fields = fieldsFor(cat.ws, q0.dataset, table);
  const q = effectiveQuery(q0, dash, fields, table);
  const ds = datasetOf(cat.ws, q.dataset);
  const warnings: string[] = [];
  const measures = resolveMeasures(cat, q, fields);
  for (const m of measures) for (const e of [m.expr, m.weight, m.denominator]) if (e) { const miss = missingColumns(e, table); if (miss.length) warnings.push(`${m.label}: unknown column ${miss.join(', ')}`); }
  const rows = selectRows(cat, q);
  const res: Result = { query: q, datasetId: q.dataset, grain: ds?.grain || 'row', rows, n: rows.length, measures, value: null, values: [], warnings };
  if (!table) { warnings.push('This dataset is not loaded.'); return res; }
  const fns = measures.map(m => { try { return measureFn(m); } catch (e) { warnings.push(`${m.label}: ${(e as Error).message}`); return measureFn({ ...m, expr: 'NULL', weight: undefined, denominator: undefined }); } });
  const valuesFor = (rs: Row[]) => fns.map(f => f.value(rs));
  res.values = valuesFor(rows);
  res.value = res.values[0] ?? null;
  if (fns.some(f => f.w)) res.unweighted = fns.map(f => f.plain(rows));

  const op = q.series?.op || 'none';
  const win = q.series?.window || 10;
  const f0 = fns[0];
  if (op !== 'none' && f0) {
    res.series = seriesOf(pointsOf(f0, rows), f0.m.agg, !!f0.w, op, win);
    res.value = res.series.length ? res.series[res.series.length - 1].v : null;
  }

  if (q.groupBy.length) {
    const gExpr = q.groupBy.map(g => compile(fieldExpr(g.field, fields)));
    const keyOf = (r: Row) => q.groupBy.map((g, i) => grainKey(evaluate(gExpr[i], r), g.grain));
    const map = new Map<string, Group>();
    for (const r of rows) {
      const keys = keyOf(r);
      const id = keys.map(k => k == null ? '\u0000' : String(k)).join('\u0001');
      let g = map.get(id); if (!g) { g = { keys, n: 0, values: [], rows: [] }; map.set(id, g); }
      g.n++; g.rows.push(r);
    }
    let groups = [...map.values()];
    for (const g of groups) {
      g.values = valuesFor(g.rows);
      if (op !== 'none' && f0) { const s = seriesOf(pointsOf(f0, g.rows), f0.m.agg, !!f0.w, op, win); g.values[0] = s.length ? s[s.length - 1].v : null; }
    }
    groups = groups.filter(g => g.values[0] != null);
    if (q.minRows && q.minRows > 1) groups = groups.filter(g => g.n >= q.minRows!);
    for (const h of q.having || []) {
      groups = groups.filter(g => { const v = g.values[h.measure]; if (v == null) return false; switch (h.op) { case '>': return v > h.value; case '<': return v < h.value; case '>=': return v >= h.value; case '<=': return v <= h.value; case '=': return v === h.value; default: return v !== h.value; } });
    }
    sortGroups(groups, q, fields, table);
    if (q.limit && q.limit > 0) {
      if (q.groupBy.length > 1) {
        const per = new Map<string, number>();
        groups = groups.filter(g => { const k = String(g.keys[0]); const c = (per.get(k) || 0) + 1; per.set(k, c); return c <= q.limit!; });
      } else groups = groups.slice(0, q.limit);
    }
    res.groups = groups;
    if (q.rollup && op === 'none') {
      // Subtotals and the grand total cover every selected row, as SQL ROLLUP does, not only the shown groups.
      const totals: Group[] = [];
      if (q.groupBy.length > 1) {
        const firsts = new Map<string, { key: Value; rows: Row[] }>();
        for (const r of rows) { const key = keyOf(r)[0]; const k = key == null ? '\u0000' : String(key); let a = firsts.get(k); if (!a) firsts.set(k, a = { key, rows: [] }); a.rows.push(r); }
        firsts.forEach(({ key, rows: rs }) => totals.push({ keys: [key, null], n: rs.length, values: valuesFor(rs), rows: rs, total: 'subtotal' }));
      }
      totals.push({ keys: q.groupBy.map(() => null), n: rows.length, values: valuesFor(rows), rows, total: 'grand' });
      res.totals = totals;
    }
  }

  res.compare = op === 'none' || op === 'rolling' || q.compare.kind === 'target' ? compare(cat, q, res, fields, fns) : null;
  if (res.groups && f0 && (q.compare.kind === 'paired' || q.compare.kind === 'reference')) {
    for (const g of res.groups) g.compare = groupCompare(cat, q, g, f0, fields);
  }
  return res;
}

function sortGroups(groups: Group[], q: Query, fields: Field[], table?: Table) {
  const g0 = q.groupBy[0];
  const isTime = g0 && (g0.grain && g0.grain !== 'none');
  const isNum = g0 && table?.columns.find(c => c.name === fieldExpr(g0.field, fields))?.type === 'number';
  const sort = q.sort || (isTime || isNum ? 'key_asc' : 'count_desc');
  // A dimension with sortBy (ranks in ladder order, milestones in time order) sorts by that expression.
  const orderOf = q.groupBy.map(g => {
    const src = fields.find(f => f.id === g.field)?.sortBy;
    if (!src || (g.grain && g.grain !== 'none') || (table && missingColumns(src, table).length)) return null;
    try { const n = compile(src); const memo = new Map<Group, number | null>(); return (gr: Group) => { if (!memo.has(gr)) memo.set(gr, gr.rows[0] ? toNum(evaluate(n, gr.rows[0])) : null); return memo.get(gr)!; }; } catch { return null; }
  });
  const keyCmp = (a: Group, b: Group, from = 0) => {
    for (let i = from; i < a.keys.length; i++) {
      const x = a.keys[i], y = b.keys[i];
      if (q.groupBy[i]?.grain === 'weekday') { const d = WEEKDAY_ORDER.indexOf(String(x)) - WEEKDAY_ORDER.indexOf(String(y)); if (d) return d; continue; }
      const o = orderOf[i];
      if (o && x !== y && a.total == null && b.total == null) { const ox = o(a), oy = o(b); if (ox != null && oy != null && ox !== oy) return ox - oy; }
      if (x === y) continue; if (x == null) return 1; if (y == null) return -1;
      if (typeof x === 'number' && typeof y === 'number') return x - y;
      return String(x) < String(y) ? -1 : 1;
    }
    return 0;
  };
  const by = (a: Group, b: Group) => {
    switch (sort) {
      case 'value_desc': return (b.values[0] ?? -Infinity) - (a.values[0] ?? -Infinity) || keyCmp(a, b);
      case 'value_asc': return (a.values[0] ?? Infinity) - (b.values[0] ?? Infinity) || keyCmp(a, b);
      case 'count_desc': return b.n - a.n || keyCmp(a, b);
      default: return keyCmp(a, b);
    }
  };
  // With two dimensions and a top-N, rank the second dimension within each first one.
  if (q.groupBy.length > 1 && q.limit) groups.sort((a, b) => keyCmp({ ...a, keys: [a.keys[0]] }, { ...b, keys: [b.keys[0]] }) || by(a, b));
  else groups.sort(by);
}

// ---------- comparisons ----------
export function compareLabel(c: Compare, ws: Workspace, q: Query): string {
  switch (c.kind) {
    case 'previous': return `previous ${q.last} ${datasetOf(ws, q.dataset)?.grain || 'row'}s`;
    case 'target': return c.label || 'target';
    case 'paired': return c.label || (c.field || c.expr || 'paired column');
    case 'reference': { const d = datasetOf(ws, c.dataset); return c.label || `${d?.name || c.dataset}${c.weightBy?.length ? `, same ${c.weightBy.join(' and ')}` : ''}`; }
  }
  return '';
}

function pairedFn(c: Extract<Compare, { kind: 'paired' }>, f0: MeasureFn, fields: Field[], table?: Table): MeasureFn | null {
  const e = c.expr && c.expr.trim() ? c.expr.trim() : c.field ? fieldExpr(c.field, fields) : null;
  if (!e || missingColumns(e, table).length) return null;
  return measureFn({ ...f0.m, expr: e, agg: f0.m.agg === 'count' ? 'sum' : f0.m.agg });
}

function compare(cat: Catalog, q: Query, res: Result, fields: Field[], fns: MeasureFn[]): CompareResult | null {
  const c = q.compare; const f0 = fns[0];
  if (!c || c.kind === 'none' || !f0) return null;
  const label = compareLabel(c, cat.ws, q);
  if (c.kind === 'target') return Number.isFinite(c.value) ? { value: c.value, label } : null;
  if (c.kind === 'previous') {
    if (!(q.last > 0)) { res.warnings.push('"Previous" needs a last-N window.'); return null; }
    const prev = selectRows(cat, q, q.last);
    if (!prev.length) return null;
    const v = f0.value(prev);
    return v == null ? null : { value: v, label: `previous ${prev.length} ${res.grain}s`, n: prev.length };
  }
  if (c.kind === 'paired') {
    const pf = pairedFn(c, f0, fields, cat.tables[q.dataset]);
    if (!pf) { res.warnings.push('Compare: the paired column is missing.'); return null; }
    const v = pf.value(res.rows);
    return v == null ? null : { value: v, label };
  }
  if (c.kind === 'reference') return reference(cat, c, f0.m, res.rows, label, res.warnings);
  return null;
}

/**
 * The same measure over a reference dataset (a population), weighted by this result's mix of the
 * weightBy columns so the comparison is like for like. Row weights of the query are not applied
 * to the population; the population is what it is.
 */
export function reference(cat: Catalog, c: Extract<Compare, { kind: 'reference' }>, m: ResolvedMeasure, rows: Row[], label: string, warnings?: string[], extraFilters: Filter[] = []): CompareResult | null {
  const rt = cat.tables[c.dataset];
  if (!rt) { warnings?.push(`Reference dataset ${c.dataset} is not loaded.`); return null; }
  const rfields = fieldsFor(cat.ws, c.dataset, rt);
  const miss = [m.expr, m.denominator].filter(Boolean).flatMap(e => missingColumns(e!, rt));
  if (miss.length) { warnings?.push(`The reference dataset has no ${miss.join(', ')}, so there is no reference value.`); return null; }
  const exprOf = (name: string) => compile(fieldExpr(name, rfields));
  const pool = rt.rows.filter(r => matchFilters(r, [...(c.filters || []), ...extraFilters], exprOf));
  const f = measureFn({ ...m, weight: undefined, agg: m.agg === 'count' || m.agg === 'count_values' ? 'avg' : m.agg });
  const weight = (c.weightBy || []).filter(Boolean);
  if (!weight.length) {
    const v = f.value(pool);
    return v == null ? null : { value: v, label, n: pool.length };
  }
  const keyIn = (r: Row) => weight.map(w => String(r[w] ?? '')).join('\u0001');
  const mix = new Map<string, number>();
  for (const r of rows) { const k = keyIn(r); mix.set(k, (mix.get(k) || 0) + 1); }
  const buckets = new Map<string, Row[]>();
  for (const r of pool) { const k = keyIn(r); if (mix.has(k)) { let b = buckets.get(k); if (!b) buckets.set(k, b = []); b.push(r); } }
  let wsum = 0, vsum = 0, used = 0;
  mix.forEach((w, k) => {
    const b = buckets.get(k); if (!b || !b.length) return;
    const v = f.value(b); if (v == null) return;
    wsum += w; vsum += v * w; used += b.length;
  });
  if (!wsum) return null;
  return { value: vsum / wsum, label, n: used, detail: `weighted by the ${weight.join(' × ')} mix of these ${rows.length} rows` };
}

function groupCompare(cat: Catalog, q: Query, g: Group, f0: MeasureFn, fields: Field[]): number | null {
  const c = q.compare;
  if (c.kind === 'paired') { const pf = pairedFn(c, f0, fields, cat.tables[q.dataset]); return pf ? pf.value(g.rows) : null; }
  if (c.kind === 'reference') {
    const rt = cat.tables[c.dataset]; if (!rt) return null;
    // Narrow the reference to this group when the reference has the same column (the same champion, the same crop).
    const extra: Filter[] = [];
    q.groupBy.forEach((gb, i) => {
      if ((gb.grain && gb.grain !== 'none') || g.keys[i] == null) return;
      if (rt.columns.some(col => col.name === gb.field)) extra.push({ field: gb.field, op: '=', value: String(g.keys[i]) });
    });
    return reference(cat, c, f0.m, g.rows, '', undefined, extra)?.value ?? null;
  }
  return null;
}

// ---------- formatting ----------
export function fmt(v: number | null | undefined, format?: string, signed = false): string {
  if (v == null || !Number.isFinite(v)) return '—';
  const s = signed && v > 0 ? '+' : '';
  if (format === 'percent') return s + (v * 100).toFixed(1) + '%';
  if (format === 'integer') return s + Math.round(v).toLocaleString('en-US');
  if (format === 'decimal1') return s + v.toFixed(1);
  if (format === 'decimal2') return s + v.toFixed(2);
  const a = Math.abs(v);
  return s + (a >= 10000 ? Math.round(v).toLocaleString('en-US') : a >= 100 ? v.toFixed(0) : a >= 10 ? v.toFixed(1) : v.toFixed(2));
}
