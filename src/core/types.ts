// The stored model. Everything a user builds is one of these plain JSON objects, so a workspace
// exports as one document and every client (web today, mobile later, a server compiling SQL) reads
// the same shapes.
//
//   Source ──< SourceItem ──feeds──> Dataset (processed layer) ──> Fields (dimensions + measures)
//                                                                     │
//                                     Dashboard ──< Tile ──> Visualization ──> Query

export type Value = string | number | null;
export type Row = Record<string, Value>;

export type ColumnType = 'number' | 'string' | 'time';

export interface Column { name: string; type: ColumnType }
export interface Table { columns: Column[]; rows: Row[] }

/** Where data comes from. Kinds marked "server" need the backend described in ARCHITECTURE.md. */
export type SourceKind =
  | 'upload'      // a CSV, JSON or Excel file the user added (kept in the artifact's asset store or this browser)
  | 'project'     // a file in a Claude project folder (the Riot pipeline's processed layer lives here)
  | 'bundled'     // a file published with the app (snapshots, examples)
  | 'url'         // any https URL the runtime may fetch (server-side in production)
  | 'manual'      // rows typed or clicked in the app: highlights, weights, tags, corrections
  | 'postgres' | 'redshift' | 'snowflake' | 'bigquery' | 'duckdb'; // warehouse connectors (server)

export type FileFormat = 'csv' | 'json' | 'excel';

export interface Source {
  id: string;
  name: string;
  kind: SourceKind;
  description?: string;
  /** Base path or connection string, depending on kind. */
  base?: string;
  /** Example sources are labeled in the UI so nobody mistakes them for real records. */
  example?: boolean;
}

/** One table inside a source: a file, a sheet, a JSON array, or (later) a warehouse table or SQL query. */
export interface SourceItem {
  id: string;
  sourceId: string;
  name: string;
  format: FileFormat;
  /** File path relative to the source base, or asset id for uploads. */
  path?: string;
  assetId?: string;
  localKey?: string;
  /** Excel: sheet name (default first). */
  sheet?: string;
  /** JSON: dot path to the array of records, '' for the root. Arrays nested inside records are exploded. */
  jsonPath?: string;
  /** JSON: nested array to explode into one row per element, parent fields copied down. */
  explode?: string;
  /** Manual items: the rows themselves, edited in the app (highlights and weights live here). */
  rows?: Row[];
  /** Manual items: the key columns that tie a row to a dataset row. */
  keyColumns?: string[];
  /** Manual items: declared columns, so an empty table still has its shape. */
  schema?: Column[];
  /** Warehouse items (server): a table name or a SQL statement. */
  table?: string;
  sql?: string;
}

/** A feed is one item contributing rows to a dataset. Lower priority number wins. */
export interface Feed {
  itemId: string;
  priority: number;
  /** Rename item columns into the dataset's names: {itemColumn: datasetColumn}. */
  rename?: Record<string, string>;
  /** Only rows matching these filters feed the dataset. */
  filters?: Filter[];
  /** Use this feed only when no higher-priority feed loaded (a snapshot behind a live source). */
  fallback?: boolean;
}

export interface Lookup {
  /** Item or dataset id to join from. */
  from: string;
  /** Pairs of [this dataset column, lookup column]. */
  on: [string, string][];
  columns: string[];
  prefix?: string;
}

/**
 * A computed column. Plain ones are an expression per row. Window ones run along the dataset's
 * sequence within each partition (SQL window functions): row_number gives "the Nth game on this
 * champion", running_sum / running_avg accumulate expr, lag reads expr from the previous row.
 */
export interface DerivedColumn {
  name: string;
  expr: string;
  window?: { fn: 'row_number' | 'running_sum' | 'running_avg' | 'lag'; partitionBy?: string[] };
  /** Compute before lookups, so a lookup can join on it (planting_month for a monthly weather table). */
  early?: boolean;
}

