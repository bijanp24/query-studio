# Social: cards for Reels and X

Social is a separate, phone-first page at **https://bijanp24.github.io/query-studio/social/** (also the **Social** button in the app's top bar). It takes the main analyses and turns each into a card you can save as an image and post. There is nothing to configure: three choices and a button.

1. **Pick a story.**
   - *Me vs my lobby*: my stats against the median of the players I met (CS/min, kill participation, damage, gold, solo kills, deaths, vision), then two farming cards: CS/min climbs with rank, and farming barely moves win rate.
   - *Who I get matched with*: the rank of everyone I met against the NA ladder (median and shape), sample vs population (1,000 random groups of NA players never reach my lobbies' median), and the mode (the rank I meet most).
   - *Spot a review bomb*: the same mode tools on 1 to 5 star reviews of a made-up game. The 1-star share jumps, dropping accounts under 30 days old removes the spike, and the average hides all of it.
2. **Pick a size.** *Reel* is 1080 × 1920 (9:16) for Instagram Reels, Stories and TikTok. Text stays clear of the bottom and right edge, where Instagram puts its caption and buttons. *Square* is 1080 × 1080 (1:1) for X and the Instagram feed.
3. **Pick a look** at the top: *Auto* follows the phone's light or dark setting, or choose *Light*, *Dark* or *Pop* (yellow and pink).

Under each card, switch the chart between **Rows**, **Columns** and **Big number**; every card works in every style. **Get image** makes the PNG at full size. On a phone, press and hold it to save it to Photos, or tap **Share…** to send it straight to Instagram or X. **Download PNG** saves the file on a computer.

## The data

The cards use sample data only, built by `scripts/make_social_sample.mjs` from the published sample in `public/data/` into `src/social/sample.json` (aggregates only, no per-player rows). Other players are hashed there, and the review game is synthetic. Rerun the script after a snapshot refresh and rebuild; the numbers and headlines update together.

| Card | Built from |
| --- | --- |
| Me vs my lobby | `lobby_relative.csv`: takinturrets against the median of lobby players with 10+ ranked games |
| CS/min by rank | `player_games.csv`: median CS/min in lane games (supports left out) by the player's current tier, and my median from `my_matchups.csv` |
| Farming vs win rate | Players with 15+ lane games, grouped by their mean CS/min; groups of 50+ players |
| Rank vs ladder | `met_rank_today.csv` against `ladder.csv` (1.68M NA accounts) |
| Sample vs population | 1,000 random draws of 1,784 players from the ladder (the effective size of the ~8,900 met: players in one game share a rank), median of each |
| The mode | Most common divisions among players met, with their ladder share |
| Review bomb | `examples/reviews.csv`, Starfall Tactics before and after the patch, and after dropping accounts under 30 days old |
