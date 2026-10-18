// Compiles the stored objects to SQL. The browser runs queries with the local engine (engine.ts);
// a warehouse runs exactly these statements instead. The output is checked against the local engine
// in DuckDB by test/parity.mjs. Dialect differences live in this file only.
import type { Agg, Dashboard, Dataset, Filter, Query, Table, TimeGrain, Workspace } from './types';
import { quoteIdent as qi, srcToSQL } from './expr';
import { fieldExpr, fieldsFor, fieldType, resolveMeasure, type ResolvedMeasure } from './semantic';
import { effectiveQuery } from './engine';

export type Dialect = 'duckdb' | 'postgres' | 'redshift' | 'bigquery';
export const DIALECTS: { id: Dialect; name: string }[] = [
  { id: 'duckdb', name: 'DuckDB / MotherDuck' }, { id: 'postgres', name: 'PostgreSQL' },
  { id: 'redshift', name: 'Amazon Redshift' }, { id: 'bigquery', name: 'BigQuery' },
];

export const tableName = (id: string) => qi(id.replace(/[^A-Za-z0-9_]/g, '_').toLowerCase());
const str = (s: string) => "'" + s.replace(/'/g, "''") + "'";
const isNumLit = (s: string) => /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s.trim());
const textType = (d: Dialect) => d === 'bigquery' ? 'STRING' : 'VARCHAR';

function aggSQL(agg: Agg, e: string, d: Dialect): string {
  switch (agg) {
    case 'sum': return `SUM(${e})`;
    case 'avg': case 'rate': return `AVG(${e})`;
    case 'median': return d === 'duckdb' || d === 'redshift' ? `MEDIAN(${e})` : d === 'bigquery' ? `APPROX_QUANTILES(${e}, 2)[OFFSET(1)]` : `PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ${e})`;
    case 'p25': case 'p75': {
      const p = agg === 'p25' ? 0.25 : 0.75;
      return d === 'duckdb' ? `QUANTILE_CONT(${e}, ${p})` : d === 'bigquery' ? `APPROX_QUANTILES(${e}, 4)[OFFSET(${agg === 'p25' ? 1 : 3})]` : `PERCENTILE_CONT(${p}) WITHIN GROUP (ORDER BY ${e})`;
    }
    case 'iqr': return `(${aggSQL('p75', e, d)} - ${aggSQL('p25', e, d)})`;
    case 'min': return `MIN(${e})`;
    case 'max': return `MAX(${e})`;
    case 'count': return 'COUNT(*)';
    case 'count_values': return `COUNT(${e})`;
    case 'count_distinct': return `COUNT(DISTINCT ${e})`;
    case 'ratio': return `SUM(${e})`;
  }
}

/** A measure as SQL: weighted aggregates and ratios are computed from additive parts, NULLs dropped from both sides. */
interface SqlMeasure { agg: Agg; x: string; w?: string; d?: string }
function measureSQL(m: SqlMeasure, d: Dialect, notes?: string[]): string {
  const { x, w } = m;
  if (m.agg === 'ratio') {
    const den = m.d || '1';
    return `SUM(CASE WHEN ${den} IS NOT NULL THEN ${x} END) / NULLIF(SUM(CASE WHEN ${x} IS NOT NULL THEN ${den} END), 0)`;
  }
  if (w) {
    switch (m.agg) {
      case 'avg': case 'rate': return `SUM(${x} * ${w}) / NULLIF(SUM(CASE WHEN ${x} IS NOT NULL THEN ${w} END), 0)`;
      case 'sum': return `SUM(${x} * ${w})`;
      case 'count': return `SUM(${w})`;
      case 'median': notes?.push('Weighted median has no portable SQL form; the SQL shows the unweighted median.'); break;
    }
  }
  return aggSQL(m.agg, x, d);
}

