import React from 'react';
import type { Agg, Compare, Field, MeasureRef, Query, Row as DataRow, SeriesOp, Table, TimeGrain, Visualization } from '../core/types';
import { useApp, runCached } from './ctx';
import { aggLabel, fieldsFor, fieldExpr, resolveMeasure } from '../core/semantic';
import { tryCompile, columnsOf, evaluate } from '../core/expr';
import { compileQuery, DIALECTS, type Dialect } from '../core/sql';
import { fmt } from '../core/engine';
import { Check, Collapsible, FiltersEditor, Num, Row, Sel, Txt, fieldOptions, uid, Badge } from './ui';
import { Viz, VIZ_TYPES, autoType } from './viz/charts';
import { Ask } from './Ask';

const AGGS: Agg[] = ['avg', 'sum', 'count', 'median', 'p25', 'p75', 'iqr', 'mode', 'min', 'max', 'rate', 'ratio', 'count_values', 'count_distinct'];
const GRAINS: [TimeGrain, string][] = [['none', 'exact value'], ['hour', 'hour of day'], ['day', 'day'], ['weekday', 'weekday'], ['week', 'week'], ['month', 'month'], ['quarter', 'quarter'], ['year', 'year']];
const SERIES: [SeriesOp, string][] = [['none', 'none: one number'], ['rolling', 'rolling aggregate'], ['delta', 'change vs previous window (Δ)'], ['slope', 'rate of change (d/dt, slope)'], ['cumulative', 'running total (∫)']];
const SORTS: [NonNullable<Query['sort']>, string][] = [['count_desc', 'most rows first'], ['value_desc', 'highest value first'], ['value_asc', 'lowest value first'], ['key_asc', 'by group name / time']];

export function newQuery(dataset: string): Query {
  return { id: uid('q'), name: 'New query', dataset, measures: [{ agg: 'count' }], groupBy: [], filters: [], last: 0, compare: { kind: 'none' }, followDashboard: true };
}

export function ExprHint({ expr, table, kind = 'value' }: { expr: string; table?: Table; kind?: string }) {
  if (!expr.trim()) return null;
  const c = tryCompile(expr);
  if (c.error) return <span className="bad">Cannot read this: {c.error}</span>;
  const have = new Set(table?.columns.map(x => x.name) || []);
  const miss = [...columnsOf(c.node!)].filter(x => !have.has(x));
  if (table && miss.length) return <span className="bad">Unknown column: {miss.join(', ')}</span>;
  if (!table) return <span>OK</span>;
  const rows = table.rows.slice(-200);
  const vals = rows.map(r => evaluate(c.node!, r)).filter(v => v != null);
  return <span>OK · {vals.length} of the last {rows.length} rows give a {kind}{vals.length ? `, latest ${typeof vals[vals.length - 1] === 'number' ? +(vals[vals.length - 1] as number).toFixed(3) : vals[vals.length - 1]}` : ''}</span>;
}

