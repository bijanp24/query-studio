# Query Studio

A self-serve query, visualization and dashboard builder over a warehouse-style semantic layer (dimensions and measures). Data sources feed a processed layer by priority; custom queries feed visualizations; visualizations make up dashboards.

The first build is a single-page web app with two example workspaces: League of Legends match history, and synthetic crop field trials loaded from CSV, Excel and nested JSON. It runs on claude.ai as an artifact; Ask (natural-language queries) and live project files need that runtime, and everything else also works in a plain browser.

Every push to main deploys the static build to GitHub Pages (`.github/workflows/pages.yml`). That copy opens on the field-trials example, because the League snapshot is not published, and Ask and live project files show a note that they need claude.ai.

The League workspace includes a "Player profile" dashboard: Baseline, Consistency, Peak and Trend for any measure, with suggested questions under the Ask box that guide new users.

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

The League snapshot (`public/data/lol/`) is not committed because it is built from match data. Rebuild it with `python3 scripts/make_snapshot.py`, which replaces other players' Riot IDs and PUUIDs with hashes.

## Layout

- `src/core/`: types, parsing, expression language, processed-layer build (`ingest.ts`), semantic layer, query engine, SQL compiler
- `src/app/`: React screens and charts
- `src/seeds/`: the two example workspaces
- `scripts/`: build and data preparation
- `test/`: parity test and browser smoke test