function grainSQL(e: string, g: TimeGrain | undefined, d: Dialect) {
  if (!g || g === 'none') return e;
  const ts = d === 'bigquery' ? `TIMESTAMP(${e})` : `CAST(${e} AS TIMESTAMP)`;
  const f = (duck: string, pg: string, bq: string) => d === 'duckdb' ? `STRFTIME(${ts}, '${duck}')` : d === 'bigquery' ? `FORMAT_TIMESTAMP('${bq}', ${ts})` : `TO_CHAR(${ts}, '${pg}')`;
  switch (g) {
    case 'hour': return `EXTRACT(HOUR FROM ${ts})`;
    case 'day': return f('%Y-%m-%d', 'YYYY-MM-DD', '%Y-%m-%d');
    case 'weekday': return f('%a', 'Dy', '%a');
    case 'week': return d === 'bigquery' ? `FORMAT_TIMESTAMP('%Y-%m-%d', TIMESTAMP_TRUNC(${ts}, ISOWEEK))` : d === 'duckdb' ? `STRFTIME(DATE_TRUNC('week', ${ts}), '%Y-%m-%d')` : `TO_CHAR(DATE_TRUNC('week', ${ts}), 'YYYY-MM-DD')`;
    case 'month': return f('%Y-%m', 'YYYY-MM', '%Y-%m');
    case 'quarter': return d === 'duckdb' ? `STRFTIME(${ts}, '%Y') || '-Q' || CAST(EXTRACT(QUARTER FROM ${ts}) AS VARCHAR)` : d === 'bigquery' ? `FORMAT_TIMESTAMP('%Y-Q%Q', ${ts})` : `TO_CHAR(${ts}, 'YYYY-"Q"Q')`;
    case 'year': return `EXTRACT(YEAR FROM ${ts})`;
  }
  return e;
}

export function filterSQL(f: Filter, e: string, numeric: boolean, d: Dialect): string | null {
  if (!f.field) return null;
  if (f.op === 'is_null') return `${e} IS NULL`;
  if (f.op === 'not_null') return `${e} IS NOT NULL`;
  if (f.value == null || f.value === '') return null;
  const lit = (v: string) => numeric && isNumLit(v) ? v.trim() : str(v);
  switch (f.op) {
    case 'in': return `${e} IN (${f.value.split(',').map(s => lit(s.trim())).join(', ')})`;
    case 'contains': return `LOWER(CAST(${e} AS ${textType(d)})) LIKE ${str('%' + f.value.toLowerCase() + '%')}`;
    case '!=': return `${e} <> ${lit(f.value)}`;
    default: return `${e} ${f.op} ${lit(f.value)}`;
  }
}

function whereSQL(filters: Filter[], ws: Workspace, datasetId: string, table: Table | undefined, d: Dialect) {
  const fields = fieldsFor(ws, datasetId, table);
  const parts = filters.map(f => {
    try { return filterSQL(f, srcToSQL(fieldExpr(f.field, fields), d), fieldType(f.field, fields, table) === 'number', d); } catch { return null; }
  }).filter(Boolean);
  return parts.length ? `WHERE ${parts.join('\n    AND ')}` : '';
}

export interface CompiledQuery { main: string; compare?: string; totals?: string; notes: string[] }