export function Queries() {
  const app = useApp();
  const { ws, update, cat } = app;
  const [sel, setSel] = React.useState<string | undefined>(app.focus && ws.queries.some(q => q.id === app.focus) ? app.focus : ws.queries[0]?.id);
  React.useEffect(() => { if (app.focus && ws.queries.some(q => q.id === app.focus)) setSel(app.focus); }, [app.focus]);
  const [filter, setFilter] = React.useState('');
  const q = ws.queries.find(x => x.id === sel);
  const setQ = (fn: (q: Query) => Query) => update(w => ({ ...w, queries: w.queries.map(x => x.id === sel ? fn(x) : x) }));
  const add = (base?: Query) => { const n = base ? { ...JSON.parse(JSON.stringify(base)), id: uid('q'), name: base.name + ' (copy)' } : newQuery(ws.datasets[0]?.id || ''); update(w => ({ ...w, queries: [...w.queries, n] })); setSel(n.id); };
  const used = (id: string) => ws.visualizations.filter(v => v.queryId === id).length;
  const [confirm, setConfirm] = React.useState<string | null>(null);
  const del = (id: string) => {
    const vids = new Set(ws.visualizations.filter(v => v.queryId === id).map(v => v.id));
    update(w => ({ ...w, queries: w.queries.filter(x => x.id !== id), visualizations: w.visualizations.filter(v => v.queryId !== id), dashboards: w.dashboards.map(d => ({ ...d, tiles: d.tiles.filter(t => !vids.has(t.vizId)) })) }));
    setSel(ws.queries.find(x => x.id !== id)?.id); setConfirm(null);
  };
  return <div className="page split">
    <aside className="list">
      <div className="listhead"><b>Data source items</b><span className="muted small">saved queries</span></div>
      <Txt value={filter} onChange={setFilter} placeholder="Search queries" />
      <div className="items">
        {ws.queries.filter(x => !filter || x.name.toLowerCase().includes(filter.toLowerCase())).map(x => <div key={x.id} className={'item' + (x.id === sel ? ' active' : '')} onClick={() => setSel(x.id)}>
          <span className="name">{x.name}</span>
          <span className="meta">{ws.datasets.find(d => d.id === x.dataset)?.name}{used(x.id) ? ` · ${used(x.id)} viz` : ''}{x.weight ? ' · weighted' : ''}</span>
        </div>)}
      </div>
      <button onClick={() => add()}>+ New query</button>
    </aside>
    <section className="editor">
      <Ask onQuery={nq => { update(w => ({ ...w, queries: [...w.queries, nq] })); setSel(nq.id); }} />
      {!q ? <div className="empty">Pick a query or create one.</div> : <QueryEditor key={q.id} q={q} setQ={setQ}
        actions={<>
          <button className="ghost" onClick={() => add(q)}>Duplicate</button>
          <button className="ghost" onClick={() => { const v: Visualization = { id: uid('v'), name: q.name, queryId: q.id, type: autoType(runCached(cat, q)), color: 1, width: 3, window: 10, labels: true }; update(w => ({ ...w, visualizations: [...w.visualizations, v] })); app.go('visualizations', v.id); }}>Make a visualization</button>
          {confirm === q.id ? <><button className="danger" onClick={() => del(q.id)}>Delete query{used(q.id) ? ` and its ${used(q.id)} visualization${used(q.id) > 1 ? 's' : ''}` : ''}</button><button className="ghost" onClick={() => setConfirm(null)}>Keep</button></> : <button className="ghost" onClick={() => setConfirm(q.id)}>Delete</button>}
        </>} />}
    </section>
  </div>;
}

