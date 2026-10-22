# Track rank over time

Riot's API only returns a player's rank as of today. It has no history. So the only way to know what rank someone held when you met them, or where they were a month later, is to look them up on those days and keep the answers. The rank-history layer does this for everyone you meet and for your own accounts. Two dashboards in the League of Legends workspace read it.

## How the history is collected

- **Daily snapshot.** Once a day the pipeline looks up the current rank of every player you have met (`rank_snapshot.py`). Newly met players go first, then players whose next interval is due. That way, if the API key runs out partway through, the lookups that matter most are already done.
- **Every observation is kept.** `build_rank_history.py` collects the daily snapshots, your own accounts' pulls, cached lookups and full-ladder snapshots into one store that only grows. It runs with the hourly rebuild and needs no API calls.
- **Nothing is estimated.** A day the snapshot did not run is lost for good, because Riot cannot be asked later. The coverage tile shows those days.

## Intervals

Every player gets two anchors:

- **met**: the day of your first game together.
- **tracked**: the first day their rank was observed. For players you met before tracking started, this is the anchor that has data.

Each anchor is read back at the anchor itself, +2 weeks, +1 month, +3 months, +6 months, +1 year, and latest. Each reading has a status:

| Status | Meaning |
|---|---|
| observed | A snapshot on that exact day. |
| carried | No snapshot that day, but the player's ranked game count was the same in the snapshots before and after it. They played no games in between, so their rank could not have changed and is known exactly. |
| nearest | The closest snapshot within the tolerance (±3 days at 2 weeks, ±5 at 1 month, ±10 at 3 months, ±15 at 6 months, ±30 at 1 year). `days_off` says how far away it was. |
| missed | The window has closed with no snapshot in it. |
| pending | Not due yet. |
| before tracking | The date falls before the first snapshot. This can never be recovered, so these rows are left out of the file. |

## Rank history: one player

Pick a player with the **player** dashboard filter. By default it shows your main account. The tiles show:

- rank points over time (100 points per division, Gold IV = 1200)
- the Baseline, Consistency, Peak and Trend card for their ladder percentile
- their rank at every interval after the day you met them
- every spell observed: a run of days with the same rank and the same game count

## Rank history: everyone met

- **Ladder percentile at each interval**: the median and middle half of everyone met, at the anchor and at each later interval, with the share who climbed or fell a division or more.
- **Flow**: tier when first observed → tier now.
- **Divisions moved since first observed**, one value per player.
- **From the day met**: only players met after tracking started, so their rank on the day you met them was actually observed.
- **Coverage**: the share of everyone met whose rank was observed on each day, plus how each interval was filled.

## Hidden smurfs on any rank distribution

Any **Distribution vs a population** tile can show a what-if. Set **Hidden share** in the visualization editor, or drag the slider on the tile. The tile then reports how far the median could move if that share of the group is shown below the median but belongs above it. Smurfs are the obvious case. If they all land exactly on the median, it does not move. If they all land above it, it rises to the group's (50 + share)th percentile. Nothing in that calculation uses one particular player's data, so it works on any account's rank distribution and on any other ranked population. The "Smurfs and the median" dashboard opens with this tile.