export function compileQuery(ws: Workspace, tables: Record<string, Table | undefined>, q0: Query, dash: Dashboard | undefined, d: Dialect): CompiledQuery {
  const table = tables[q0.dataset];
  const fields = fieldsFor(ws, q0.dataset, table);
  const q = effectiveQuery(q0, dash, fields, table);
  const ds = ws.datasets.find(x => x.id === q.dataset);
  const notes: string[] = [];
  const seq = ds?.sequence ? qi(ds.sequence) : null;
  // Rows are ordered by the sequence, then the key, nulls first: the same order the local build uses.
  const ordCols = ds?.sequence ? [ds.sequence, ...(ds.key || []).filter(k => k !== ds.sequence)].map(qi) : [];
  const ordAsc = ordCols.map(c => `${c} ASC NULLS FIRST`).join(', ');
  const ordDesc = ordCols.map(c => `${c} DESC NULLS LAST`).join(', ');
  const measures = (q.measures.length ? q.measures : [{ agg: 'count' as Agg }]).map(m => resolveMeasure(m, fields, q.weight)).filter((m): m is ResolvedMeasure => !!m);
  const ms = measures.map(m => ({ ...m, sql: srcToSQL(m.expr, d), wsql: m.weight ? srcToSQL(m.weight, d) : undefined, dsql: m.denominator ? srcToSQL(m.denominator, d) : undefined }));
  const M = (m: typeof ms[number], agg = m.agg) => measureSQL({ agg, x: m.sql, w: m.wsql, d: m.dsql }, d, notes);
  if (ms.some(m => m.wsql)) notes.push(`Rows are weighted by ${ms.find(m => m.wsql)!.weight}.`);
  const where = whereSQL(q.filters, ws, q.dataset, table, d);
  const base = (offset: number) => {
    let s = `  SELECT *\n  FROM ${tableName(q.dataset)}${where ? '\n  ' + where : ''}`;
    if (q.last > 0 && seq) s += `\n  ORDER BY ${ordDesc}\n  LIMIT ${q.last}${offset ? ` OFFSET ${offset}` : ''}`;
    return s;
  };
  if (q.last > 0 && !seq) notes.push('This dataset has no sequence column, so "last N" is ignored.');
  const op = q.series?.op || 'none';
  const win = Math.max(2, q.series?.window || 10);
  let main: string;
  const head = `WITH base AS (\n${base(0)}\n)`;

  const dimSQL = q.groupBy.map((g, k) => `${grainSQL(srcToSQL(fieldExpr(g.field, fields), d), g.grain, d)} AS d${k + 1}`);
  const dimKeys = q.groupBy.map((_, k) => `d${k + 1}`);
  let totals: string | undefined;

  if (op !== 'none' && seq && ms[0]) {
    const m = ms[0];
    const part = dimKeys.length ? `PARTITION BY ${dimKeys.join(', ')} ` : '';
    const over = (rows: string) => `OVER (${part}ORDER BY i ROWS BETWEEN ${rows} AND CURRENT ROW)`;
    const conds = [`${m.sql} IS NOT NULL`, ...(m.wsql ? [`${m.wsql} IS NOT NULL`] : []), ...(m.dsql ? [`${m.dsql} IS NOT NULL`, `${m.dsql} <> 0`] : [])];
    // Dimensions are named in their own step so the window clauses can partition by them on every warehouse.
    const pts0 = `pts0 AS (\n  SELECT base.*${dimSQL.length ? ', ' + dimSQL.join(', ') : ''}\n  FROM base\n  WHERE ${conds.join(' AND ')}\n)`;
    const pts = `pts AS (\n  SELECT ${dimKeys.length ? dimKeys.join(', ') + ', ' : ''}${seq} AS t, ${m.sql} AS x${m.wsql ? `, ${m.wsql} AS w` : ''}${m.dsql ? `, ${m.dsql} AS den` : ''},\n         ${m.dsql ? `CAST(${m.sql} AS DOUBLE PRECISION) / ${m.dsql}` : m.sql} AS y,\n         ROW_NUMBER() OVER (${part}ORDER BY ${ordAsc}) AS i,\n         COUNT(*) OVER (${part.trim()}) AS cnt\n  FROM pts0\n)`;
    // The window aggregate, built from the same additive parts as the plain measure.
    const A = (rows: string) => {
      const o = over(rows);
      if (m.agg === 'ratio') return `SUM(x) ${o} / NULLIF(SUM(den) ${o}, 0)`;
      if (m.wsql && (m.agg === 'avg' || m.agg === 'rate')) return `SUM(x * w) ${o} / NULLIF(SUM(w) ${o}, 0)`;
      if (m.wsql && m.agg === 'sum') return `SUM(x * w) ${o}`;
      if (m.wsql && m.agg === 'count') return `SUM(w) ${o}`;
      const agg: Agg = m.agg === 'count_distinct' || m.agg === 'count_values' ? 'count' : m.agg;
      return `${aggSQL(agg, 'x', d)} ${o}`;
    };
    // A window longer than the group shrinks to the group (at least 2 rows), as in the local engine.
    const full = `GREATEST(2, LEAST(${win}, cnt))`;
    let calc: string, keep: string, post = 'value';
    if (op === 'cumulative') { calc = `${A('UNBOUNDED PRECEDING')} AS value`; keep = 'TRUE'; }
    else if (op === 'rolling') { calc = `${A(`${win - 1} PRECEDING`)} AS value`; keep = `i >= ${full}`; }
    else if (op === 'delta') { calc = `${A(`${win - 1} PRECEDING`)} AS r`; post = `r - LAG(r, ${win}) OVER (${part}ORDER BY i) AS value`; keep = `i >= ${2 * win}`; }
    else {
      // Least-squares slope over the window from running sums; portable to warehouses without REGR_SLOPE.
      const o = over(`${win - 1} PRECEDING`);
      const S = (x: string) => `SUM(${x}) ${o}`;
      calc = `(COUNT(*) ${o} * ${S('i * y')} - ${S('i')} * ${S('y')}) / NULLIF(COUNT(*) ${o} * ${S('i * i')} - ${S('i')} * ${S('i')}, 0) * 10 AS value`;
      keep = `i >= ${full}`;
    }
    const dk = dimKeys.length ? dimKeys.join(', ') + ', ' : '';
    const s = `s AS (\n  SELECT ${dk}t, i, cnt, ${calc}\n  FROM pts\n)${post !== 'value' ? `,\ns2 AS (\n  SELECT ${dk}t, i, cnt, ${post}\n  FROM s\n)` : ''}`;
    const last = post !== 'value' ? 's2' : 's';
    if (dimKeys.length) {
      main = `${head},\n${pts0},\n${pts},\n${s}\n-- latest value per group\nSELECT ${dimKeys.join(', ')}, value\nFROM (SELECT ${last}.*, ROW_NUMBER() OVER (PARTITION BY ${dimKeys.join(', ')} ORDER BY i DESC) AS rn FROM ${last} WHERE ${keep}) x\nWHERE rn = 1\nORDER BY ${dimKeys.join(', ')}`;
    } else {
      main = `${head},\n${pts0},\n${pts},\n${s}\nSELECT t, value\nFROM ${last}\nWHERE ${keep}\nORDER BY i`;
    }

    notes.push(`Series operator "${op}" over a ${win}-${ds?.grain || 'row'} window, ordered by ${ds?.sequence}.`);
    if (d !== 'duckdb' && ['median', 'p25', 'p75', 'iqr'].includes(m.agg)) notes.push('PostgreSQL, Redshift and BigQuery do not run percentiles as window functions; run this series on DuckDB.');
  } else if (q.groupBy.length) {
    const sel = [...dimSQL, 'COUNT(*) AS n', ...ms.map((m, k) => `${M(m)} AS m${k + 1}`)];
    const having = [`${M(ms[0])} IS NOT NULL`];
    if (q.minRows && q.minRows > 1) having.push(`COUNT(*) >= ${q.minRows}`);
    for (const h of q.having || []) if (ms[h.measure]) having.push(`${M(ms[h.measure])} ${h.op === '!=' ? '<>' : h.op} ${h.value}`);
    const g0 = q.groupBy[0];
    const isNum = g0 && table?.columns.find(cc => cc.name === fieldExpr(g0.field, fields))?.type === 'number';
    const sort = q.sort || ((g0.grain && g0.grain !== 'none') || isNum ? 'key_asc' : 'count_desc');
    // Weekdays sort Monday first, not alphabetically.
    const keys = q.groupBy.map((g, k) => g.grain === 'weekday' ? `CASE d${k + 1} ${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((w, j) => `WHEN '${w}' THEN ${j}`).join(' ')} END` : `d${k + 1}`).join(', ');
    const order = sort === 'value_desc' ? `m1 DESC, ${keys}` : sort === 'value_asc' ? `m1 ASC, ${keys}` : sort === 'count_desc' ? `n DESC, ${keys}` : keys;
    const grouped = `SELECT ${sel.join(',\n       ')}\nFROM base\nGROUP BY ${q.groupBy.map((_, k) => k + 1).join(', ')}\nHAVING ${having.join('\n   AND ')}`;
    if (q.limit && dimKeys.length > 1) {
      const rest = dimKeys.slice(1).join(', ');
      const inner = sort === 'value_desc' ? `m1 DESC, ${rest}` : sort === 'value_asc' ? `m1 ASC, ${rest}` : sort === 'count_desc' ? `n DESC, ${rest}` : rest;
      main = `${head},\ng AS (\n${grouped}\n)\n-- top ${q.limit} ${q.groupBy[1].field} within each ${q.groupBy[0].field}\nSELECT * FROM (\n  SELECT g.*, ROW_NUMBER() OVER (PARTITION BY d1 ORDER BY ${inner}) AS rn FROM g\n) t\nWHERE rn <= ${q.limit}\nORDER BY d1, rn`;
    } else main = `${head}\n${grouped}\nORDER BY ${order}${q.limit ? `\nLIMIT ${q.limit}` : ''}`;
    if (q.rollup) {
      const g1 = q.groupBy[0] ? grainSQL(srcToSQL(fieldExpr(q.groupBy[0].field, fields), d), q.groupBy[0].grain, d) : '';
      const roll = dimKeys.length > 1 ? `GROUP BY ROLLUP (${g1})` : '';
      totals = `-- subtotals${dimKeys.length > 1 ? ` per ${q.groupBy[0].field}` : ''} and the grand total, over every selected row\n${head}\nSELECT ${dimKeys.length > 1 ? dimSQL[0] + ', ' : ''}COUNT(*) AS n, ${ms.map((m, k) => `${M(m)} AS m${k + 1}`).join(', ')}\nFROM base${roll ? '\n' + roll : ''}`;
    }
  } else {
    main = `${head}\nSELECT COUNT(*) AS n,\n       ${ms.map((m, k) => `${M(m)} AS m${k + 1}`).join(',\n       ')}\nFROM base`;
  }

  let compare: string | undefined;
  const c = q.compare; const m = ms[0];
  if (m && c.kind === 'previous' && q.last > 0 && seq) {
    compare = `-- compare: the ${q.last} ${ds?.grain || 'row'}s before the last ${q.last}\nWITH prev AS (\n${base(q.last)}\n)\nSELECT ${M(m)} AS compare_value FROM prev`;
  } else if (m && c.kind === 'paired') {
    const e = c.expr && c.expr.trim() ? c.expr : c.field ? fieldExpr(c.field, fields) : null;
    if (e) compare = `-- compare: ${c.label || e}, same rows\n${head}\nSELECT ${measureSQL({ agg: m.agg === 'count' ? 'sum' : m.agg, x: srcToSQL(e, d), w: m.wsql, d: m.dsql }, d)} AS compare_value FROM base`;
  } else if (m && c.kind === 'reference') {
    const rt = tables[c.dataset];
    const rwhere = whereSQL(c.filters || [], ws, c.dataset, rt, d);
    const agg: Agg = m.agg === 'count' || m.agg === 'count_values' ? 'avg' : m.agg;
    const R = measureSQL({ agg, x: m.sql, d: m.dsql }, d);
    const w = (c.weightBy || []).filter(Boolean);
    if (!w.length) compare = `-- compare: ${c.label || c.dataset}\nSELECT ${R} AS compare_value\nFROM ${tableName(c.dataset)}${rwhere ? '\n' + rwhere : ''}`;
    else {
      const key = (alias: string, col: string) => `COALESCE(CAST(${alias}.${qi(col)} AS ${textType(d)}), '')`;
      compare = `-- compare: ${c.label || c.dataset}, weighted by this query's mix of ${w.join(', ')}\n${head},\nmix AS (\n  SELECT ${w.map(qi).join(', ')}, COUNT(*) AS w FROM base GROUP BY ${w.map((_, k) => k + 1).join(', ')}\n),\nref AS (\n  SELECT ${w.map(qi).join(', ')}, ${R} AS v\n  FROM ${tableName(c.dataset)}${rwhere ? '\n  ' + rwhere : ''}\n  GROUP BY ${w.map((_, k) => k + 1).join(', ')}\n)\nSELECT SUM(mix.w * ref.v) / SUM(mix.w) AS compare_value\nFROM mix JOIN ref ON ${w.map(col => `${key('mix', col)} = ${key('ref', col)}`).join(' AND ')}\nWHERE ref.v IS NOT NULL`;
    }
  } else if (c.kind === 'target') compare = `-- compare: fixed target\nSELECT ${c.value} AS compare_value`;
  return { main, compare, totals, notes };
}