export function QueryEditor({ q, setQ, actions }: { q: Query; setQ: (fn: (q: Query) => Query) => void; actions?: React.ReactNode }) {
  const app = useApp();
  const { ws, cat, showHidden } = app;
  const table = cat.tables[q.dataset];
  const fields = fieldsFor(ws, q.dataset, table);
  const ds = ws.datasets.find(d => d.id === q.dataset);
  const set = (p: Partial<Query>) => setQ(x => ({ ...x, ...p }));
  const weights = fields.filter(f => f.role === 'weight');
  const customWeight = !!q.weight && !weights.some(w => w.id === q.weight);
  const [wMode, setWMode] = React.useState<'field' | 'custom'>(customWeight ? 'custom' : 'field');
  const valuesFor = (field: string) => { if (!table) return []; const e = fieldExpr(field, fields); const s = new Set<string>(); for (const r of table.rows) { const v = r[e]; if (v != null) s.add(String(v)); if (s.size > 300) break; } return [...s].sort(); };
  const res = runCached(cat, q);
  const timeFields = new Set(fields.filter(f => f.type === 'time').map(f => f.id));

  return <div className="qe">
    <div className="qhead">
      <Txt className="qname" value={q.name} onChange={v => set({ name: v })} placeholder="Query name" />
      <div className="actions">{actions}</div>
    </div>
    <div className="qgrid">
      <div className="qform">
        <Row label="Dataset" hint={ds?.description}>
          <Sel value={q.dataset} onChange={v => set({ dataset: v, measures: [{ agg: 'count' }], groupBy: [], filters: [], compare: { kind: 'none' }, weight: undefined })} options={ws.datasets.map(d => [d.id, `${d.name}${cat.tables[d.id] ? ` (${cat.tables[d.id]!.rows.length.toLocaleString()} ${d.grain || 'row'}s)` : ' (not loaded)'}`] as [string, string])} />
        </Row>
        <Row label="Measures"><MeasuresEditor q={q} set={set} fields={fields} table={table} showHidden={showHidden} /></Row>
        <Row label="Weight rows by" hint={q.weight ? <>Averages become Σ(value × weight) ÷ Σ weight, sums Σ(value × weight), counts Σ weight. Rows with no value or no weight drop out of both sides. <ExprHint expr={fieldExpr(q.weight, fields)} table={table} kind="weight" /></> : 'Every row counts once.'}>
          <div className="inline">
            <Sel value={wMode === 'custom' ? '__custom' : (q.weight || '')} blank="no weighting" onChange={v => { if (v === '__custom') { setWMode('custom'); set({ weight: q.weight && !weights.some(w => w.id === q.weight) ? q.weight : '1' }); } else { setWMode('field'); set({ weight: v || undefined }); } }} options={[...weights.map(w => [w.id, w.label] as [string, string]), ['__custom', 'custom formula…']]} />
            {wMode === 'custom' && <Txt mono value={q.weight} onChange={v => set({ weight: v })} placeholder="if(position = 'UTILITY', 0.5, 1)" />}
          </div>
          {wMode === 'field' && q.weight && <div className="hint">{weights.find(w => w.id === q.weight)?.description} <code>{weights.find(w => w.id === q.weight)?.expr}</code></div>}
        </Row>
        <Row label="Filters"><FiltersEditor filters={q.filters} onChange={f => set({ filters: f })} fields={fields} showHidden={showHidden} valuesFor={valuesFor} /></Row>
        {ds?.sequence && <Row label="Window" hint={`Keep the most recent N ${ds.grain || 'row'}s by ${ds.sequence} after filtering. 0 = all.`}><div className="inline">last <Num className="n8" value={q.last} min={0} onChange={v => set({ last: v || 0 })} /> {ds.grain || 'row'}s<Check checked={q.followDashboard} onChange={v => set({ followDashboard: v })}>follow the dashboard’s filters and window</Check></div></Row>}
        <Row label="Group by">
          {[0, 1].map(i => (i === 0 || q.groupBy.length >= 1) && <div key={i} className="inline">
            <Sel value={q.groupBy[i]?.field || ''} blank={i === 0 ? 'no grouping' : 'no second group'} onChange={v => { const g = [...q.groupBy]; if (!v) g.splice(i); else g[i] = { field: v, grain: timeFields.has(v) ? (g[i]?.grain || 'month') : undefined }; set({ groupBy: g }); }} options={fieldOptions(fields, showHidden)} />
            {q.groupBy[i] && timeFields.has(q.groupBy[i].field) && <Sel value={q.groupBy[i].grain || 'none'} onChange={v => set({ groupBy: q.groupBy.map((g, j) => j === i ? { ...g, grain: v } : g) })} options={GRAINS} />}
          </div>)}
        </Row>
        {q.groupBy.length > 0 && <Row label="Groups" hint="Having and minimum rows filter groups after aggregation (SQL HAVING). With two group-bys, top N keeps the best N of the second within each first.">
          <div className="inline wrap">
            <Sel value={q.sort || ''} blank="default order" onChange={v => set({ sort: v || undefined })} options={SORTS} />
            <label className="inline">top <Num className="n6" value={q.limit} min={0} onChange={v => set({ limit: v || undefined })} placeholder="all" /></label>
            <label className="inline">at least <Num className="n6" value={q.minRows} min={0} onChange={v => set({ minRows: v || undefined })} placeholder="1" /> rows</label>
            <Check checked={q.rollup} onChange={v => set({ rollup: v })}>subtotals and total (ROLLUP)</Check>
          </div>
          {(q.having || []).map((h, i) => <div key={i} className="inline">having
            <Sel value={String(h.measure)} onChange={v => set({ having: q.having!.map((x, j) => j === i ? { ...x, measure: Number(v) } : x) })} options={res.measures.map((m, j) => [String(j), m.label] as [string, string])} />
            <Sel value={h.op} onChange={v => set({ having: q.having!.map((x, j) => j === i ? { ...x, op: v } : x) })} options={(['>', '<', '>=', '<=', '=', '!='] as const).map(o => [o, o] as [typeof o, string])} />
            <Num className="n8" value={h.value} onChange={v => set({ having: q.having!.map((x, j) => j === i ? { ...x, value: v ?? 0 } : x) })} />
            <button className="ghost icon" onClick={() => set({ having: q.having!.filter((_, j) => j !== i) })}>×</button>
          </div>)}
          <button className="ghost" onClick={() => set({ having: [...(q.having || []), { measure: 0, op: '>=', value: 0 }] })}>+ having</button>
        </Row>}
        {ds?.sequence && <Row label="Series" hint="Window functions along the sequence: the tile shows the latest value, lines show every step.">
          <div className="inline"><Sel value={q.series?.op || 'none'} onChange={v => set({ series: v === 'none' ? undefined : { op: v, window: q.series?.window || 10 } })} options={SERIES} />
            {q.series && q.series.op !== 'none' && q.series.op !== 'cumulative' && <label className="inline">window <Num className="n6" value={q.series.window} min={2} onChange={v => set({ series: { ...q.series!, window: v || 10 } })} /> {ds.grain || 'row'}s</label>}</div>
        </Row>}
        <Row label="Compare with"><CompareEditor q={q} set={set} fields={fields} /></Row>
      </div>
      <Preview q={q} res={res} />
    </div>
  </div>;
}

