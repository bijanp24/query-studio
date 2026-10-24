// A third example built from the same parts: synthetic 1-to-5 star reviews of two games and a movie,
// one of them review-bombed. It shows the mode tools on a short ordinal scale, where a burst of fake
// ratings shows up as a second peak that the mean and median smooth over.
import type { Dashboard, Field, Filter, Query, Visualization, Workspace } from '../core/types';

export function reviewsWorkspace(): Workspace {
  const F = (id: string, label: string, o: Partial<Field> = {}): Field => ({ id, dataset: 'reviews', label, role: 'measure', expr: id, type: 'number', agg: 'avg', format: 'decimal2', polarity: 'neutral', additivity: 'non_additive', ...o });
  const D = (id: string, label: string, o: Partial<Field> = {}): Field => ({ id, dataset: 'reviews', label, role: 'dimension', expr: id, type: 'string', ...o });
  const fields: Field[] = [
    D('title', 'title'), D('kind', 'game or movie'), D('star_label', 'rating', { sortBy: 'stars' }), D('period', 'before or after 2026-09-15'),
    D('review_date', 'review date', { type: 'time' }), D('account_group', 'reviewer account'),
    F('reviews', 'reviews', { expr: '1', agg: 'sum', format: 'integer', additivity: 'additive' }),
    F('stars', 'average stars', { polarity: 'higher' }),
    F('stars_median', 'median stars', { expr: 'stars', agg: 'median', polarity: 'higher' }),
    F('stars_mode', 'most common stars', { expr: 'stars', agg: 'mode', format: 'integer', polarity: 'higher', description: 'The rating given most often (ties: the lower one). A review bomb can flip it to 1 star in the weeks of the burst while the average only dips.' }),
    F('new_account', 'reviews from accounts under 30 days old', { agg: 'rate', format: 'percent' }),
    F('playtime_hours', 'playtime at review (hours), median', { agg: 'median', format: 'decimal1' }),
    F('review_words', 'review length (words), median', { agg: 'median', format: 'integer' }),
    F('account_age_days', 'reviewer account age (days), median', { agg: 'median', format: 'integer' }),
  ];
  const SF: Filter = { field: 'title', op: '=', value: 'Starfall Tactics' };
  const AFTER: Filter = { field: 'period', op: '=', value: 'after 2026-09-15' }, BEFORE: Filter = { field: 'period', op: '=', value: 'before 2026-09-15' };
  const before = (title: string, label: string) => ({ dataset: 'reviews', filters: [{ field: 'title', op: '=' as const, value: title }, BEFORE], label });
  const Q = (o: Partial<Query> & Pick<Query, 'id' | 'name'>): Query => ({ dataset: 'reviews', measures: [{ field: 'reviews' }], groupBy: [{ field: 'star_label' }], filters: [], last: 0, compare: { kind: 'none' }, followDashboard: true, ...o });
  const V = (o: Partial<Visualization> & Pick<Visualization, 'id' | 'name' | 'queryId' | 'type'>): Visualization => ({ color: 1, width: 6, ...o });
  const queries: Query[] = [
    Q({ id: 'r_sf_after', name: 'Starfall Tactics after the patch, by rating', filters: [SF, AFTER] }),
    Q({ id: 'r_sf_clean', name: 'Starfall Tactics after the patch, accounts 30 days or older', filters: [SF, AFTER, { field: 'account_age_days', op: '>=', value: '30' }] }),
    Q({ id: 'r_sf_new', name: 'Starfall Tactics after the patch, accounts under 30 days', filters: [SF, AFTER, { field: 'account_age_days', op: '<', value: '30' }] }),
    Q({ id: 'r_sf_week', name: 'Starfall Tactics: most common, median and average stars by week', groupBy: [{ field: 'review_date', grain: 'week' }], filters: [SF, { field: 'review_date', op: '>=', value: '2026-07-01' }],
      measures: [{ field: 'stars_mode' }, { field: 'stars_median' }, { field: 'stars' }], sort: 'key_asc' }),
    Q({ id: 'r_sf_week_avg', name: 'Starfall Tactics: average stars by week', groupBy: [{ field: 'review_date', grain: 'week' }], filters: [SF, { field: 'review_date', op: '>=', value: '2026-07-01' }],
      measures: [{ field: 'stars' }], sort: 'key_asc' }),
    Q({ id: 'r_sf_who', name: 'Starfall Tactics: who wrote the reviews, by week', groupBy: [{ field: 'review_date', grain: 'week' }], filters: [SF, { field: 'review_date', op: '>=', value: '2026-07-01' }],
      measures: [{ field: 'new_account' }], sort: 'key_asc' }),
    Q({ id: 'r_sf_groups', name: 'Starfall Tactics after the patch: new accounts vs established', groupBy: [{ field: 'account_group' }], filters: [SF, AFTER],
      measures: [{ field: 'reviews' }, { field: 'stars' }, { field: 'stars_mode' }, { field: 'playtime_hours' }, { field: 'review_words' }, { field: 'account_age_days' }] }),
    Q({ id: 'r_hl_after', name: 'Harbor Lights after 2026-09-15, by rating', filters: [{ field: 'title', op: '=', value: 'Harbor Lights' }, AFTER] }),
    Q({ id: 'r_ir', name: 'Ironclad Rally, by rating', filters: [{ field: 'title', op: '=', value: 'Ironclad Rally' }] }),
  ];
  const vizs: Visualization[] = [
    V({ id: 'rv_sf_after', name: 'Starfall Tactics after the patch vs before', queryId: 'r_sf_after', type: 'mode', dist: before('Starfall Tactics', 'Starfall before the patch'),
      note: 'The mode is still 5 stars, but a second peak at 1 star has appeared, far above what random samples of the earlier reviews allow. The rows over the band are the burst to explain before trusting the average.' }),
    V({ id: 'rv_sf_week', name: 'Starfall Tactics by week: most common stars', queryId: 'r_sf_week', type: 'line', width: 3, color: 1,
      note: 'The weekly mode drops from 5 stars to 1 in the week of the burst.' }),
    V({ id: 'rv_sf_week_avg', name: 'Starfall Tactics by week: average stars', queryId: 'r_sf_week_avg', type: 'line', width: 3, color: 1,
      note: 'The average only dips, and a dip like this could as well be a patch players dislike.' }),
    V({ id: 'rv_sf_new', name: 'Only accounts under 30 days old', queryId: 'r_sf_new', type: 'mode', width: 3, color: 2, dist: before('Starfall Tactics', 'Starfall before the patch') }),
    V({ id: 'rv_sf_clean', name: 'Cleaned: accounts 30 days or older', queryId: 'r_sf_clean', type: 'mode', width: 3, color: 3, dist: before('Starfall Tactics', 'Starfall before the patch'),
      note: 'Drop the new accounts and one peak is left. The established players still rate the patch a little lower than before: that is criticism, not bombing, and cleaning should keep it.' }),
    V({ id: 'rv_sf_who', name: 'Share of reviews from accounts under 30 days, by week', queryId: 'r_sf_who', type: 'column', width: 3, color: 2 }),
    V({ id: 'rv_sf_groups', name: 'Who wrote them: new accounts vs established', queryId: 'r_sf_groups', type: 'table', width: 3 }),
    V({ id: 'rv_hl', name: 'Control: Harbor Lights after 2026-09-15 vs before', queryId: 'r_hl_after', type: 'mode', width: 3, color: 7, dist: before('Harbor Lights', 'Harbor Lights before'),
      note: 'Nothing happened to this movie, and the test says so: one peak, every bin inside the band.' }),
    V({ id: 'rv_ir', name: 'Disliked, not bombed: Ironclad Rally vs other games', queryId: 'r_ir', type: 'mode', width: 3, color: 4,
      dist: { dataset: 'reviews', filters: [{ field: 'kind', op: '=', value: 'game' }, { field: 'title', op: '!=', value: 'Ironclad Rally' }, BEFORE], label: 'other games' },
      note: 'The mode is 1 star and the low bins are far above other games, but there is one peak sliding down from it and the reviewers are established players with real playtime. A shifted distribution, not a second population.' }),
  ];
  const dashboards: Dashboard[] = [{ id: 'rd_bomb', name: 'Review bombing: the mode', description: 'Is a burst of 1-star reviews a review bomb or real criticism? The mode, the next most common rating, peaks and what chance allows, against the same title before.', filters: [], tiles: vizs.map((v, i) => ({ id: `rt_${i}`, vizId: v.id })) }];
  return {
    id: 'reviews', name: 'Reviews (example data)', example: true,
    description: 'Synthetic 1-to-5 star reviews of two games and a movie, one review-bombed after a patch. The same system as the other workspaces, with no review-specific code.',
    domainNotes: 'Domain: product reviews (synthetic example data). reviews = one row per review with title (Starfall Tactics, Ironclad Rally = games; Harbor Lights = movie), stars 1-5, star_label ("1 star" … "5 stars", ordered by stars), review_date, period (before / after 2026-09-15, when Starfall Tactics shipped a pricing patch), account_age_days, account_reviews, playtime_hours (games), review_words, verified. Rating distributions: query reviews, measures [reviews], groupBy star_label, visualization mode with reference reviews filtered to the same title before 2026-09-15. stars_mode = the most common rating.',
    sources: [{ id: 'store', name: 'Review export (CSV)', kind: 'bundled', base: 'data/examples/', example: true, description: 'A store\'s review export: one row per review.' }],
    items: [{ id: 'reviews_csv', sourceId: 'store', name: 'reviews.csv', format: 'csv', path: 'reviews.csv' }],
    datasets: [{
      id: 'reviews', name: 'Reviews', grain: 'review', sequence: 'review_date', key: ['review_id'], feeds: [{ itemId: 'reviews_csv', priority: 1 }],
      description: 'One row per review. Synthetic: Starfall Tactics is review-bombed for ten days after 2026-09-15 by accounts days old with no playtime.',
      derived: [
        { name: 'new_account', expr: 'if(account_age_days < 30, 1, 0)' },
        { name: 'account_group', expr: "if(account_age_days < 30, 'under 30 days old', '30 days or older')" },
      ],
    }],
    suggestions: [
      { text: 'Is Starfall Tactics being review-bombed?', vizId: 'rv_sf_after' },
      { text: 'Most common rating by week for Starfall Tactics', vizId: 'rv_sf_week' },
      { text: 'Ratings of Harbor Lights after September vs before', vizId: 'rv_hl' },
      { text: 'Which titles have two peaks in their ratings?' },
    ],
    fields, queries, visualizations: vizs, dashboards, activeDashboard: 'rd_bomb', seedVersion: 1,
  };
}
