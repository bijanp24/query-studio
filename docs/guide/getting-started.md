# Getting started

[← Guide contents](README.md)

## Open the app

Go to **https://bijanp24.github.io/query-studio/**. It opens on the Field trials example. Nothing needs installing and there is no sign-in; your changes are saved in your browser (see [Where it runs](where-it-runs.md)).

## The screen

![The top bar, tabs and a dashboard](../images/fieldtrials-dashboard.png)

**Top bar, left to right:**

- **Workspace menu**: switch between League of Legends, Field trials and any workspace you created. It also has **+ New workspace…** and **Import a workspace file…**.
- **Data line**: where the data came from, such as "4 source tables" or "Published snapshot". In the League workspace on claude.ai it also offers **read live files** (see [Where it runs](where-it-runs.md)).
- **show hidden fields**: reveals fields the workspace keeps out of the pickers on purpose, such as rank in the League workspace.
- **Saved state**: "Saving…", then "Saved in this browser" or "Saved to your account".
- **Guide**: opens this guide in a new tab.
- **Export**: downloads the whole workspace as a JSON file you can import elsewhere.
- **Reset** (examples only): throws away your changes and restores the example. **Delete** appears instead on workspaces you created.

**Tabs:**

| Tab | What you do there |
| --- | --- |
| Dashboards | Look at results; arrange tiles; filter everything at once; Ask. |
| Queries | Build and edit the questions behind every tile. |
| Visualizations | Choose how a query is drawn and add notes. |
| Data sources | Upload files or type small tables. |
| Datasets | Merge tables, add computed columns, check what was kept. |
| Semantic model | Name fields, set how each measure adds up, define weights. |

Most people live in the first three tabs. The last three are for setting up a new subject.

## A five-minute tour

1. **Read a dashboard.** On the Field trials dashboard, look at "Rainfall over zones A, B, C": 575 mm weighted by area against 1,000 mm as a simple average. That gap is why weights exist.
2. **Open the query behind a tile.** Click **ƒ** in the tile's corner. You land on the Queries tab with that query open, and its result previews on the right.
3. **Change it.** Pick a different measure, add a filter, or set **Group by** to a column. The preview updates as you type.
4. **Draw it differently.** Back on the dashboard, click **✎** on the tile to open its visualization and pick another type.
5. **Switch to League.** Choose **League of Legends** in the workspace menu. The League workspace opens on the "Lobby lens (no rank)" dashboard; use the dashboard menu to try "Player profile" or "Trends & improvement".
6. **Try a suggested question.** Under the Ask box, click a chip such as "My baseline, consistency, peak and trend". A chip with a saved answer opens instantly, even off claude.ai.

## The example workspaces

**League of Legends** has seven datasets: My games (one row per game you played, with your lane opponent's numbers alongside), My games: lobby strength, Lobby players' games (recent games of everyone who shared a lobby with you, the population you are compared against), Players met, Lobby-relative players, and champion and tier baselines. Its dashboards:

| Dashboard | What it shows |
| --- | --- |
| Lobby lens (no rank) | You against your lane opponents and against lobby players in the same role, without using rank. |
| Trends & improvement | Whether CS, win rate, vision and leads are rising, with rolling, change and running-total views. |
| Showcase & weights | The same stats with different weighting rules: learning curve, game length, your own highlights. |
| Player profile | Baseline, Consistency, Peak and Trend, plus where the players you meet sit on the ladder. |
| Champions & matchups | Win rate by champion, matchups, and a weekday-by-hour heatmap. |

The published League data is a sample: one player's games with every other player's name replaced by a short code.

**Field trials** is invented crop data: plots from a CSV, hand corrections from an Excel sheet that override the sensor values, monthly weather from nested JSON, and a small typed-in table of rainfall zones. Use it to see how merging, weighting and the player card work on data that has nothing to do with games.

## Your first change is safe

Everything you change in an example is saved as your own copy. **Reset** in the top bar puts the example back. If the app has a newer version of an example than the copy you saved, a banner offers **Reset to it** or **Keep mine**.

Next: [Bring your own data](your-data.md)