function MeasuresEditor({ q, set, fields, table, showHidden }: { q: Query; set: (p: Partial<Query>) => void; fields: Field[]; table?: Table; showHidden: boolean }) {
  const setM = (i: number, p: Partial<MeasureRef>) => set({ measures: q.measures.map((m, j) => j === i ? { ...m, ...p } : m) });
  return <div className="measures">
    {q.measures.map((m, i) => {
      const formula = m.expr != null;
      const r = resolveMeasure(m, fields, q.weight);
      const f = fields.find(x => x.id === m.field);
      return <div key={i} className="measure">
        <div className="inline">
          <Sel value={formula ? 'formula' : 'field'} onChange={v => setM(i, v === 'formula' ? { expr: m.field ? fieldExpr(m.field, fields) : '', field: undefined, agg: m.agg || 'avg' } : { expr: undefined, denominator: undefined })} options={[['field', 'field'], ['formula', 'formula']]} />
          {!formula && <Sel value={m.field || (m.agg === 'count' ? '__count' : '')} onChange={v => setM(i, v === '__count' ? { field: undefined, agg: 'count' } : { field: v, agg: undefined })} options={[['__count', 'count of rows'] as [string, string], ...fieldOptions(fields, showHidden, ['measure', 'dimension'])]} />}
          {formula && <Txt mono value={m.expr} onChange={v => setM(i, { expr: v })} placeholder="cs_per_min - opp_cs_per_min" />}
          <Sel value={m.agg || ''} blank={f?.agg ? `default (${aggLabel(f.agg)})` : 'default'} onChange={v => setM(i, { agg: v || undefined })} options={AGGS.map(a => [a, aggLabel(a)] as [Agg, string])} />
          <button className="ghost icon" title="Move up" disabled={i === 0} onClick={() => { const ms = [...q.measures]; [ms[i - 1], ms[i]] = [ms[i], ms[i - 1]]; set({ measures: ms }); }}>↑</button>
          <button className="ghost icon" title="Remove" onClick={() => set({ measures: q.measures.filter((_, j) => j !== i) })}>×</button>
        </div>
        {formula && (m.agg === 'ratio') && <div className="inline">÷ <Txt mono value={m.denominator} onChange={v => setM(i, { denominator: v })} placeholder="denominator, e.g. duration_min" /></div>}
        {formula && <div className="inline"><Txt value={m.label} onChange={v => setM(i, { label: v })} placeholder="label" /></div>}
        <div className="hint">
          {i === 0 && q.measures.length > 1 ? 'Primary measure (charts, sorting, compare). ' : ''}
          {formula ? <ExprHint expr={m.expr || ''} table={table} /> : f?.description}
          {r && <span className="muted"> {r.agg === 'ratio' ? `Σ ${r.expr} ÷ Σ ${r.denominator}` : r.weight ? `weighted by ${r.weight}` : ''} {r.additivity !== 'additive' ? <Badge>{r.additivity.replace('_', '-')}</Badge> : <Badge tone="ok">additive</Badge>}</span>}
        </div>
      </div>;
    })}
    <div className="inline"><button className="ghost" onClick={() => set({ measures: [...q.measures, { field: fields.find(f => f.role === 'measure' && !f.hidden)?.id }] })}>+ measure</button><button className="ghost" onClick={() => set({ measures: [...q.measures, { expr: '', agg: 'avg' }] })}>+ formula</button></div>
  </div>;
}

