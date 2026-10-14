// A non-League example built from the same parts: synthetic crop trials from three file formats.
// It exists to show the system is generic and to exercise area-weighted averages.
import type { Dashboard, Field, Query, Visualization, Workspace } from '../core/types';

export function fieldTrialsWorkspace(): Workspace {
  const F = (id: string, label: string, o: Partial<Field> = {}): Field => ({ id, dataset: 'plots', label, role: 'measure', expr: id, type: 'number', agg: 'avg', format: 'number', polarity: 'higher', additivity: 'non_additive', ...o });
  const D = (id: string, label: string, o: Partial<Field> = {}): Field => ({ id, dataset: 'plots', label, role: 'dimension', expr: id, type: 'string', ...o });
  const fields: Field[] = [
    D('farm', 'farm'), D('crop', 'crop'), D('variety', 'variety'), D('treatment', 'treatment'), D('season', 'season', { type: 'number' }),
    D('planting_date', 'planting date', { type: 'time' }), D('corrected_by', 'corrected by'),
    F('yield_t_ha', 'yield (t/ha), area-weighted', { weight: 'area_ha', description: 'An intensity: averaged by area, so a 30 ha field outweighs a 1 ha trial plot. Σ(yield × area) / Σ area.' }),
    F('yield_plain', 'yield (t/ha), simple average of plots', { expr: 'yield_t_ha', description: 'Every plot counts once regardless of size. Shown to make the difference visible.' }),
    F('yield_ratio', 'yield (t/ha), total production ÷ total area', { expr: 'production_t', agg: 'ratio', denominator: 'area_ha', description: 'The same number as the area-weighted average, built from two additive parts.' }),
    F('production_t', 'production (t)', { agg: 'sum', additivity: 'additive', format: 'integer' }),
    F('area_ha', 'area (ha)', { agg: 'sum', additivity: 'additive', format: 'decimal1' }),
    F('n_applied_kg_ha', 'nitrogen applied (kg/ha)', { weight: 'area_ha', polarity: 'neutral' }),
    F('soil_ph', 'soil pH', { weight: 'area_ha', polarity: 'neutral' }),
    F('planting_rain_mm', 'rain in planting month (mm)', { polarity: 'neutral' }),
    F('corrected', 'plots corrected by an agronomist', { agg: 'sum', format: 'integer', additivity: 'additive', polarity: 'neutral' }),
    { id: 'zones_rain', dataset: 'zones', label: 'rainfall (mm), area-weighted', role: 'measure', expr: 'rainfall_mm', type: 'number', agg: 'avg', weight: 'area_km2', format: 'integer', polarity: 'neutral', additivity: 'non_additive' },
    { id: 'zones_rain_plain', dataset: 'zones', label: 'rainfall (mm), simple average', role: 'measure', expr: 'rainfall_mm', type: 'number', agg: 'avg', format: 'integer', polarity: 'neutral', additivity: 'non_additive' },
  ];
  const Q = (o: Partial<Query> & Pick<Query, 'id' | 'name'>): Query => ({ dataset: 'plots', measures: [], groupBy: [], filters: [], last: 0, compare: { kind: 'none' }, followDashboard: true, ...o });
  const V = (o: Partial<Visualization> & Pick<Visualization, 'id' | 'name' | 'queryId' | 'type'>): Visualization => ({ color: 3, width: 3, window: 10, labels: true, ...o });
  const queries: Query[] = [
    Q({ id: 'f_yield', name: 'Yield, area-weighted vs simple average', measures: [{ field: 'yield_t_ha' }, { field: 'yield_plain' }, { field: 'yield_ratio' }] }),
    Q({ id: 'f_zones', name: 'Rainfall over three zones (from the area-weighting notes)', dataset: 'zones', measures: [{ field: 'zones_rain' }, { field: 'zones_rain_plain' }] }),
    Q({ id: 'f_variety', name: 'Yield by variety, area-weighted', measures: [{ field: 'yield_t_ha' }], groupBy: [{ field: 'variety' }], sort: 'value_desc' }),
    Q({ id: 'f_treat', name: 'Yield by crop and treatment', measures: [{ field: 'yield_t_ha' }], groupBy: [{ field: 'crop' }, { field: 'treatment' }] }),
    Q({ id: 'f_farm_crop', name: 'Production and area by farm and crop, with subtotals', measures: [{ field: 'production_t' }, { field: 'area_ha' }, { field: 'yield_ratio' }], groupBy: [{ field: 'farm' }, { field: 'crop' }], rollup: true, sort: 'key_asc' }),
    Q({ id: 'f_heat', name: 'Yield by farm and crop', measures: [{ field: 'yield_t_ha' }], groupBy: [{ field: 'farm' }, { field: 'crop' }] }),
    Q({ id: 'f_n', name: 'Maize yield vs nitrogen applied', filters: [{ field: 'crop', op: '=', value: 'Maize' }], measures: [{ field: 'yield_plain' }] }),
    Q({ id: 'f_season', name: 'Maize yield vs the 2024 season', filters: [{ field: 'crop', op: '=', value: 'Maize' }, { field: 'season', op: '=', value: '2025' }], measures: [{ field: 'yield_t_ha' }], compare: { kind: 'reference', dataset: 'plots', filters: [{ field: 'crop', op: '=', value: 'Maize' }, { field: 'season', op: '=', value: '2024' }], weightBy: ['variety'], label: '2024, same variety mix' } }),
    Q({ id: 'f_top', name: 'Best two varieties per crop (fields of 1 ha or more)', filters: [{ field: 'area_ha', op: '>=', value: '1' }], measures: [{ field: 'yield_t_ha' }], groupBy: [{ field: 'crop' }, { field: 'variety' }], sort: 'value_desc', limit: 2 }),
  ];
  const vizs: Visualization[] = [
    V({ id: 'fv_yield', name: 'Yield: area-weighted, simple average, production ÷ area', queryId: 'f_yield', type: 'table', width: 3, note: 'Small trial plots get more care and yield more, so the simple average flatters the farm.' }),
    V({ id: 'fv_zones', name: 'Rainfall over zones A, B, C', queryId: 'f_zones', type: 'kpi', width: 3, note: 'The example from the notes: 575 mm weighted by area, 1,000 mm as a simple average.' }),
    V({ id: 'fv_variety', name: 'Yield by variety (area-weighted)', queryId: 'f_variety', type: 'bar', width: 3 }),
    V({ id: 'fv_treat', name: 'Yield by crop and treatment', queryId: 'f_treat', type: 'column', color: 1, width: 3 }),
    V({ id: 'fv_farm_crop', name: 'Production by farm and crop, with subtotals', queryId: 'f_farm_crop', type: 'table', width: 3 }),
    V({ id: 'fv_heat', name: 'Yield by farm × crop', queryId: 'f_heat', type: 'heatmap', width: 3 }),
    V({ id: 'fv_n', name: 'Maize: yield vs nitrogen', queryId: 'f_n', type: 'scatter', x: 'n_applied_kg_ha', color: 6, width: 3 }),
    V({ id: 'fv_season', name: 'Maize 2025 vs 2024', queryId: 'f_season', type: 'kpi', color: 4, width: 3 }),
    V({ id: 'fv_top', name: 'Top two varieties per crop', queryId: 'f_top', type: 'table', width: 3 }),
  ];
  const dashboards: Dashboard[] = [{ id: 'fd_main', name: 'Field trials', filters: [], tiles: vizs.map((v, i) => ({ id: `ft_${i}`, vizId: v.id })) }];
  return {
    id: 'fieldtrials', name: 'Field trials (example data)', example: true,
    description: 'Synthetic crop trials from a CSV, an Excel workbook and a JSON weather feed. The same system as the League workspace, with no League code.',
    domainNotes: 'Domain: agricultural field trials (synthetic example data). plots = one row per plot per season with farm, crop, variety, treatment, area_ha, yield_t_ha, n_applied_kg_ha, soil_ph, planting_rain_mm. Yield, nitrogen and pH are intensities: average them weighted by area_ha (their fields default to that). production_t and area_ha are additive. zones = the three-zone rainfall example.',
    sources: [
      { id: 'sensors', name: 'Field sensors (CSV)', kind: 'bundled', base: 'data/examples/', example: true, description: 'Combine yield monitor exports per plot.' },
      { id: 'agronomist', name: 'Agronomist corrections (Excel)', kind: 'bundled', base: 'data/examples/', example: true, description: 'Hand-checked yields that override the sensor value for the same plot.' },
      { id: 'weather', name: 'Weather service (JSON)', kind: 'bundled', base: 'data/examples/', example: true, description: 'Nested monthly readings per station.' },
      { id: 'notes', name: 'Typed in the app', kind: 'manual', description: 'Small tables entered by hand.' },
    ],
    items: [
      { id: 'plots_csv', sourceId: 'sensors', name: 'field_plots.csv', format: 'csv', path: 'field_plots.csv' },
      { id: 'corrections_xlsx', sourceId: 'agronomist', name: 'agronomist_corrections.xlsx · Corrections', format: 'excel', path: 'agronomist_corrections.xlsx', sheet: 'Corrections' },
      { id: 'weather_json', sourceId: 'weather', name: 'weather_stations.json · stations[].readings[]', format: 'json', path: 'weather_stations.json', jsonPath: 'stations', explode: 'readings' },
      { id: 'zones_manual', sourceId: 'notes', name: 'Rainfall zones', format: 'csv', keyColumns: ['zone'], rows: [{ zone: 'A', area_km2: 900, rainfall_mm: 500 }, { zone: 'B', area_km2: 50, rainfall_mm: 1200 }, { zone: 'C', area_km2: 50, rainfall_mm: 1300 }] },
    ],
    datasets: [
      {
        id: 'plots', name: 'Plots', grain: 'plot', sequence: 'planting_date',
        description: 'One row per plot per season. Agronomist corrections win over sensor readings for the same plot; empty cells fall through to the sensor value.',
        feeds: [{ itemId: 'corrections_xlsx', priority: 1 }, { itemId: 'plots_csv', priority: 2 }], key: ['plot_id'], mode: 'coalesce',
        lookups: [{ from: 'weather_monthly', on: [['farm', 'farm'], ['planting_month', 'month']], columns: ['rain_mm'], prefix: 'planting_' }],
        derived: [
          { name: 'planting_month', expr: 'month(planting_date)', early: true },
          { name: 'production_t', expr: 'yield_t_ha * area_ha' },
          { name: 'corrected', expr: "if(coalesce(corrected_by, '') = '', 0, 1)" },
        ],
      },
      { id: 'weather_monthly', name: 'Weather by month', grain: 'station-month', feeds: [{ itemId: 'weather_json', priority: 1 }], key: ['station_id', 'month'] },
      { id: 'zones', name: 'Rainfall zones', grain: 'zone', feeds: [{ itemId: 'zones_manual', priority: 1 }], key: ['zone'] },
    ],
    fields, queries, visualizations: vizs, dashboards, activeDashboard: 'fd_main', seedVersion: 1,
  };
}