/**
 * A dataset is one table of the processed layer. It is built from feeds in priority order:
 * rows are stacked by column name, rows that share the key keep the highest-priority version
 * (mode 'replace') or take that version and fill its empty cells from lower-priority rows
 * (mode 'coalesce'). Lookups then add columns from other tables, and derived columns are computed
 * per row. The same definition compiles to SQL for a warehouse.
 */
export interface Dataset {
  id: string;
  name: string;
  description?: string;
  feeds: Feed[];
  key?: string[];
  mode?: 'replace' | 'coalesce';
  lookups?: Lookup[];
  derived?: DerivedColumn[];
  /** Column that orders rows in time; "last N" and series operators use it. */
  sequence?: string;
  /** What one row is, in plain words: "game", "player", "plot". Used in labels like "50 games". */
  grain?: string;
}

/** p25 / p75 are the 25th and 75th percentiles (SQL PERCENTILE_CONT); iqr is p75 − p25, the spread of the middle half. */
export type Agg = 'sum' | 'avg' | 'median' | 'p25' | 'p75' | 'iqr' | 'min' | 'max' | 'count' | 'count_values' | 'count_distinct' | 'rate' | 'ratio';
/**
 * How a measure rolls up. Additive measures (CS, kills, area, value×area) sum across any dimension;
 * semi-additive ones (a balance, a rank snapshot) sum across some dimensions but not time;
 * non-additive ones (averages, rates, ratios, percentages) never sum and are computed at query time
 * from additive parts: a weighted average is sum(x·w)/sum(w), a ratio is sum(numerator)/sum(denominator).
 */
export type Additivity = 'additive' | 'semi_additive' | 'non_additive';
export type Format = 'number' | 'integer' | 'percent' | 'decimal1' | 'decimal2';
export type Polarity = 'higher' | 'lower' | 'neutral';

/** A dimension is something to slice by; a measure is something to aggregate. */
export interface Field {
  id: string;            // unique within the dataset; also how queries refer to it
  dataset: string;
  label: string;
  /** weight fields are row-weight expressions offered under "Weight rows by" (learning curve, role, duration). */
  role: 'dimension' | 'measure' | 'weight';
  /** Expression over the dataset's columns; a bare column name for plain fields. */
  expr: string;
  type: ColumnType;
  agg?: Agg;             // measures: default aggregation
  format?: Format;
  polarity?: Polarity;
  additivity?: Additivity;
  /** Default weight for this measure, an expression (area_ha, duration_min). Averages become sum(x·w)/sum(w). */
  weight?: string;
  /** agg 'ratio': the denominator expression; the value is sum(expr)/sum(denominator) over rows where both exist. */
  denominator?: string;
  hidden?: boolean;      // left out of builders unless "show hidden fields" is on (rank in the League model)
  description?: string;
}

export type FilterOp = '=' | '!=' | '>' | '<' | '>=' | '<=' | 'in' | 'contains' | 'is_null' | 'not_null';
export interface Filter { field: string; op: FilterOp; value: string }

export type TimeGrain = 'none' | 'hour' | 'day' | 'weekday' | 'week' | 'month' | 'quarter' | 'year';
export interface GroupBy { field: string; grain?: TimeGrain }

export type SeriesOp = 'none' | 'rolling' | 'delta' | 'slope' | 'cumulative';

export interface MeasureRef {
  /** A model field id, or omitted when expr is given inline (a derived measure). */
  field?: string;
  expr?: string;
  label?: string;
  agg?: Agg;
  /** Inline ratio measures: denominator expression. */
  denominator?: string;
}

/**
 * The "compared to" number on a tile.
 * - previous: the same query over the N rows before the last N
 * - target: a fixed number
 * - paired: another measure over the same rows (my CS/min vs my lane opponent's, opp_cs_per_min)
 * - reference: the same measure over another dataset (a reference population), optionally
 *   weighted by this query's own mix of one or more dimensions so the comparison is like for like
 *   (lobby players in the same role, weighted by how often I play each role)
 */