function CompareEditor({ q, set, fields }: { q: Query; set: (p: Partial<Query>) => void; fields: Field[] }) {
  const { ws, cat, showHidden } = useApp();
  const c = q.compare;
  const setC = (p: Partial<Compare> & { kind?: Compare['kind'] }) => set({ compare: { ...c, ...p } as Compare });
  const ref = c.kind === 'reference' ? c : null;
  const rfields = ref ? fieldsFor(ws, ref.dataset, cat.tables[ref.dataset]) : [];
  const shared = ref ? rfields.filter(f => f.role === 'dimension' && fields.some(x => x.id === f.id || x.expr === f.expr)) : [];
  return <div>
    <Sel value={c.kind} onChange={k => set({ compare: k === 'none' ? { kind: 'none' } : k === 'previous' ? { kind: 'previous' } : k === 'target' ? { kind: 'target', value: 0 } : k === 'paired' ? { kind: 'paired', field: '' } : { kind: 'reference', dataset: ws.datasets.find(d => d.id !== q.dataset)?.id || q.dataset, filters: [], weightBy: [] } })}
      options={[['none', 'nothing'], ['previous', 'the window before (previous N)'], ['target', 'a fixed target'], ['paired', 'another column, same rows'], ['reference', 'another dataset (reference population)']]} />
    {c.kind === 'previous' && !q.last && <div className="hint bad">Needs a “last N” window.</div>}
    {c.kind === 'target' && <div className="inline"><Num className="n8" value={c.value} onChange={v => setC({ value: v ?? 0 })} /><Txt value={c.label} onChange={v => setC({ label: v })} placeholder="label, e.g. 50%" /></div>}
    {c.kind === 'paired' && <div className="inline"><Sel value={c.field || ''} blank="column…" onChange={v => setC({ field: v, expr: undefined })} options={fieldOptions(fields, showHidden, ['measure'])} /><Txt mono value={c.expr} onChange={v => setC({ expr: v })} placeholder="or a formula" /><Txt value={c.label} onChange={v => setC({ label: v })} placeholder="label" /></div>}
    {ref && <>
      <div className="inline"><Sel value={ref.dataset} onChange={v => setC({ dataset: v, filters: [], weightBy: [] })} options={ws.datasets.map(d => [d.id, d.name] as [string, string])} /><Txt value={ref.label} onChange={v => setC({ label: v })} placeholder="label" /></div>
      <div className="hint">Reference rows:</div>
      <FiltersEditor filters={ref.filters || []} onChange={f => setC({ filters: f })} fields={rfields} showHidden={showHidden} />
      <div className="hint">Like for like: weight the reference by this query’s own mix of</div>
      <div className="chips">{shared.map(f => { const on = (ref.weightBy || []).includes(f.id); return <button key={f.id} className={'chip' + (on ? ' on' : '')} onClick={() => setC({ weightBy: on ? ref.weightBy!.filter(x => x !== f.id) : [...(ref.weightBy || []), f.id] })}>{f.label}</button>; })}{!shared.length && <span className="muted small">no shared dimensions</span>}</div>
    </>}
  </div>;
}

