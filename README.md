# Query Studio

A self-serve query, visualization and dashboard builder over a warehouse-style semantic layer (dimensions and measures). Data sources feed a processed layer by priority; custom queries feed visualizations; visualizations make up dashboards.

The first build is a single-page web app with two example workspaces: League of Legends match history, and synthetic crop field trials loaded from CSV, Excel and nested JSON. It runs on claude.ai as an artifact; Ask (natural-language queries) and live project files need that runtime, and everything else also works in a plain browser.

Every push to main deploys the static build to GitHub Pages (`.github/workflows/pages.yml`). That copy opens on the field-trials example; pick League of Legends in the workspace menu for the sample League data. Ask and live project files show a note that they need claude.ai.

The League workspace includes a "Player profile" dashboard: Baseline, Consistency, Peak and Trend for any measure, with suggested questions under the Ask box that guide new users. "Who I play: rank distribution" draws the rank of everyone a player has met against the whole NA ladder, and "Rank tracking" follows those players and the user's own accounts across rank snapshots.

**New here? Read the [user guide](docs/guide/README.md)**: getting started, loading your own data, building queries, choosing visualizations, assembling dashboards, Ask, the Player profile, and running it locally. The app links to it from the **Guide** button in the top bar.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the object model, processed layer, semantic layer, query engine, SQL compiler and the player-profile measures.

## Develop

```
npm ci
npm run typecheck
npm run build        # writes dist/index.html plus dist/data, shaped for a claude.ai artifact
PAGES=1 npm run build  # the same page as a complete document for static hosting
npm run smoke        # headless Chromium run over every screen (needs Playwright)
npm run parity       # engine vs DuckDB SQL; needs Python duckdb and the Claude project files
```

The League snapshot in `public/data/lol/` is sample data: seven CSVs from the processed layer as of 2026-10-18 (308 of the author's games, 49,240 player-game rows), with other players' Riot IDs and PUUIDs replaced by short hashes. Rebuild it with `python3 scripts/make_snapshot.py <processed dir> public/data/lol`.

## Layout

- `src/core/`: types, parsing, expression language, processed-layer build (`ingest.ts`), semantic layer, query engine, SQL compiler
- `src/app/`: React screens and charts
- `src/seeds/`: the two example workspaces
- `scripts/`: build and data preparation
- `test/`: parity test and browser smoke test
