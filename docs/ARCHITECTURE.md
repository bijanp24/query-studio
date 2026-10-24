# Query Studio web: architecture

Written 2026-10-14 by the "Query Studio web app" thread. Live build: https://claude.ai/artifact/JjmujLFdTSnNVPPUfQnkkw
Source: this repository (unpack, `npm install`, `node scripts/build.mjs`; the 11 MB League snapshot under `public/data/lol` is left out, so rebuild it with `python3 scripts/make_snapshot.py`, which hashes other players' Riot IDs). This note covers what the web build does and how; the wider suite plan is in `notes/architecture/query-studio-architecture-brief.md` and `notes/query-studio-enterprise-roadmap.md` (both in the Claude project files).

## Stack

- React 18.3.1 and TypeScript 5.6, bundled by esbuild into one HTML page. No UI framework and no chart library: the 13 visual types are hand-written SVG components.
- SheetJS 0.18.5 is loaded from cdnjs the first time an Excel file is opened.
- No DuckDB-WASM in the browser. The artifact sandbox will not fetch the wasm from a CDN, and the file is too large to inline. The browser therefore runs its own engine (`src/core/engine.ts`), and a SQL compiler (`src/core/sql.ts`) emits the same plan for warehouses. A parity test checks that both give the same numbers.
- Storage uses the artifact's per-user database: one document per workspace at `data/users/<id>/ws_<id>`, split into 100k-character parts. Uploaded files are stored the same way under `up_<item>`. When the database is unavailable it falls back to localStorage.

## Object model (`src/core/types.ts`)

The model is a chain:

```
Source → SourceItem (a table) → Dataset (processed layer) → Fields (semantic layer)
       → Query (= "data source item" in the UI) → Visualization → Dashboard (N tiles)
```

Every link is by id, so any query can feed any visualization and any visualization can sit on any dashboard. A Workspace holds the whole chain, so League is just one workspace. The field-trials workspace is the proof: synthetic crop trials loaded from a CSV, an Excel sheet and a nested JSON weather feed, with no League code involved.

### Sources and items

**Source kinds**:

- `bundled`: published next to the page.
- `project`: Claude project files, read live as the viewer.
- `upload`: CSV, JSON or Excel.
- `manual`: typed or clicked in the app.
- `url`.
- Warehouse kinds: `postgres`, `redshift`, `snowflake`, `bigquery`, `duckdb`.

The warehouse and URL kinds are placeholders that need the query server.

**Items**: an item is one table within a source. That can be a file, an Excel sheet, a JSON array path (nested arrays are exploded into one row each, with the parent's fields copied down), or later a warehouse table or SQL statement.

**Parsing**: everything becomes the same `Table` shape, and column types are inferred.

### Datasets: the processed layer (`src/core/ingest.ts`)

A dataset is built from one or more feeds in **priority order** (1 wins). A dataset has:

- **Feeds**: each feed can rename columns, filter rows, and be marked `fallback`, meaning it is only read when every higher-priority feed is empty. This is how the League workspace uses live project files first and the published snapshot otherwise.
- **Key**: rows that share the key collapse into one row. Mode `replace` keeps the highest-priority row. Mode `coalesce` keeps that row and fills its empty cells from lower-priority rows; this is how agronomist corrections override sensor readings.
- **Lookups**: left joins from another item or dataset. Datasets build in dependency order.
- **Derived columns**: computed per row with the expression language. **Window** columns run along the dataset's sequence within each partition (`row_number`, `running_sum`, `running_avg`, `lag`). The learning-curve feature is a window column: `champ_game_no` is the row number per champion. `early` columns are computed before the lookups, so a lookup can join on them.

Rows are ordered by the sequence, then the key, with nulls first. The SQL build uses the same order, so "last N" and window functions agree on ties.

Lineage stats are recorded per feed: rows in, rows kept, rows replaced and cells filled. The Datasets screen shows them.

### Semantic layer (`src/core/semantic.ts`)

Fields come in three roles:

- **Dimension**: something to slice by.
- **Measure**: has a default aggregation, a format, a polarity (higher or lower is better), an **additivity** (additive, semi-additive or non-additive), an optional default **weight**, and, for ratios, a **denominator**.
- **Weight**: a row-weight expression offered under "Weight rows by", such as the learning curve, main role, support half, game length or my highlights.

Columns that no curated field describes are inferred: numbers become measures and everything else becomes a dimension. A new file is therefore queryable as soon as it loads, and curating a field overrides the inferred one by id. Hidden fields, such as rank, are left out of the pickers and out of Ask unless "show hidden fields" is on.

### Expression language (`src/core/expr.ts`)

- A safe parser with no `eval`.
- Syntax: columns, numbers, strings, arithmetic, comparisons, and `and`/`or`/`not`.
- Functions: `if`, `decode`, `coalesce`, `nullif`, `split_part`, `min`/`max` (row-wise), `round`, `abs`, `log`, `hour`/`weekday`/`date`/`month`/`year`, and others.
- Each expression has two outputs: JavaScript evaluation with null propagation, and SQL text per dialect. Division compiles to `CAST(a AS DOUBLE PRECISION) / NULLIF(b, 0)`.

## Query execution (`src/core/engine.ts`)

The logical order matches SQL:

```
FROM dataset → WHERE (query + dashboard filters) → last N by sequence
→ per-row parts (x, weight w, denominator d)
→ GROUP BY ≤ 2 dimensions (time grains: hour, day, weekday, week, month, quarter, year)
→ aggregate → HAVING and minimum rows → ORDER BY → top N (per first dimension when there are two)
→ ROLLUP subtotals and grand total over every selected row
→ series operator along the sequence (rolling, Δ vs previous window, slope per 10 rows, running total)
→ comparison value
```

- **Weighted aggregates** are computed at query time from additive parts: avg = Σx·w / Σw, sum = Σx·w, count = Σw, plus a weighted median. A row with a NULL value or a NULL weight drops from both the numerator and the denominator. **Ratio** = Σx / Σd, taken over rows where both are present. "CS per min, time-weighted" and "yield, production ÷ area" are ratios.
- **Weights come from rules**: a weight field or any formula, for example `if(champion = 'Riven' and champ_game_no > 150, 2, 1)`. Tiles always say when a result is weighted and show the unweighted value next to it.
- **Highlights**: the Rows tab of the query builder edits the manual "Game highlights" table in place, with ★ weights, tags and notes. The `games` dataset joins that table back on, so "My highlights" weighting and `highlighted = 1` filters use it immediately.
- **Comparisons**:
  - `previous`: the N rows before the last N.
  - `target`: a fixed number.
  - `paired`: another column on the same rows, such as the lane opponent's.
  - `reference`: the same measure over another dataset, weighted by this query's own mix of the chosen dimensions. "Lobby players, same role" weights the lobby by how often you play each role. Grouped results also get a per-group reference.
- **Percentiles**: `p25`, `p75` and `iqr` (p75 − p25) use linear interpolation, the same as SQL `PERCENTILE_CONT`. They are not weightable.
- Results are cached per build and per query definition.

## Player profile: Baseline, Consistency, Peak, Trend (`src/core/profile.ts`)

Four numbers for any measure over rows in sequence (a player over their games, a plot over its seasons):

- **Baseline**: the measure over every row, with the query's own aggregation and weights.
- **Consistency**: the middle half (p25 to p75). For a median, percentile, min or max it is taken over single rows; for an average, rate, sum or ratio it is taken over rolling windows, because a single game's win is 0 or 1.
- **Peak**: the best rolling window, by the measure's polarity, with the row it ends on. It sits above the baseline by luck alone, so it is always shown next to the baseline.
- **Trend**: the least-squares slope per 100 rows with a t-based 95% range. A verdict (improving / declining, or rising / falling for neutral measures) is given only when the range excludes zero.

Two tile types use it: **Player card** (`profile`, one card per measure) and **Ribbon** (`ribbon`, the rolling baseline with each window's middle half shaded and the peak ringed). The tile's rolling window sets the window size.

## Distribution against a population (`src/core/distribution.ts`)

The **Distribution vs a population** tile (`distribution`) takes a query grouped by one field (the bins) with a count or an additive measure, and counts a reference dataset into the same bins (`Visualization.dist`: dataset, an optional row weight such as the accounts in a ladder division, filters, label). Bins follow the dimension's `sortBy` expression (`rank_step` puts "Iron IV" … "Challenger" in ladder order). From the binned counts alone it reads the same four ideas as the player card, for a cross-section instead of a sequence: Baseline = the bin holding the median and the reference percentile it falls at, Consistency = the bins holding the 25th and 75th percentiles, Peak = the most common bin, plus the shift from the reference median in percentile points and the probability of superiority (ties counted half). Percentiles inside a bin are interpolated linearly. Ask can build it (`visualization.reference`). The plain histogram now shades the middle half and reads out the median, middle half, most common bin and mean.

## Mode and frequency ranking (`src/core/mode.ts`)

The **Mode and frequency ranking** tile (`mode`) reuses the distribution's binning (`distOf`, so the same query shape and the same `Visualization.dist` reference) and adds: every bin ranked by count (1st = the mode) with its running share, its place in the reference and the lift (share ÷ reference share); a chance band per bin from seeded multinomial samples of the reference (`Visualization.mode`: `effN` or `deff` for clustered rows, `level` default 99%, `sims` default 1,000) with the rows above or below the band; peaks (local maxima that stand at least 10% of the top share above the dip on each side) for the group and the reference; and Sarle's bimodality coefficient over bin positions. `modeFindings` turns the summary into the sentences printed under the chart. Nothing in it is specific to ranks: the Reviews example workspace (`src/seeds/reviews.ts`, data from `scripts/make_reviews.mjs`) runs it on 1-to-5 star ratings.

The `mode` aggregate (most common value, weighted when the query has a weight, ties to the smallest) is in the engine and compiles to `MODE() WITHIN GROUP (ORDER BY x)` (DuckDB, PostgreSQL) or `APPROX_TOP_COUNT` (BigQuery); Redshift has no mode aggregate and the SQL view says so.

## Flow between two states (`src/core/flow.ts`)

The **Flow** tile (`flow`) takes a query grouped by two fields, where rows started and where they ended up, with a count, and shows where each starting category went. With 12 categories or fewer it draws bands from left to right; with more, a matrix of row shares. When both fields have a `sortBy`, each move is up, down or stayed, and the readout gives those shares plus the category that gained and the one that lost the most. The League "Rank tracking" dashboard uses it for tier and division flow between rank snapshots.

League datasets behind it: `met_players` (everyone met, rank today), `ladder` (the NA solo-queue ladder per division), `rank_tracking` (players met per rank snapshot; lag columns give each player's change since their previous snapshot) and `my_rank` (the user's accounts over time). `scripts/make_snapshot.py` writes them with other players' Riot IDs and PUUIDs hashed.

**Suggested questions**: a workspace can list `suggestions`, shown as chips under the Ask box. A suggestion with a `vizId` opens that saved visualization at once, with no model call, and can be added to the dashboard or opened in the builder; one without goes to Ask. The League workspace's "Player profile" dashboard and its suggestions are built on these; `lobby_level` uses each player's rank as of the pull until daily rank snapshots exist.

## SQL path (`src/core/sql.ts`)

- `compileQuery` emits the main statement, the totals statement (ROLLUP) and the compare statement for DuckDB, PostgreSQL, Redshift and BigQuery.
- Top-N per group uses `ROW_NUMBER()`.
- Series operators use portable window frames. The slope is built from running sums, so no `REGR_SLOPE` is needed.
- `compileDataset` emits the processed-layer build as one `CREATE TABLE … AS WITH`: a UNION ALL of feeds with explicit columns, then `ROW_NUMBER` replace or first-non-null coalesce, the fallback `NOT EXISTS`, early derived columns, joins, and late derived and window columns.
- Every query has a SQL tab with a dialect picker, and every dataset has a "Build SQL" section.
- The weighted median has no portable SQL form, and the SQL tab says so.
- Percentiles compile to `QUANTILE_CONT` in DuckDB, `PERCENTILE_CONT … WITHIN GROUP` in PostgreSQL and Redshift, and `APPROX_QUANTILES` in BigQuery, where it is approximate.

**Parity test**: `test/parity.ts` builds both workspaces from the live project files, runs every seed query plus extra cases through the engine, and dumps the tables and compiled SQL. `test/parity_check.py` runs the SQL in DuckDB 1.5.6 and compares. The latest run passed 74 of 74: 10 dataset builds and 64 queries, covering weights, ratios, percentiles, HAVING, ROLLUP, top-N per group, every series operator, every compare kind, time grains and expression functions.

## Ask (`src/app/askModel.ts`)

- The prompt carries every dataset:
  - grain, sequence and row count
  - each field's role, aggregation, additivity, default weight, denominator and polarity
  - up to 10 sample values for each text dimension
  - the workspace's domain notes
- It also gives the full Query shape: WHERE vs HAVING, minRows, top-N per group, ROLLUP, series windows, weights, ratios, compare kinds, and the function list.
- The model returns a Query plus a visualization. `validateAnswer` checks every field, formula, weight and dataset against the catalog, repairs what it can, says what it dropped, and refuses the rest.
- The result previews in place and can then be added to a dashboard, saved, or opened in the builder.
- Ask runs through the artifact's `sample` capability, so it works on claude.ai and is hidden elsewhere.

## Screens

- **Dashboards**: drag-and-drop, plus ← → buttons for touch. Tile widths are ⅓, ½, ⅔ or full. Dashboard filters apply to every query that follows them, and a dashboard can override "last N". There is an add-tile drawer and an Ask box.
- **Queries**: the builder, with live preview, result table, SQL and editable rows.
- **Visualizations**: type, color, width, rolling window, scatter axis, stacking, notes, and the comparison-card editor.
- **Data sources**: status and lineage, upload with Excel sheet and JSON path pickers, typed tables, and connector placeholders.
- **Datasets**: feeds, key and merge mode, lookups, derived and window columns, the build result, and the build SQL.
- **Semantic model**: curate fields; add measures, dimensions and weighting schemes.
- **Workspace menu**: switch, create, import or export JSON, and reset an example.

## Known limits

- **Browser scale**: everything runs in memory. Each upload is capped at 8 MB of text, and the League snapshot is 10 MB. Bigger data belongs in a warehouse source behind the query server.
- **Learning-curve counts** cover only the pulled history, not lifetime games. Riot's champion-mastery endpoint could be a future source.
- **Live project files**: they are read only after the viewer turns "read live files" on and grants access. Otherwise the published snapshot is used, with other players' Riot IDs and PUUIDs replaced by hashes.
- **Excel examples** are published as base64 text, because the artifact host does not serve .xlsx files. Uploads convert the chosen sheet to CSV.

## Next steps toward production

1. A query server: the same Query JSON goes in, `compileQuery` runs against Redshift or Postgres, and results come back with credentials held server-side.
2. Scheduled API sources (Riot, weather) that write into the processed layer by priority.
3. Shared workspaces with roles, which replace per-user documents.
4. Ask runs server-side, with the catalog as tools and cost limits.