function Preview({ q, res }: { q: Query; res: ReturnType<typeof runCached> }) {
  const app = useApp();
  const { ws, cat } = app;
  const [tab, setTab] = React.useState<'chart' | 'table' | 'sql' | 'rows'>('chart');
  const [type, setType] = React.useState<Visualization['type'] | ''>('');
  const [dialect, setDialect] = React.useState<Dialect>('duckdb');
  const v: Visualization = { id: 'preview', name: q.name, queryId: q.id, type: type || autoType(res), color: 1, width: 6, window: 10, labels: true, card: ws.visualizations.find(x => x.queryId === q.id && x.card)?.card };
  return <div className="preview">
    <div className="tabs small">
      {(['chart', 'table', 'sql', 'rows'] as const).map(t => <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{t === 'sql' ? 'SQL' : t === 'rows' ? `Rows (${res.n.toLocaleString()})` : t[0].toUpperCase() + t.slice(1)}</button>)}
      {tab === 'chart' && <Sel className="mini" value={type} blank={`auto (${VIZ_TYPES.find(x => x.id === autoType(res))?.name})`} onChange={v => setType(v)} options={VIZ_TYPES.map(t => [t.id, t.name] as [Visualization['type'], string])} />}
      {tab === 'sql' && <Sel className="mini" value={dialect} onChange={setDialect} options={DIALECTS.map(d => [d.id, d.name] as [Dialect, string])} />}
    </div>
    <div className="pbody">
      {res.warnings.length > 0 && <div className="warn small">{res.warnings.join(' · ')}</div>}
      {tab === 'chart' && <><Viz v={v} res={res} cat={cat} />{res.unweighted && res.measures[0]?.weight && <div className="wnote">Weighted. Unweighted: {fmt(res.unweighted[0], res.measures[0].format)}</div>}</>}
      {tab === 'table' && <Viz v={{ ...v, type: 'table' }} res={res} cat={cat} />}
      {tab === 'sql' && <SqlView q={q} dialect={dialect} />}
      {tab === 'rows' && <RowsView q={q} rows={res.rows} />}
    </div>
  </div>;
}

