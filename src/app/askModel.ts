// Ask: a sentence in, a saved query and visualization out. The model sees the semantic layer
// (datasets, fields, sample values, weighting schemes, domain notes) and the query object's shape,
// and writes the same object the builder edits. Nothing it returns runs until it validates here.
import type { Agg, Compare, Filter, Query, Visualization, Workspace, Table, VizType } from '../core/types';
import { fieldsFor } from '../core/semantic';
import { FUNCS, tryCompile, columnsOf } from '../core/expr';
import { uid } from './ui';

const AGGS: Agg[] = ['sum', 'avg', 'median', 'p25', 'p75', 'iqr', 'min', 'max', 'count', 'count_values', 'count_distinct', 'rate', 'ratio'];
const VIZ: VizType[] = ['kpi', 'gauge', 'bar', 'column', 'line', 'area', 'hist', 'scatter', 'heatmap', 'table', 'sparktable', 'trend', 'profile', 'ribbon', 'distribution', 'card'];

export function askPrompt(ws: Workspace, tables: Record<string, Table | undefined>, question: string, showHidden: boolean): string {
  const lines: string[] = [];
  lines.push('You turn a question into a saved query for a dashboard tool with a dimensional semantic layer. Reply with only JSON:');
  lines.push('{"query": Query, "visualization": {"type": VizType, "name": string, "x"?: field id for scatter, "window"?: number, "reference"?: dataset id for distribution}, "explanation": "one or two plain sentences on what the numbers mean, including any weighting"}');
  lines.push('or {"error": "why it cannot be answered from these datasets"}.');
  lines.push('');
  lines.push(`Query = {
  "name": string,
  "dataset": dataset id,
  "measures": [ {"field": measure field id, "agg"?: Agg} | {"agg": "count"} | {"expr": formula, "agg": Agg, "label": string, "denominator"?: formula when agg is "ratio"} ],
  "filters": [ {"field": field id or column, "op": "="|"!="|">"|"<"|">="|"<="|"in"|"contains"|"is_null"|"not_null", "value": string ("a, b" for in)} ],   // WHERE, before aggregation
  "groupBy": [ {"field": field id, "grain"?: "hour"|"day"|"weekday"|"week"|"month"|"quarter"|"year" (time fields only)} ],          // at most 2
  "last": number,            // keep only the most recent N rows by the dataset's sequence (0 = all)
  "weight"?: weight field id or a row formula,   // weighted aggregates: avg = Σ(x·w)/Σw, sum = Σ(x·w), count = Σw; NULL x or w drop from both sides
  "having"?: [ {"measure": index into measures, "op": ">"|"<"|">="|"<="|"="|"!=", "value": number} ],   // HAVING, after aggregation
  "minRows"?: number,        // groups need at least this many rows
  "sort"?: "value_desc"|"value_asc"|"count_desc"|"key_asc",
  "limit"?: number,          // top N groups; with two groupBy fields, top N of the second within each first (top-N per group)
  "rollup"?: boolean,        // subtotals per first group plus a grand total
  "series"?: {"op": "rolling"|"delta"|"slope"|"cumulative", "window": number},   // window functions along the sequence: rolling average, change vs previous window, rate of change per 10 rows, running total
  "compare": {"kind":"none"} | {"kind":"previous"} (needs last) | {"kind":"target","value":number,"label":string} | {"kind":"paired","field": measure field or column on the same rows,"label":string} | {"kind":"reference","dataset": id,"filters":[...],"weightBy":[dimension ids shared by both datasets],"label":string}
}
Agg = ${AGGS.join(' | ')}. p25 / p75 = the 25th and 75th percentile, iqr = p75 minus p25 (spread of the middle half; not weightable). "rate" is the average of a 0/1 column shown as a percent. "ratio" = Σ expr ÷ Σ denominator (a weighted average from additive parts, e.g. total CS ÷ total minutes).
VizType = ${VIZ.join(' | ')}. kpi = one number with its comparison; trend = is a measure improving over the rows, with a t-test (no groupBy, use last); line/area need series or a time grain; bar/column need one groupBy; heatmap needs two; table suits rollup and several measures; sparktable = groups with a rolling sparkline each; profile = player card with Baseline (the measure over all rows), Consistency (middle half, p25 to p75), Peak (best rolling window) and Trend (change per 100 rows with a 95% range) for each measure (no groupBy, usually last 0, several measures allowed); ribbon = rolling baseline line with the middle-half band and the peak marked (one measure, no groupBy); distribution = how the rows spread over ordered bins against a population (exactly one groupBy = the bins, measure = a count or an additive measure, last 0; set visualization.reference to the population's dataset id, which must have the same group-by field), read as Baseline (median bin and its percentile in the population), Consistency (middle half), Peak (most common bin), the shift from the population's median and the chance of ranking higher; card is only for existing comparison cards.
Formula language: column names, numbers, 'text', + - * / %, = != < > <= >=, and, or, not, and the functions ${Object.values(FUNCS).map(f => f.doc).join('; ')}.`);
  lines.push('');
  lines.push('Rules: use field ids exactly as listed. Prefer a listed measure over a formula. Additive measures may be summed; non-additive ones (averages, rates, ratios) must not be summed, average them or build a ratio. "Weighted by X" or "count X more" means query.weight. "Per game" or "average" on a per-row value means avg. When a question compares with a population, use compare kind reference with weightBy on the dimensions that make it like for like. Keep hidden fields out unless the question names them.');
  lines.push('');
  for (const ds of ws.datasets) {
    const t = tables[ds.id];
    const fields = fieldsFor(ws, ds.id, t).filter(f => showHidden || !f.hidden);
    lines.push(`DATASET ${ds.id} "${ds.name}": one row per ${ds.grain || 'row'}${t ? `, ${t.rows.length} rows` : ', not loaded'}${ds.sequence ? `, sequence ${ds.sequence}` : ''}. ${ds.description || ''}`);
    for (const f of fields) {
      let extra = '';
      if (f.role === 'dimension' && t && f.type === 'string') {
        const counts = new Map<string, number>();
        for (const r of t.rows.slice(-3000)) { const v = r[f.expr]; if (v != null && v !== '') counts.set(String(v), (counts.get(String(v)) || 0) + 1); if (counts.size > 60) break; }
        if (counts.size && counts.size <= 60) extra = ` values: ${[...counts].sort((a, b) => b[1] - a[1]).slice(0, 10).map(x => x[0]).join(', ')}${counts.size > 10 ? ', …' : ''}`;
      }
      const parts = [f.role, f.type, f.agg ? `agg ${f.agg}` : '', f.additivity ? f.additivity : '', f.weight ? `weighted by ${f.weight}` : '', f.denominator ? `÷ ${f.denominator}` : '', f.expr !== f.id ? `= ${f.expr}` : '', f.polarity === 'lower' ? 'lower is better' : ''].filter(Boolean);
      lines.push(`  ${f.id} | ${f.label} | ${parts.join(', ')}${extra}${f.description ? ` | ${f.description.slice(0, 160)}` : ''}`);
    }
  }
  if (ws.domainNotes) { lines.push(''); lines.push(ws.domainNotes); }
  lines.push('');
  lines.push('Examples (another domain):');
  lines.push('Q: average yield by variety, weighted by field area, best first → {"query":{"name":"Yield by variety, area-weighted","dataset":"plots","measures":[{"field":"yield_t_ha"}],"groupBy":[{"field":"variety"}],"filters":[],"last":0,"weight":"area_ha","sort":"value_desc","compare":{"kind":"none"}},"visualization":{"type":"bar","name":"Yield by variety"},"explanation":"Each plot counts in proportion to its area."}');
  lines.push('Q: best two varieties per crop with at least 3 plots → groupBy [crop, variety], minRows 3, sort value_desc, limit 2, visualization table.');
  lines.push('');
  lines.push('Question: ' + question);
  return lines.join('\n');
}

