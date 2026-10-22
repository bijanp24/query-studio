# Read the sample vs population test

The players you meet are a sample of the ladder, never the ladder itself. Even a perfectly random draw of 8,900 players would not match the ladder bin for bin, so the useful question is not "is my distribution the ladder?" but "is my distribution one that a realistic sample could produce?". The **Sample vs population** dashboard answers that with a simulation.

## How it works

The tile type is **Sample vs population** (`sampling`). It takes the same query as a distribution tile (one group-by, the bins, and a count) and a reference population. Then, for each null population:

1. Draw 1,000 samples of the same size as yours.
2. Compute the median, quartiles, middle half (IQR), mean, skew and shape distance of each.
3. See where your own numbers fall among them. The 95% range is where 95% of realistic samples land; p is how often a realistic sample is at least as far out as yours.

Two kinds of null:

- **Random players** (`population`): a simple random sample of the ladder. Your lobbies are not expected to pass this, because matchmaking picks players near your rating. It shows how far your lobbies are from the ladder as a whole, and the grey rows show how wide the median of one lobby (10 players), 100 and 1,000 random players is.
- **Rank-matched** (`matched`): the ladder near a center, with a spread in divisions. This is the null that fits matchmaking. The center can be your own shown rank (read from *My rank over time*), a number, or fitted to your sample. The spread can be a number or fitted. A fitted statistic is marked *fitted* and cannot reject; only the others test anything.

## Clustered by game

Players met in the same game share its lobby, so they are not independent draws: 56% of the rank variance in your games is between games, with about 8 other ranked players per game, which gives a design effect of about 1 + 7 × 0.56 ≈ 5. **Clustered by game** (the default) draws samples at your size divided by 5, which widens every band. **Every player independent** uses the full size and is too optimistic.

## Reading the result

- *Not a realistic sample: the middle is off* means the median is outside what that null produces.
- *Middle fits, the spread or shape does not* means the center is fine but the IQR, skew or shape is not.
- *Looks like a realistic sample* means nothing was rejected at 5%.

The dashed lines on the median chart mark other positions worth comparing: the smurf-adjusted median from [the smurf test](smurf-test.md) and your own shown rank.

Rejecting "centered on my rank" says your lobbies were built around a different rating than the rank you show today, which is what matchmaking on hidden MMR does when MMR and rank drift apart. It does not by itself say why.

## For your own data

Any table with an ordered dimension works: group a query by it, add a reference dataset counted into the same bins, pick the `sampling` type and add nulls in the visualization editor. Center and spread are in bins (0 = the bottom of the first bin).
