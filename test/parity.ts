// Builds both seed workspaces in Node, runs every query with the local engine, compiles the same
// queries to DuckDB SQL, and writes everything for test/parity_check.py to compare.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import type { Query, Table, Workspace } from '../src/core/types';
import { loadItem } from '../src/core/load';
import { buildAll } from '../src/core/ingest';
import { run } from '../src/core/engine';
import { compileQuery, compileDataset, tableName } from '../src/core/sql';
import { lolWorkspace } from '../src/seeds/lol';
import { fieldTrialsWorkspace } from '../src/seeds/fieldtrials';

const require_ = createRequire(import.meta.url);
const XLSX = require_('xlsx');
const ROOT = process.argv[2];
const OUT = process.argv[3];
const PROJECT = '/mnt/project-files/';
const useProject = process.argv[4] === 'project';

const toAB = (b: Buffer) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

function writeTable(dir: string, name: string, t: Table) {
  const esc = (v: unknown) => v == null ? '\\N' : /[",\n\r]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v);
  const lines = [t.columns.map(c => esc(c.name)).join(',')];
  for (const r of t.rows) lines.push(t.columns.map(c => esc(r[c.name])).join(','));
  writeFileSync(join(dir, name + '.csv'), lines.join('\n'));
  return { name, file: name + '.csv', columns: t.columns };
}

function extras(wsId: string): Query[] {
  const base = { measures: [], groupBy: [], filters: [], last: 0, compare: { kind: 'none' }, followDashboard: false } as unknown as Query;
  const Q = (o: Partial<Query> & { id: string; dataset: string }) => ({ ...base, name: o.id, ...o }) as Query;
  if (wsId === 'fieldtrials') return [
    Q({ id: 'x_having', dataset: 'plots', measures: [{ field: 'yield_t_ha' }, { field: 'area_ha' }], groupBy: [{ field: 'variety' }], having: [{ measure: 1, op: '>', value: 40 }], sort: 'value_desc' }),
    Q({ id: 'x_rollup1', dataset: 'plots', measures: [{ field: 'production_t' }, { field: 'yield_t_ha' }], groupBy: [{ field: 'farm' }], rollup: true, sort: 'key_asc' }),
    Q({ id: 'x_month', dataset: 'plots', measures: [{ field: 'yield_t_ha' }, { agg: 'count' }], groupBy: [{ field: 'planting_date', grain: 'month' }] }),
    Q({ id: 'x_quarter', dataset: 'plots', measures: [{ field: 'yield_plain' }], groupBy: [{ field: 'planting_date', grain: 'quarter' }, { field: 'crop' }] }),
    Q({ id: 'x_roll', dataset: 'plots', measures: [{ field: 'yield_t_ha' }], series: { op: 'rolling', window: 12 } }),
    Q({ id: 'x_cum_ratio', dataset: 'plots', measures: [{ field: 'yield_ratio' }], series: { op: 'cumulative', window: 5 } }),
    Q({ id: 'x_last_prev', dataset: 'plots', last: 30, measures: [{ field: 'yield_t_ha' }], compare: { kind: 'previous' } }),
    Q({ id: 'x_paired', dataset: 'plots', measures: [{ field: 'yield_t_ha' }], compare: { kind: 'paired', expr: 'yield_t_ha * 0.9', label: '90%' } }),
    Q({ id: 'x_in_contains', dataset: 'plots', filters: [{ field: 'crop', op: 'in', value: 'Maize, Wheat' }, { field: 'variety', op: 'contains', value: 'a' }], measures: [{ field: 'n_applied_kg_ha' }, { field: 'soil_ph' }, { agg: 'count_distinct', expr: 'variety' }] }),
    Q({ id: 'x_minmax', dataset: 'plots', measures: [{ agg: 'min', expr: 'yield_t_ha' }, { agg: 'max', expr: 'yield_t_ha' }, { agg: 'median', expr: 'yield_t_ha' }, { agg: 'count_values', expr: 'corrected_by' }], groupBy: [{ field: 'crop' }] }),
    Q({ id: 'x_weather', dataset: 'weather_monthly', measures: [{ agg: 'avg', expr: 'rain_mm' }], groupBy: [{ field: 'month' }] }),
    Q({ id: 'x_expr_fns', dataset: 'plots', measures: [{ agg: 'avg', expr: "if(crop = 'Maize', yield_t_ha * 2, nullif(yield_t_ha, 0))" }, { agg: 'sum', expr: 'round(area_ha / 3, 1)' }] }),
  ];
  return [
    Q({ id: 'x_g_having', dataset: 'games', filters: [{ field: 'queue', op: '=', value: '420' }], measures: [{ field: 'win' }, { agg: 'count' }], groupBy: [{ field: 'champion' }], having: [{ measure: 1, op: '>=', value: 5 }], sort: 'value_desc' }),
    Q({ id: 'x_g_topn', dataset: 'games', measures: [{ field: 'kda_ratio' }], groupBy: [{ field: 'position' }, { field: 'champion' }], minRows: 3, sort: 'value_desc', limit: 2 }),
    Q({ id: 'x_g_rollup', dataset: 'games', measures: [{ field: 'cs_per_min_tw' }, { field: 'win' }], groupBy: [{ field: 'account_name' }, { field: 'position' }], rollup: true, sort: 'key_asc' }),
    Q({ id: 'x_g_weight_role', dataset: 'games', measures: [{ field: 'win' }, { field: 'kda' }], weight: 'w_main_role', groupBy: [{ field: 'account_name' }] }),
    Q({ id: 'x_g_weight_sum', dataset: 'games', measures: [{ agg: 'sum', expr: 'kills' }, { agg: 'count' }], weight: 'w_learning_curve' }),
    Q({ id: 'x_g_week', dataset: 'games', measures: [{ agg: 'count' }], groupBy: [{ field: 'game_start_utc', grain: 'week' }], sort: 'key_asc' }),
    Q({ id: 'x_g_roll_grouped', dataset: 'games', measures: [{ field: 'cs_per_min' }], groupBy: [{ field: 'position' }], series: { op: 'rolling', window: 10 } }),
    Q({ id: 'x_g_ref_plain', dataset: 'games', filters: [{ field: 'queue', op: '=', value: '420' }], measures: [{ field: 'deaths' }], compare: { kind: 'reference', dataset: 'lobby_players', filters: [], weightBy: [], label: 'all lobby players' } }),
    Q({ id: 'x_lp_group', dataset: 'lobby_players', measures: [{ agg: 'avg', expr: 'deaths' }, { agg: 'count' }], groupBy: [{ field: 'queue_name' }] }),
  ];
}

async function main() {
  const report: unknown[] = [];
  for (const ws of [fieldTrialsWorkspace(), lolWorkspace()] as Workspace[]) {
    const dir = join(OUT, ws.id); mkdirSync(dir, { recursive: true });
    const items: Record<string, Table | undefined> = {};
    const itemOut: unknown[] = [];
    for (const it of ws.items) {
      const st = await loadItem(ws, it, async (src, item) => {
        if (src.kind === 'bundled') return toAB(readFileSync(join(ROOT, 'public', src.base || '', item.path || '')));
        if (src.kind === 'project') { if (!useProject) throw Object.assign(new Error('skipped'), { code: 'not_found' }); return toAB(readFileSync(join(PROJECT, src.base || '', item.path || ''))); }
        throw new Error('no provider for ' + src.kind);
      }, XLSX);
      items[it.id] = st.table;
      if (st.table) itemOut.push({ id: it.id, ...writeTable(dir, 'src_' + it.id, st.table) });
      else console.error(`${ws.id}/${it.id}: ${st.error}`);
    }
    // A feed that did not load (for example the League snapshot, which is not committed) is
    // skipped by the engine; SQL still names its table, so give it an empty one with a sibling
    // feed's columns. An empty feed and a missing feed build the same rows.
    for (const ds of ws.datasets) for (const f of ds.feeds) {
      if (items[f.itemId]) continue;
      const sib = ds.feeds.map(x => items[x.itemId]).find(Boolean);
      if (sib && !itemOut.some(o => (o as { id: string }).id === f.itemId)) itemOut.push({ id: f.itemId, ...writeTable(dir, 'src_' + f.itemId, { columns: sib.columns, rows: [] }) });
    }
    const built = buildAll(ws, items);
    const tables: Record<string, Table | undefined> = {};
    const dsOut: unknown[] = [];
    for (const [id, b] of Object.entries(built)) {
      tables[id] = b.table;
      if (b.errors.length) console.error(`${ws.id}/${id}:`, b.errors);
      dsOut.push({ id, sqlName: tableName(id), rows: b.table.rows.length, ...writeTable(dir, 'ds_' + id, b.table),
        buildSql: compileDataset(ws, ws.datasets.find(d => d.id === id)!, items, tables, 'duckdb').replace(/CREATE TABLE \S+ AS/, '').replace(/;\s*$/, ''),
        sequence: ws.datasets.find(d => d.id === id)!.sequence, key: ws.datasets.find(d => d.id === id)!.key });
    }
    const cases: unknown[] = [];
    for (const q of [...ws.queries, ...extras(ws.id)]) {
      const r = run({ ws, tables }, q);
      const sql = compileQuery(ws, tables, q, undefined, 'duckdb');
      cases.push({
        id: q.id, name: q.name, sql,
        engine: {
          n: r.n, values: r.values, series: r.series?.map(p => p.v),
          groups: r.groups?.map(g => ({ keys: g.keys, n: g.n, values: g.values })),
          totals: r.totals?.map(g => ({ keys: g.keys, n: g.n, values: g.values, total: g.total })),
          compare: r.compare?.value ?? null, grouped: q.groupBy.length > 0, seriesOp: q.series?.op || 'none',
          weightedMedian: r.measures.some(m => m.weight && m.agg === 'median'), warnings: r.warnings,
        },
      });
    }
    report.push({ ws: ws.id, items: itemOut, datasets: dsOut, cases });
  }
  writeFileSync(join(OUT, 'cases.json'), JSON.stringify(report, null, 1));
  console.log('wrote', join(OUT, 'cases.json'));
}
main().catch(e => { console.error(e); process.exit(1); });
