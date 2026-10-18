// The semantic layer: named dimensions and measures over the processed datasets.
// Fields the user has not described are inferred from the built columns, so a new CSV is
// queryable the moment it lands; curated fields (labels, default aggregation, format, polarity,
// hidden) override the inferred ones by id.
import type { Agg, ColumnType, Field, Format, MeasureRef, Table, Workspace } from './types';
import { columnsOf, compile, isBareColumn } from './expr';

const NON_ADDITIVE_HINT = /(per_min|_pm$|_pct|pct_|rate|ratio|avg|mean|kda|_wr$|^wr_|percent|_per_|density|ph$|price)/;
const RATE_HINT = /(^|_)(win|won|is_|has_|flag|rate|pct_?|ratio)/;
export const humanize = (s: string) => s.replace(/_/g, ' ').replace(/\bpm\b/, 'per min').replace(/\bpct\b/, '%');

export function inferFields(datasetId: string, table: Table | undefined): Field[] {
  if (!table) return [];
  return table.columns.map(c => {
    if (c.type === 'number') {
      const vals = table.rows.slice(0, 500).map(r => r[c.name]).filter(v => v != null) as number[];
      const binary = vals.length > 0 && vals.every(v => v === 0 || v === 1);
      const agg: Agg = binary && RATE_HINT.test(c.name) ? 'rate' : 'avg';
      const integer = vals.every(v => Number.isInteger(v));
      const additivity = agg === 'rate' || NON_ADDITIVE_HINT.test(c.name) ? 'non_additive' : 'additive';
      return { id: c.name, dataset: datasetId, label: humanize(c.name), role: 'measure', expr: c.name, type: 'number', agg, additivity, format: agg === 'rate' ? 'percent' : integer && vals.some(v => Math.abs(v) >= 100) ? 'integer' : 'number' } as Field;
    }
    return { id: c.name, dataset: datasetId, label: humanize(c.name), role: 'dimension', expr: c.name, type: c.type } as Field;
  });
}

/** Curated fields first, then inferred ones for columns nobody described yet. */
export function fieldsFor(ws: Workspace, datasetId: string, table: Table | undefined): Field[] {
  const curated = ws.fields.filter(f => f.dataset === datasetId);
  const ids = new Set(curated.map(f => f.id));
  const inferred = inferFields(datasetId, table).filter(f => !ids.has(f.id));
  // A curated field keeps its place; inferred ones follow in column order.
  return [...curated.map(f => ({ ...f, type: f.type || (table?.columns.find(c => c.name === f.expr)?.type ?? 'number') })), ...inferred];
}

export interface ResolvedMeasure {
  label: string; expr: string; agg: Agg; format: Format; polarity: 'higher' | 'lower' | 'neutral'; fieldId?: string;
  /** Row weight expression in effect (query weight, else the field's default). */
  weight?: string;
  /** Ratio measures: denominator expression. */
  denominator?: string;
  additivity: 'additive' | 'semi_additive' | 'non_additive';
}

const WEIGHTABLE = new Set<Agg>(['avg', 'rate', 'sum', 'count', 'median']);
export const weightable = (a: Agg) => WEIGHTABLE.has(a);

/** Turn a measure reference into what the engine and the SQL compiler need. queryWeight overrides a field's default weight. */
export function resolveMeasure(m: MeasureRef, fields: Field[], queryWeight?: string): ResolvedMeasure | null {
  // A query weight names a weight field or is an expression of its own.
  const qw = queryWeight && queryWeight.trim() ? fieldExpr(queryWeight.trim(), fields) : undefined;
  const fmtFor = (agg: Agg, f?: Field): Format => agg === 'count' || agg === 'count_values' || agg === 'count_distinct' ? 'integer' : agg === 'rate' ? 'percent' : f?.format || 'number';
  const addFor = (agg: Agg, f?: Field) => agg === 'sum' || agg === 'count' || agg === 'count_values' ? 'additive' as const : f?.additivity === 'semi_additive' ? 'semi_additive' as const : agg === 'min' || agg === 'max' ? (f?.additivity || 'non_additive') : 'non_additive' as const;
  if (m.expr && m.expr.trim()) {
    const f = m.field ? fields.find(x => x.id === m.field) : undefined;
    const agg = m.agg || 'avg';
    return { label: m.label || m.expr, expr: m.expr.trim(), agg, format: fmtFor(agg, f), polarity: f?.polarity || 'neutral', weight: weightable(agg) ? qw : undefined, denominator: agg === 'ratio' ? (m.denominator || '1') : undefined, additivity: addFor(agg, f) };
  }
  if (m.agg === 'count' && !m.field) return { label: m.label || 'count', expr: '1', agg: 'count', format: 'integer', polarity: 'neutral', weight: qw, additivity: 'additive' };
  const f = fields.find(x => x.id === m.field);
  if (!f) return null;
  const agg = m.agg || f.agg || (f.role === 'measure' ? 'avg' : 'count_distinct');
  const weight = weightable(agg) ? (qw || (f.weight && f.weight.trim()) || undefined) : undefined;
  const denominator = agg === 'ratio' ? (m.denominator || f.denominator || '1') : undefined;
  const label = m.label || (agg === 'count' ? 'count' : f.label);
  return { label, expr: f.expr, agg, format: fmtFor(agg, f), polarity: f.polarity || 'neutral', fieldId: f.id, weight, denominator, additivity: addFor(agg, f) };
}

/** A filter or group-by names a field id or a raw column; both resolve to an expression. */
export function fieldExpr(name: string, fields: Field[]): string {
  const f = fields.find(x => x.id === name);
  return f ? f.expr : name;
}

/** Which columns an expression needs, and which of them this table lacks. */
export function missingColumns(expr: string, table: Table | undefined): string[] {
  if (!table) return [];
  try {
    const have = new Set(table.columns.map(c => c.name));
    return [...columnsOf(compile(expr))].filter(c => !have.has(c));
  } catch { return []; }
}

export function fieldType(name: string, fields: Field[], table?: Table): ColumnType {
  const f = fields.find(x => x.id === name);
  if (f && !isBareColumn(f.expr)) return f.type;
  const col = table?.columns.find(c => c.name === (f ? f.expr : name));
  return col?.type || f?.type || 'string';
}

export function aggLabel(a: Agg) {
  return ({ sum: 'sum', avg: 'average', median: 'median', p25: '25th percentile', p75: '75th percentile', iqr: 'middle-half spread (p75 − p25)', min: 'min', max: 'max', count: 'count of rows', count_values: 'count of values', count_distinct: 'distinct count', rate: 'rate', ratio: 'ratio of sums' } as Record<Agg, string>)[a];
}
