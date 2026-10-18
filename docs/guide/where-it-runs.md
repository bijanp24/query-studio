# Where it runs

[← Guide contents](README.md)

Query Studio is one web page. The same page runs in three places, and a few features depend on where.

| | GitHub Pages | Your own machine | claude.ai artifact |
| --- | --- | --- | --- |
| Address | https://bijanp24.github.io/query-studio/ | http://localhost:8080 (or the port you choose) | A claude.ai artifact link |
| Opens on | Field trials | Field trials | League of Legends |
| League sample data | Yes | Yes | Yes |
| Upload CSV, JSON, Excel | Yes | Yes | Yes |
| Query builder, visualizations, dashboards | Yes | Yes | Yes |
| Suggested questions with saved answers | Yes | Yes | Yes |
| Ask (typed questions) | No | No | Yes |
| Read live project files | No | No | Yes, after you turn on **read live files** |
| Your work is saved | In this browser | In this browser | To your claude.ai account |
| Export a workspace | Yes | Yes | Yes |

## GitHub Pages

The public copy at **https://bijanp24.github.io/query-studio/** updates every time a change is merged. Nothing to install. Your workspaces and uploads stay in your browser's storage: they survive reloads, but not clearing site data, a private window, or switching to another browser or device. Use **Export** to keep a copy.

## Your own machine

You need [Node.js](https://nodejs.org/) 20 or newer, Git, and Python 3 (only to serve the files).

```
git clone https://github.com/bijanp24/query-studio.git
cd query-studio
npm ci
```

Build the stand-alone page, then serve the `dist` folder:

macOS and Linux:

```
PAGES=1 npm run build
python3 -m http.server 8080 --directory dist
```

Windows (PowerShell):

```
$env:PAGES='1'; npm run build
python -m http.server 8080 --directory dist
```

Open **http://localhost:8080**. Opening `dist/index.html` straight from disk does not work, because the browser blocks the page from reading its data files; serve it as above. After pulling new changes, run the build again and reload.

**Your own League data.** The League workspace reads seven CSVs from `public/data/lol/` (`my_matchups`, `my_games`, `player_games`, `roster`, `lobby_relative`, `champion_baselines`, `tier_baselines`). The repository ships a sample. To use a newer processed layer, run `python3 scripts/make_snapshot.py <processed folder> public/data/lol`, which copies those files and replaces other players' Riot IDs with short codes, then build again.

## claude.ai

Published as an artifact on claude.ai, the page gains three things:

- **Ask** answers typed questions (see [Ask](ask.md)).
- **read live files** in the top bar reads the project's processed layer directly instead of the published snapshot. You are asked to allow it the first time. If the files cannot be read, the app says so and keeps using the snapshot.
- **Saved to your account**: workspaces and uploads are stored per person in the artifact, so they follow you between devices.

## Moving your work between places

Your saved queries, visualizations, dashboards and typed tables live in the workspace. To move them:

1. Click **Export** in the top bar. A `<workspace>-workspace.json` file downloads.
2. In the other place, choose **Import a workspace file…** in the workspace menu and pick the file.

An imported workspace that clashes with one you already have is added as "(imported)" rather than replacing it. Uploaded files are not inside the export, so datasets built on them come over empty. Upload the file again in the new place and point the dataset's feed at it on the Datasets tab.

## Privacy

Everything you upload is read and computed in your browser. Nothing is sent to a server, except a question you type into Ask on claude.ai, which goes to Claude together with a description of the workspace's fields and a few sample values.

[← Guide contents](README.md)
