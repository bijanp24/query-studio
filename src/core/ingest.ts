// Builds the processed layer: each Dataset from its feeds (in priority order), lookups and derived
// columns. The in-browser build mirrors compileDatasetSQL() in sql.ts, which emits the same steps
// for a warehouse.
import type { Column, ColumnType, Dataset, DerivedColumn, Row, Table, Workspace } from './types';
import { columnsOf, compile, evaluate, toNum } from './expr';
import type { Value } from './types';
import { matchFilters } from './engine';

export interface FeedStats { itemId: string; priority: number; rowsIn: number; rowsKept: number; rowsReplaced: number; cellsFilled: number; missing?: boolean; skipped?: boolean }
export interface BuiltDataset { table: Table; feeds: FeedStats[]; errors: string[]; builtAt: string }

const keyOf = (r: Row, key: string[]) => key.map(k => r[k] == null ? '\u0000' : String(r[k])).join('\u0001');

export function buildDataset(ds: Dataset, items: Record<string, Table | undefined>, built: Record<string, BuiltDataset>): BuiltDataset {
  const errors: string[] = [];
  const feeds = [...ds.feeds].sort((a, b) => a.priority - b.priority);
  const colTypes = new Map<string, ColumnType>();
  const stats: FeedStats[] = [];
  const key = ds.key && ds.key.length ? ds.key : null;
  const out: Row[] = [];
  const index = new Map<string, number>();
  for (const f of feeds) {
    const t = items[f.itemId];
    const st: FeedStats = { itemId: f.itemId, priority: f.priority, rowsIn: 0, rowsKept: 0, rowsReplaced: 0, cellsFilled: 0 };
    stats.push(st);
    if (!t) { st.missing = true; continue; }
    if (f.fallback && stats.some(x => x !== st && !x.missing && x.priority < f.priority)) { st.skipped = true; continue; }
    const ren = f.rename || {};
    for (const c of t.columns) { const n = ren[c.name] || c.name; if (!colTypes.has(n)) colTypes.set(n, c.type); }
    let rows = t.rows;
    if (f.filters && f.filters.length) rows = rows.filter(r => matchFilters(r, f.filters!));
    for (const src of rows) {
      st.rowsIn++;
      const r: Row = {};
      for (const k in src) r[ren[k] || k] = src[k];
      if (!key) { out.push(r); st.rowsKept++; continue; }
      const k = keyOf(r, key);
      const at = index.get(k);
      if (at == null) { index.set(k, out.length); out.push(r); st.rowsKept++; continue; }
      // A higher-priority feed already supplied this key.
      st.rowsReplaced++;
      if (ds.mode === 'coalesce') {
        const keep = out[at];
        for (const c in r) if ((keep[c] == null) && r[c] != null) { keep[c] = r[c]; st.cellsFilled++; }
      }
    }
  }
  // Window columns need the rows in sequence order first.
  const seqCol = ds.sequence && colTypes.has(ds.sequence) ? ds.sequence : null;
  // Sequence, then the key columns, so ties sort the same way here and in SQL (nulls first).
  const order = seqCol ? [seqCol, ...(key || []).filter(k => k !== seqCol)] : [];
  const bySeq = (a: Row, b: Row) => {
    for (const c of order) {
      const x = a[c], y = b[c];
      if (x === y) continue; if (x == null) return -1; if (y == null) return 1;
      if (typeof x === 'number' && typeof y === 'number') return x - y;
      const sx = String(x), sy = String(y); if (sx !== sy) return sx < sy ? -1 : 1;
    }
    return 0;
  };
  if (seqCol) out.sort(bySeq);
  const derive = (list: DerivedColumn[]) => { for (const d of list) {
    try {
      const n = compile(d.expr || '1');
      const missing = [...columnsOf(n), ...(d.window?.partitionBy || [])].filter(c => !colTypes.has(c));
      if (missing.length) { errors.push(`Derived column "${d.name}" uses unknown column ${missing.join(', ')}.`); continue; }
      let numeric = true, any = false;
      if (d.window) {
        if (!seqCol) { errors.push(`Window column "${d.name}" needs the dataset's sequence column.`); continue; }
        const part = d.window.partitionBy || [];
        const state = new Map<string, { n: number; sum: number; cnt: number; prev: Value }>();
        for (const r of out) {
          const k = part.map(c => r[c] == null ? '\u0000' : String(r[c])).join('\u0001');
          let st = state.get(k); if (!st) state.set(k, st = { n: 0, sum: 0, cnt: 0, prev: null });
          const v = d.window.fn === 'row_number' ? null : evaluate(n, r);
          st.n++;
          let outV: Value;
          if (d.window.fn === 'row_number') outV = st.n;
          else if (d.window.fn === 'lag') { outV = st.prev; st.prev = v; }
          else { const x = toNum(v); if (x != null) { st.sum += x; st.cnt++; } outV = d.window.fn === 'running_sum' ? (st.cnt ? st.sum : null) : (st.cnt ? st.sum / st.cnt : null); }
          r[d.name] = outV;
          if (outV != null) { any = true; if (typeof outV !== 'number') numeric = false; }
        }
      } else {
        for (const r of out) { const v = evaluate(n, r); r[d.name] = v; if (v != null) { any = true; if (typeof v !== 'number') numeric = false; } }
      }
      colTypes.set(d.name, any && numeric ? 'number' : 'string');
    } catch (e) { errors.push(`Derived column "${d.name}": ${(e as Error).message}`); }
  }
  };
  derive((ds.derived || []).filter(d => d.early));
  // Lookups: left join columns from another item or an already built dataset.
  for (const lk of ds.lookups || []) {
    const src = built[lk.from]?.table || items[lk.from];
    if (!src) { errors.push(`Lookup source "${lk.from}" is not loaded.`); continue; }
    const idx = new Map<string, Row>();
    for (const r of src.rows) idx.set(lk.on.map(([, b]) => r[b] == null ? '\u0000' : String(r[b])).join('\u0001'), r);
    const pre = lk.prefix || '';
    for (const c of lk.columns) { const sc = src.columns.find(x => x.name === c); colTypes.set(pre + c, sc ? sc.type : 'string'); }
    for (const r of out) {
      const m = idx.get(lk.on.map(([a]) => r[a] == null ? '\u0000' : String(r[a])).join('\u0001'));
      for (const c of lk.columns) if (!(pre + c in r) || r[pre + c] == null) r[pre + c] = m ? (m[c] ?? null) : null;
    }
  }
  // Derived columns, in order, so a later one can use an earlier one.
  derive((ds.derived || []).filter(d => !d.early));
  const columns: Column[] = [...colTypes].map(([name, type]) => ({ name, type }));
  for (const r of out) for (const c of columns) if (r[c.name] === undefined) r[c.name] = null;
  return { table: { columns, rows: out }, feeds: stats, errors, builtAt: new Date().toISOString() };
}

/** Datasets in dependency order (a dataset used as another's lookup builds first). */
export function buildOrder(ws: Workspace): Dataset[] {
  const ids = new Set(ws.datasets.map(d => d.id));
  const done = new Set<string>(); const order: Dataset[] = [];
  const visit = (d: Dataset, stack: Set<string>) => {
    if (done.has(d.id) || stack.has(d.id)) return;
    stack.add(d.id);
    for (const lk of d.lookups || []) if (ids.has(lk.from)) visit(ws.datasets.find(x => x.id === lk.from)!, stack);
    done.add(d.id); order.push(d);
  };
  ws.datasets.forEach(d => visit(d, new Set()));
  return order;
}

export function buildAll(ws: Workspace, items: Record<string, Table | undefined>): Record<string, BuiltDataset> {
  const built: Record<string, BuiltDataset> = {};
  for (const ds of buildOrder(ws)) built[ds.id] = buildDataset(ds, items, built);
  return built;
}