function SqlView({ q, dialect }: { q: Query; dialect: Dialect }) {
  const { ws, cat, toast } = useApp();
  let c: ReturnType<typeof compileQuery>;
  try { c = compileQuery(ws, cat.tables, q, undefined, dialect); } catch (e) { return <div className="warn">{(e as Error).message}</div>; }
  const all = [c.main, c.totals, c.compare].filter(Boolean).join(';\n\n') + ';';
  return <div>
    <div className="small muted">What a warehouse would run for this query. The browser runs the same plan locally; both give the same numbers (checked in DuckDB). Table names are the dataset ids.</div>
    {c.notes.length > 0 && <ul className="small">{c.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
    <pre className="sql">{all}</pre>
    <button className="ghost" onClick={() => { navigator.clipboard?.writeText(all).then(() => toast('SQL copied'), () => toast('Copy is blocked here; select the text instead')); }}>Copy SQL</button>
  </div>;
}

/** The rows behind the result, newest first, with the manual tables joined onto this dataset editable in place (highlights, weights, tags). */
function RowsView({ q, rows }: { q: Query; rows: DataRow[] }) {
  const { ws, update, cat } = useApp();
  const ds = ws.datasets.find(d => d.id === q.dataset);
  const table = cat.tables[q.dataset];
  const fields = fieldsFor(ws, q.dataset, table);
  const manual = (ds?.lookups || []).map(lk => ({ lk, item: ws.items.find(i => i.id === lk.from && ws.sources.find(s => s.id === i.sourceId)?.kind === 'manual') })).filter(x => x.item);
  const editCols = new Set(manual.flatMap(x => x.lk.columns.map(c => (x.lk.prefix || '') + c)));
  const show = [ds?.sequence, ...q.groupBy.map(g => fieldExpr(g.field, fields)), ...q.measures.map(m => m.field ? fieldExpr(m.field, fields) : null), ...fields.filter(f => f.role === 'dimension' && !f.hidden).slice(0, 4).map(f => f.expr)]
    .filter((c, i, a): c is string => !!c && a.indexOf(c) === i && !!table?.columns.some(x => x.name === c) && !editCols.has(c)).slice(0, 7);
  const setCell = (r: DataRow, lkIdx: number, col: string, value: string) => {
    const { lk, item } = manual[lkIdx]; if (!item) return;
    const type = item.schema?.find(c => c.name === col)?.type;
    const val = value === '' ? null : type === 'number' ? Number(value) : value;
    update(w => ({ ...w, items: w.items.map(it => {
      if (it.id !== item.id) return it;
      const key = (x: DataRow) => lk.on.map(([, b]) => String(x[b] ?? '')).join('\u0001');
      const want = lk.on.map(([a]) => String(r[a] ?? '')).join('\u0001');
      const list = [...(it.rows || [])];
      let i = list.findIndex(x => key(x) === want);
      if (i < 0) { const nr: DataRow = {}; lk.on.forEach(([a, b]) => { nr[b] = r[a] ?? null; }); list.push(nr); i = list.length - 1; }
      list[i] = { ...list[i], [col]: val };
      if (lk.columns.every(c => list[i][c] == null || list[i][c] === '')) list.splice(i, 1);
      return { ...it, rows: list };
    }) }));
  };
  const shown = [...rows].reverse().slice(0, 300);
  return <div>
    {manual.length > 0 && <div className="small muted">Edit the {manual.map(m => m.item!.name).join(', ')} columns here: they live in a table you own and join onto {ds?.name} by {manual[0].lk.on.map(p => p[0]).join(' + ')}. A weight above 1 marks a highlight; use the “{fields.find(f => f.role === 'weight' && /highlight|game_weight/.test(f.expr + f.id))?.label || 'highlights'}” weighting to apply it.</div>}
    <div className="tscroll tall"><table className="data rows">
      <thead><tr>{show.map(c => <th key={c}>{fields.find(f => f.expr === c)?.label || c}</th>)}{manual.flatMap((m, k) => m.lk.columns.map(c => <th key={k + c} className="edit">{c.replace(/_/g, ' ')}</th>))}</tr></thead>
      <tbody>{shown.map((r, i) => <tr key={i} className={r.highlight_weight != null && Number(r.highlight_weight) > 1 ? 'hl' : ''}>
        {show.map(c => <td key={c} className={typeof r[c] === 'number' ? 'num' : ''}>{r[c] == null ? '' : typeof r[c] === 'number' && !Number.isInteger(r[c]) ? (r[c] as number).toFixed(2) : String(r[c])}</td>)}
        {manual.flatMap((m, k) => m.lk.columns.map(c => {
          const col = (m.lk.prefix || '') + c; const type = m.item!.schema?.find(x => x.name === c)?.type;
          const cur = r[col];
          if (type === 'number' && /weight/.test(c)) return <td key={k + c} className="edit"><span className="stars">{[1, 2, 3].map(n => <button key={n} title={n === 1 ? 'normal weight' : `weight ×${n}`} className={'star' + (Number(cur ?? 1) >= n && n > 1 ? ' on' : '')} onClick={() => setCell(r, k, c, n === 1 || Number(cur) === n ? '' : String(n))}>{n === 1 ? '·' : '★'}</button>)}</span></td>;
          return <td key={k + c} className="edit"><EditCell value={cur == null ? '' : String(cur)} onCommit={v => setCell(r, k, c, v)} /></td>;
        }))}
      </tr>)}</tbody></table></div>
    {rows.length > shown.length && <div className="small muted">Showing the newest {shown.length} of {rows.length.toLocaleString()} rows.</div>}
  </div>;
}

function EditCell({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const [v, setV] = React.useState(value);
  React.useEffect(() => setV(value), [value]);
  return <input className="cell" value={v} onChange={e => setV(e.target.value)} onBlur={() => v !== value && onCommit(v)} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />;
}