export type Compare =
  | { kind: 'none' }
  | { kind: 'previous' }
  | { kind: 'target'; value: number; label?: string }
  | { kind: 'paired'; field?: string; expr?: string; label?: string }
  | { kind: 'reference'; dataset: string; filters?: Filter[]; weightBy?: string[]; label?: string };

export interface Query {
  id: string;
  name: string;
  dataset: string;
  measures: MeasureRef[];
  groupBy: GroupBy[];
  filters: Filter[];
  /** Keep only the last N rows by the dataset's sequence column before aggregating (0 = all). */
  last: number;
  sort?: 'value_desc' | 'value_asc' | 'count_desc' | 'key_asc';
  /** Keep the top N groups (by the sort above); with two dimensions, the top N of the second within each first. */
  limit?: number;
  /** Group filters, applied after aggregation (SQL HAVING): measure index, operator, value. */
  having?: { measure: number; op: '>' | '<' | '>=' | '<=' | '=' | '!='; value: number }[];
  /** Minimum rows a group needs to be shown (a common HAVING COUNT(*) >= n). */
  minRows?: number;
  /** Add subtotal rows per first dimension and a grand total (SQL ROLLUP). */
  rollup?: boolean;
  series?: { op: SeriesOp; window: number };
  compare: Compare;
  /**
   * Weight each row in every aggregate: an expression over the row (duration_min, area_ha,
   * coalesce(highlight_weight, 1)). Averages become sum(w*x)/sum(w), sums sum(w*x), counts sum(w).
   * Empty = every row counts once. Tiles always say when a result is weighted.
   */
  weight?: string;
  /** Apply the dashboard's filters when the dataset has those fields. */
  followDashboard: boolean;
}

export type VizType =
  | 'kpi' | 'gauge' | 'bar' | 'column' | 'line' | 'area' | 'hist' | 'scatter'
  | 'heatmap' | 'table' | 'sparktable' | 'trend' | 'card' | 'profile' | 'ribbon';

export interface CardColumn {
  label: string;
  /** self: this query's rows; paired: a column on the same rows named by pattern;
   *  reference: the same column over another dataset, weighted by weightBy. */
  kind: 'self' | 'paired' | 'reference';
  pattern?: string;          // e.g. 'opp_{f}', 'opp_rel_{alias}'
  dataset?: string;
  filters?: Filter[];
  weightBy?: string[];
  signed?: boolean;          // show +/-
}
export interface CardRow { label: string; field: string; alias?: string; polarity?: Polarity }

export interface Visualization {
  id: string;
  name: string;
  queryId: string;
  type: VizType;
  color: number;             // palette slot 1-8
  width: 2 | 3 | 4 | 6;      // of a 6-column grid
  window?: number;           // rolling window for line, area, trend, sparktable
  stack?: boolean;
  labels?: boolean;
  x?: string;                // scatter: x field
  note?: string;
  card?: { rows: CardRow[]; columns: CardColumn[] };
}

export interface Tile { id: string; vizId: string; width?: 2 | 3 | 4 | 6 }

export interface Dashboard {
  id: string;
  name: string;
  description?: string;
  filters: Filter[];
  last?: number;             // overrides every following query's "last N" when set
  tiles: Tile[];
}

/**
 * A suggested question shown under the Ask box. It guides a user toward the questions the
 * workspace answers well. vizId points at a saved visualization that already answers it, so the
 * suggestion works without the model; the text alone goes to Ask.
 */
export interface Suggestion { text: string; vizId?: string }

export interface Workspace {
  id: string;
  name: string;
  description?: string;
  domainNotes?: string;      // vocabulary handed to Ask ("games = the user's own games ...")
  example?: boolean;
  sources: Source[];
  items: SourceItem[];
  datasets: Dataset[];
  fields: Field[];
  queries: Query[];
  visualizations: Visualization[];
  dashboards: Dashboard[];
  suggestions?: Suggestion[];
  activeDashboard?: string;
  seedVersion?: number;
  updatedAt?: string;
}
