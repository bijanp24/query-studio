# Read the smurf test

Two dashboards in the League of Legends workspace look at smurfs: players whose shown rank is below the level they really play at.

## Smurf test: both hypotheses

Every investigated player is tested twice, once under each assumption:

- **H0, not a smurf:** they play at their shown rank.
- **H1, a smurf:** they play well above it.

Each piece of evidence (shown rank against the rest of the lobby, account level, season win rate, CS per minute and KDA against the role baselines for their tier) gets a probability under each hypothesis. The reference groups are real players from your own lobbies wherever possible; anything that is an assumption rather than data is marked `assumed` in the basis column.

- **Evidence weight** is log10 of the likelihood ratio. +1 means the evidence is ten times likelier if they are a smurf, −1 ten times likelier if not.
- **p-value if NOT a smurf** asks how often an honest player at that rank shows evidence this smurf-like. Below 0.05 rejects H0 on that item.
- **p-value if a smurf** asks the reverse. Below 0.05 rejects H1.
- **Chance of a smurf** combines the items from a 9% prior and from even odds. It treats the items as independent, which they are not quite, so read it as an upper bound on certainty.

Neither hypothesis rejected means the evidence cannot decide. That outcome is reported as plainly as a rejection.

The tables come from `data/scripts/hypothesis_test.py`, which `investigate_player.py` now runs at the end of every investigation, and `data/scripts/smurf_qs_export.py`, which hashes every player name before the tables reach the app.

## Smurfs and the median

The median rank of the players you meet is robust: a smurf moved from below the median to exactly the median does not move it at all. The sweep shows how far it can move when a share of the players below the median are really better than their shown rank:

- **A.** Smurfs land exactly on the median: no change.
- **B.** Smurfs land at the level of the lobbies they were met in.
- **C.** Smurfs land anywhere above the median.
- **Upper bound.** Every smurf lands above the new median, so the median becomes the old (50 + share)th percentile.

The lobby-gap chart compares each player's rank with the median of the other nine in the same game, split into established accounts and new ones. The shape table asks whether a rank distribution that looks symmetric could still hide that many smurfs.