export interface AskAnswer { query?: Query; visualization?: Partial<Visualization>; explanation?: string; error?: string; fixes: string[] }

/** Check everything the model wrote against the catalog; repair what can be repaired, refuse the rest. */
export function validateAnswer(raw: unknown, ws: Workspace, tables: Record<string, Table | undefined>): AskAnswer {
  const fixes: string[] = [];
  const a = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  if (typeof a.error === 'string') return { error: a.error, fixes };
  const q0 = (a.query && typeof a.query === 'object' ? a.query : null) as Record<string, unknown> | null;
  if (!q0) return { error: 'The answer had no query in it.', fixes };
  const ds = ws.datasets.find(d => d.id === q0.dataset);
  if (!ds) return { error: `There is no dataset "${String(q0.dataset)}".`, fixes };
  const t = tables[ds.id];
  const fields = fieldsFor(ws, ds.id, t);
  const has = (name: string) => fields.some(f => f.id === name) || !!t?.columns.some(c => c.name === name);
  const exprOk = (e: string) => { const c = tryCompile(e); if (c.error) return false; return !t || [...columnsOf(c.node!)].every(x => t.columns.some(cc => cc.name === x)); };
  const measures = (Array.isArray(q0.measures) ? q0.measures : []).map((m: Record<string, unknown>) => {
    const agg = AGGS.includes(m.agg as Agg) ? m.agg as Agg : undefined;
    if (typeof m.expr === 'string' && m.expr.trim()) { if (!exprOk(m.expr)) { fixes.push(`dropped the formula ${m.expr}`); return null; } return { expr: m.expr, agg: agg || 'avg', label: typeof m.label === 'string' ? m.label : m.expr, ...(agg === 'ratio' && typeof m.denominator === 'string' && exprOk(m.denominator) ? { denominator: m.denominator } : {}) }; }
    if (typeof m.field === 'string') { if (!has(m.field)) { fixes.push(`dropped unknown field ${m.field}`); return null; } return { field: m.field, ...(agg ? { agg } : {}) }; }
    if (agg === 'count') return { agg: 'count' as Agg };
    return null;
  }).filter(Boolean) as Query['measures'];
  if (!measures.length) return { error: 'None of the measures exist on that dataset.', fixes };
  const filters = (Array.isArray(q0.filters) ? q0.filters : []).filter((f: Filter) => { const ok = f && typeof f.field === 'string' && has(f.field); if (!ok) fixes.push(`dropped a filter on ${f?.field}`); return ok; }).map((f: Filter) => ({ field: f.field, op: f.op || '=', value: f.value == null ? '' : String(f.value) }));
  const groupBy = (Array.isArray(q0.groupBy) ? q0.groupBy : []).filter((g: { field: string }) => { const ok = g && has(g.field); if (!ok) fixes.push(`dropped grouping by ${g?.field}`); return ok; }).slice(0, 2);
  let weight = typeof q0.weight === 'string' && q0.weight.trim() ? q0.weight.trim() : undefined;
  if (weight && !fields.some(f => f.id === weight) && !exprOk(weight)) { fixes.push(`dropped the weight ${weight}`); weight = undefined; }
  let compare = (q0.compare && typeof q0.compare === 'object' ? q0.compare : { kind: 'none' }) as Compare;
  const cmpDs = compare.kind === 'reference' ? compare.dataset : null;
  if (compare.kind === 'reference' && !ws.datasets.some(d => d.id === cmpDs)) { fixes.push('dropped a comparison with an unknown dataset'); compare = { kind: 'none' }; }
  if (!['none', 'previous', 'target', 'paired', 'reference'].includes(compare.kind)) compare = { kind: 'none' };
  const num = (x: unknown) => typeof x === 'number' && Number.isFinite(x) ? x : undefined;
  const s0 = q0.series as { op?: string; window?: number } | undefined;
  const series: Query['series'] = s0 && typeof s0 === 'object' && ['rolling', 'delta', 'slope', 'cumulative'].includes(s0.op || '') && ds.sequence ? { op: s0.op as NonNullable<Query['series']>['op'], window: num(s0.window) || 10 } : undefined;
  const query: Query = {
    id: uid('q'), name: typeof q0.name === 'string' && q0.name ? q0.name : 'Asked query', dataset: ds.id, measures, filters, groupBy,
    last: num(q0.last) ?? 0, weight, compare, followDashboard: true,
    having: Array.isArray(q0.having) ? (q0.having as Query['having'])!.filter(h => h && num(h.value) != null && num(h.measure) != null && h.measure < measures.length) : undefined,
    minRows: num(q0.minRows), sort: ['value_desc', 'value_asc', 'count_desc', 'key_asc'].includes(q0.sort as string) ? q0.sort as Query['sort'] : undefined,
    limit: num(q0.limit), rollup: q0.rollup === true || undefined, series,
  };
  const v0 = (a.visualization && typeof a.visualization === 'object' ? a.visualization : {}) as Partial<Visualization>;
  const visualization: Partial<Visualization> = { type: VIZ.includes(v0.type as VizType) && v0.type !== 'card' ? v0.type : undefined, name: typeof v0.name === 'string' ? v0.name : query.name, x: typeof v0.x === 'string' && has(v0.x) ? v0.x : undefined, window: num(v0.window) };
  const ref = (a.visualization as { reference?: unknown } | undefined)?.reference;
  if (visualization.type === 'distribution') {
    if (typeof ref === 'string' && ws.datasets.some(d => d.id === ref)) visualization.dist = { dataset: ref };
    else if (ref != null) fixes.push(`dropped the unknown reference dataset ${String(ref)}`);
    if (groupBy.length !== 1) { fixes.push('a distribution needs one group-by, so it is shown as a table'); visualization.type = 'table'; }
  }
  return { query, visualization, explanation: typeof a.explanation === 'string' ? a.explanation : undefined, fixes };
}