/** The processed-layer build for one dataset, as SQL: priority merge, lookups, derived columns. */
export function compileDataset(ws: Workspace, ds: Dataset, itemTables: Record<string, Table | undefined>, builtTables: Record<string, Table | undefined>, d: Dialect): string {
  const feeds = [...ds.feeds].sort((a, b) => a.priority - b.priority);
  const cols: string[] = [];
  const add = (c: string) => { if (!cols.includes(c)) cols.push(c); };
  for (const f of feeds) for (const c of itemTables[f.itemId]?.columns || []) add((f.rename || {})[c.name] || c.name);
  const itemName = (id: string) => { const it = ws.items.find(i => i.id === id); return it?.table || tableName('src_' + id); };
  const branches = feeds.map(f => {
    const t = itemTables[f.itemId];
    const inv = new Map(Object.entries(f.rename || {}).map(([a, b]) => [b, a]));
    const have = new Set((t?.columns || []).map(c => c.name));
    const sel = cols.map(c => { const src = inv.get(c) || c; return have.has(src) ? (src === c ? qi(c) : `${qi(src)} AS ${qi(c)}`) : `NULL AS ${qi(c)}`; });
    const conds = (f.filters || []).map(x => filterSQL(x, qi(x.field), t?.columns.find(cc => cc.name === x.field)?.type === 'number', d)).filter(Boolean) as string[];
    // A fallback feed is read only when every higher-priority feed is empty.
    if (f.fallback) for (const h of feeds) if (h.priority < f.priority) conds.push(`NOT EXISTS (SELECT 1 FROM ${itemName(h.itemId)})`);
    const fw = conds.length ? '\n  WHERE ' + conds.join(' AND ') : '';
    return `  SELECT ${f.priority} AS _priority, ${sel.join(', ')}\n  FROM ${itemName(f.itemId)}${fw}`;
  });
  let sql = `-- ${ds.name}: ${feeds.length} feed${feeds.length === 1 ? '' : 's'}${ds.key?.length ? `, key (${ds.key.join(', ')}), ${ds.mode === 'coalesce' ? 'first non-empty value by priority' : 'highest-priority row wins'}` : ', stacked'}\nCREATE TABLE ${tableName(ds.id)} AS\nWITH feeds AS (\n${branches.join('\n  UNION ALL\n')}\n)`;
  let from = 'feeds';
  if (ds.key && ds.key.length) {
    const keyCols = ds.key.map(qi).join(', ');
    if (ds.mode === 'coalesce') {
      const firstNonNull = (c: string) => d === 'duckdb' ? `FIRST(${qi(c)} ORDER BY _priority) FILTER (WHERE ${qi(c)} IS NOT NULL)` : d === 'bigquery' ? `ARRAY_AGG(${qi(c)} IGNORE NULLS ORDER BY _priority LIMIT 1)[SAFE_OFFSET(0)]` : `(ARRAY_AGG(${qi(c)} ORDER BY _priority) FILTER (WHERE ${qi(c)} IS NOT NULL))[1]`;
      sql += `,\nmerged AS (\n  SELECT ${keyCols}, ${cols.filter(c => !ds.key!.includes(c)).map(c => `${firstNonNull(c)} AS ${qi(c)}`).join(',\n         ')}\n  FROM feeds\n  GROUP BY ${keyCols}\n)`;
    } else {
      sql += `,\nranked AS (\n  SELECT *, ROW_NUMBER() OVER (PARTITION BY ${keyCols} ORDER BY _priority) AS _rank\n  FROM feeds\n),\nmerged AS (\n  SELECT ${cols.map(qi).join(', ')} FROM ranked WHERE _rank = 1\n)`;
    }
    from = 'merged';
  }
  const lookups = ds.lookups || [];
  const pre = (lk: typeof lookups[number]) => lk.prefix || '';
  const lkSel = lookups.flatMap((lk, k) => lk.columns.map(c => `l${k}.${qi(c)} AS ${qi(pre(lk) + c)}`));
  const lkJoin = lookups.map((lk, k) => {
    const src = ws.datasets.some(x => x.id === lk.from) ? tableName(lk.from) : itemName(lk.from);
    return `LEFT JOIN ${src} l${k} ON ${lk.on.map(([a, b]) => `m.${qi(a)} = l${k}.${qi(b)}`).join(' AND ')}`;
  });
  // Each derived column gets its own step so later ones can use earlier ones; early ones run before the lookups.
  const seqOrder = ds.sequence ? [ds.sequence, ...(ds.key || []).filter(c => c !== ds.sequence)].map(c => `${qi(c)} ASC NULLS FIRST`).join(', ') : '';
  let k = 0;
  const step = (dc: NonNullable<Dataset['derived']>[number], prev: string) => {
    let e: string; try { e = srcToSQL(dc.expr || '1', d); } catch { e = 'NULL'; }
    if (dc.window) {
      const part = dc.window.partitionBy?.length ? `PARTITION BY ${dc.window.partitionBy.map(qi).join(', ')} ` : '';
      const ord = seqOrder ? `ORDER BY ${seqOrder}` : '';
      const fr = `OVER (${part}${ord}${dc.window.fn === 'running_sum' || dc.window.fn === 'running_avg' ? ' ROWS UNBOUNDED PRECEDING' : ''})`;
      e = dc.window.fn === 'row_number' ? `ROW_NUMBER() ${fr}` : dc.window.fn === 'lag' ? `LAG(${e}) ${fr}` : `${dc.window.fn === 'running_sum' ? 'SUM' : 'AVG'}(${e}) ${fr}`;
    }
    const name = `d${k++}`;
    sql += `,\n${name} AS (SELECT ${prev}.*, ${e} AS ${qi(dc.name)} FROM ${prev})`;
    return name;
  };
  let prev = from;
  for (const dc of (ds.derived || []).filter(x => x.early)) prev = step(dc, prev);
  sql += `,\njoined AS (\n  SELECT m.*${lkSel.length ? ', ' + lkSel.join(', ') : ''}\n  FROM ${prev} m${lkJoin.length ? '\n  ' + lkJoin.join('\n  ') : ''}\n)`;
  prev = 'joined';
  for (const dc of (ds.derived || []).filter(x => !x.early)) prev = step(dc, prev);
  sql += `\nSELECT * FROM ${prev}${seqOrder ? `\nORDER BY ${seqOrder}` : ''};`;
  void builtTables;
  return sql;
}
