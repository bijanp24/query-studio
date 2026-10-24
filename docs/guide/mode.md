# The mode: what is most common, then the next

The **Mode and frequency ranking** tile answers three questions about any column with a short list of ordered values (star ratings, ranks, size classes, survey answers):

1. **What is most common, and what comes next?** The bars are drawn in their natural order, and the three most common are numbered 1, 2, 3. Under the chart, the ranking table goes all the way down: 1st, 2nd, 3rd and so on, with each value's share and the running total.
2. **Is there more than one peak?** A peak is a bar that stands clear of the dip on each side. The tile counts peaks and gives Sarle's bimodality coefficient (above 0.56 leans bimodal). Two peaks where the reference has one is the usual sign of a second population mixed into the data.
3. **Is any value more common than chance allows?** Pick a reference (another dataset, or the same dataset with filters, such as the same title before a date). The tile draws 1,000 random samples of the same size from the reference. The whisker on each bar shows the range that value's share takes in 99% of those samples. Values above the band are marked **more**, with the number of rows over the band: the rows a cleaning step would have to explain.

## Build one

1. Make a query grouped by one field (the values), with a count as the measure, for example *reviews by rating*.
2. Add a visualization of type **Mode and frequency ranking**.
3. Under **Compare with**, pick the reference dataset and give it filters if you need them (for example `title = Starfall Tactics` and `period = before 2026-09-15`).
4. If the rows come in clusters, set the **design effect** (or a fixed **effective sample size**). Players met in League games come ten per game, so they are less independent than their count suggests; a design effect of 5 draws the chance band at a fifth of the row count. Leave it empty for independent rows such as reviews from different people.

There is also a **mode** aggregate in the query builder (*most common value*, ties go to the smaller value). Use it on a time series, for example the most common star rating per week.

## Reading it

- **Two peaks are not proof.** Star ratings are often J-shaped: many 5s and a smaller pile of 1s. Compare with a reference that has the same habits (the same title earlier, or similar titles), and look at the peaks *and* the chance band together.
- **A mode at 1 star is not proof either.** A product people dislike has one peak that slides down from 1 star, written by established accounts. A review bomb adds a second, separate spike on top of the old shape, written by accounts with little history.
- **Bins with floors pile up.** Ranked ladders hold players at the bottom division of each tier (demotion protection), so the IV divisions are taller in every rank distribution. Read the rank mode against the ladder, which has the same floors.

## Examples

- **Reviews (example)** workspace, dashboard *Review bombing: the mode*: a synthetic review bomb, the same title cleaned of new accounts, a control movie where nothing happens, and a game that is disliked but not bombed.
- **League of Legends** workspace, dashboard *Who I play: the mode*: the rank you meet most often per account against the NA ladder, the mode by tier, and the mode on each rank snapshot day.
