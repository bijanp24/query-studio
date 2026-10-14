// The League of Legends workspace: the Riot pipeline's processed layer as sources, configured
// entirely through the generic model (no League-specific code anywhere in the engine).
import type { Compare, Dashboard, Field, Filter, Query, Source, SourceItem, Visualization, Workspace, Dataset } from '../core/types';

const RS: Filter[] = [{ field: 'queue', op: '=', value: 'Ranked Solo' }];
const LOBBY_ROLE: Compare = { kind: 'reference', dataset: 'lobby_players', filters: [{ field: 'queue_name', op: '=', value: 'Ranked Solo' }], weightBy: ['position'], label: 'lobby players, same role' };
const LOBBY_ROLE_CHAMP: Compare = { kind: 'reference', dataset: 'lobby_players', filters: [{ field: 'queue_name', op: '=', value: 'Ranked Solo' }], weightBy: ['position', 'champion'], label: 'lobby players, same role and champion' };
const opp = (col: string, label = 'my lane opponents, same games'): Compare => ({ kind: 'paired', field: col, label });

const FILES = ['my_matchups', 'my_games', 'player_games', 'roster', 'lobby_relative', 'champion_baselines', 'tier_baselines'];

export function lolWorkspace(): Workspace {
  const sources: Source[] = [
    { id: 'riot_project', name: 'Riot pipeline (project files)', kind: 'project', base: 'data/processed/latest/', description: 'The hourly processed layer the Riot API pull writes to the project folder. Live for project members.' },
    { id: 'riot_snapshot', name: 'Published snapshot', kind: 'bundled', base: 'data/lol/', description: 'A copy of the processed layer published with the app (2026-10-14), with other players\' Riot IDs and PUUIDs replaced by short hashes. Used when the project files cannot be read.' },
    { id: 'highlights', name: 'My highlights and weights', kind: 'manual', description: 'Games you starred or weighted in the app. Joined onto My games by account and match.' },
  ];
  const items: SourceItem[] = [];
  for (const f of FILES) {
    items.push({ id: `p_${f}`, sourceId: 'riot_project', name: `${f}.csv`, format: 'csv', path: `${f}.csv` });
    items.push({ id: `b_${f}`, sourceId: 'riot_snapshot', name: `${f}.csv`, format: 'csv', path: `${f}.csv` });
  }
  items.push({ id: 'game_highlights', sourceId: 'highlights', name: 'Game highlights', format: 'csv', keyColumns: ['account', 'match_id'], rows: [], schema: [{ name: 'account', type: 'string' }, { name: 'match_id', type: 'string' }, { name: 'highlight_weight', type: 'number' }, { name: 'tag', type: 'string' }, { name: 'note', type: 'string' }] });

  const both = (f: string, fallback = false) => [{ itemId: `p_${f}`, priority: 1 }, { itemId: `b_${f}`, priority: 2, ...(fallback ? { fallback: true } : {}) }];
  const datasets: Dataset[] = [
    {
      id: 'games', name: 'My games', grain: 'game', sequence: 'game_start_utc',
      description: 'One row per game you played (all your accounts), with your lane opponent, lobby-relative stats and second-degree baselines. Live rows win over the snapshot for the same account and match.',
      feeds: both('my_matchups'), key: ['account', 'match_id'], mode: 'replace',
      lookups: [
        { from: 'game_lobby', on: [['account', 'account'], ['match_id', 'match_id']], columns: ['ally_avg_top_pct', 'enemy_avg_top_pct'] },
        { from: 'game_highlights', on: [['account', 'account'], ['match_id', 'match_id']], columns: ['highlight_weight', 'tag', 'note'] },
      ],
      derived: [
        { name: 'account_name', expr: "split_part(account, '#', 1)" },
        { name: 'kda', expr: '(kills + assists) / max(deaths, 1)' },
        { name: 'hour_utc', expr: 'hour(game_start_utc)' },
        { name: 'weekday', expr: 'weekday(game_start_utc)' },
        { name: 'game_weight', expr: 'coalesce(highlight_weight, 1)' },
        { name: 'highlighted', expr: 'if(coalesce(highlight_weight, 1) > 1, 1, 0)' },
        { name: 'champ_game_no', expr: '1', window: { fn: 'row_number', partitionBy: ['champion'] } },
        { name: 'role_game_no', expr: '1', window: { fn: 'row_number', partitionBy: ['position'] } },
        { name: 'champ_experience', expr: "if(champ_game_no <= 10, '01-10', if(champ_game_no <= 25, '11-25', if(champ_game_no <= 50, '26-50', if(champ_game_no <= 150, '51-150', '151+'))))" },
        { name: 'hard_champion', expr: "decode(champion, 'LeeSin', 1, 'Riven', 1, 'Azir', 1, 'Gangplank', 1, 'Yasuo', 1, 'Qiyana', 1, 'Aphelios', 1, 'Kalista', 1, 0)" },
      ],
    },
    { id: 'game_lobby', name: 'My games: lobby strength', grain: 'game', sequence: 'game_start_utc', feeds: both('my_games'), key: ['account', 'match_id'], description: 'Average ladder position of allies and enemies per game (rank-based, hidden by default).' },
    {
      id: 'lobby_players', name: "Lobby players' games", grain: 'game', sequence: 'game_start_utc',
      description: 'Recent games of everyone who shared a lobby with you: the reference population for "players in my lobbies".',
      feeds: both('player_games', true), key: ['puuid', 'match_id'],
      derived: [
        { name: 'queue_name', expr: "decode(queue, 420, 'Ranked Solo', 440, 'Ranked Flex', 400, 'Normal Draft', 430, 'Normal Blind', 480, 'Swiftplay', 490, 'Quickplay', 450, 'ARAM', 'Other')" },
        { name: 'tier', expr: "split_part(rank, ' ', 1)" },
        { name: 'kda', expr: '(kills + assists) / max(deaths, 1)' },
      ],
    },
    { id: 'roster', name: 'Players met', grain: 'player', feeds: both('roster', true), key: ['puuid'], description: 'One row per player who shared a game with you: games together, record with and against, rank, level.', derived: [{ name: 'tier', expr: "split_part(rank, ' ', 1)" }] },
    { id: 'lobby_relative', name: 'Lobby-relative players', grain: 'player', feeds: both('lobby_relative', true), key: ['puuid'], description: 'Each player met (and your accounts): ranked-solo averages, their lead over their own lane opponents (rel_*), and what their opponents average (their_opp_*).' },
    { id: 'champion_baselines', name: 'Champion baselines', grain: 'role × champion', feeds: both('champion_baselines', true), key: ['position', 'champion'] },
    { id: 'tier_baselines', name: 'Tier baselines', grain: 'role × tier', feeds: both('tier_baselines', true), key: ['position', 'tier'] },
  ];

  const F = (dataset: string, id: string, label: string, o: Partial<Field> = {}): Field => ({ id, dataset, label, role: 'measure', expr: id, type: 'number', agg: 'avg', format: 'number', polarity: 'higher', additivity: 'non_additive', ...o });
  const D = (dataset: string, id: string, label: string, o: Partial<Field> = {}): Field => ({ id, dataset, label, role: 'dimension', expr: id, type: 'string', ...o });
  const hiddenRank = (ds: string, ids: string[]) => ids.map(id => F(ds, id, id.replace(/_/g, ' '), { hidden: true, polarity: 'neutral' }));
  const fields: Field[] = [
    // games: dimensions
    D('games', 'account_name', 'account'), D('games', 'queue', 'queue'), D('games', 'champion', 'champion'), D('games', 'position', 'role'),
    D('games', 'opp_champion', 'lane opponent'), D('games', 'patch', 'patch'), D('games', 'weekday', 'weekday'),
    D('games', 'game_start_utc', 'game start (UTC)', { type: 'time' }), D('games', 'tag', 'my tag'),
    D('games', 'opp_tier', 'opponent tier', { hidden: true }),
    // games: measures
    F('games', 'win', 'win rate', { agg: 'rate', format: 'percent' }),
    F('games', 'cs_per_min', 'CS per min', { description: 'Per-game CS per minute. Its plain average weights a 15-minute game like a 45-minute one; see "CS per min, time-weighted".' }),
    F('games', 'cs_per_min_tw', 'CS per min, time-weighted', { expr: 'cs_total', agg: 'ratio', denominator: 'duration_min', description: 'Total CS / total minutes: the time-weighted average, built from two additive parts.' }),
    F('games', 'cs_at_10', 'CS at 10'), F('games', 'cs10_diff', 'CS at 10 lead'), F('games', 'cspm_diff', 'CS per min lead'),
    F('games', 'kda', 'KDA (per game)'),
    F('games', 'kda_ratio', 'KDA (ratio of totals)', { expr: 'kills + assists', agg: 'ratio', denominator: 'deaths', description: 'Total kills and assists over total deaths; does not let one deathless game dominate.' }),
    F('games', 'kills', 'kills', { additivity: 'additive' }), F('games', 'deaths', 'deaths', { polarity: 'lower', additivity: 'additive' }), F('games', 'assists', 'assists', { additivity: 'additive' }),
    F('games', 'solo_kills', 'solo kills', { additivity: 'additive' }), F('games', 'obj_takedowns', 'objective takedowns', { additivity: 'additive' }),
    F('games', 'obj_damage', 'objective damage', { additivity: 'additive', format: 'integer' }),
    F('games', 'kp', 'kill participation', { format: 'percent' }), F('games', 'lane_gold_adv', 'lane gold/XP lead'),
    F('games', 'vision_pm', 'vision per min'), F('games', 'dmg_pm', 'damage per min'), F('games', 'gold_pm', 'gold per min'),
    F('games', 'duration_min', 'game length (min)', { additivity: 'additive', polarity: 'neutral' }),
    F('games', 'enemy_jg_ganks_pre15', 'enemy jungler kills in my lane before 15', { polarity: 'lower', description: 'From your own timelines only.' }),
    F('games', 'game_weight', 'game weight', { polarity: 'neutral', additivity: 'additive', description: 'Your highlight weight for the game, 1 when unset.' }),
    D('games', 'champ_experience', 'games on this champion (bucket)'),
    F('games', 'champ_game_no', 'game number on this champion', { polarity: 'neutral', description: 'The Nth game on this champion in this history (all accounts), counted in time order. Lifetime games before the history starts are not counted.' }),
    // Weighting schemes: row-weight expressions offered under "Weight rows by".
    { id: 'w_learning_curve', dataset: 'games', role: 'weight', label: 'Learning curve: hard champions count half for their first 150 games', expr: 'if(hard_champion = 1 and champ_game_no <= 150, 0.5, 1)', type: 'number', description: 'Games on Lee Sin, Riven, Azir, Gangplank, Yasuo, Qiyana, Aphelios or Kalista count 0.5 until the 150th game on that champion, then 1.' },
    { id: 'w_main_role', dataset: 'games', role: 'weight', label: 'Main role counts double', expr: "if(position = 'TOP', 2, 1)", type: 'number', description: 'Top-lane games count twice. Change the role in the formula to your own main.' },
    { id: 'w_support_half', dataset: 'games', role: 'weight', label: 'Support games count half', expr: "if(position = 'UTILITY', 0.5, 1)", type: 'number' },
    { id: 'w_duration', dataset: 'games', role: 'weight', label: 'Game length (time-weighted)', expr: 'duration_min', type: 'number', description: 'Every minute played counts the same, so long games weigh more.' },
    { id: 'w_highlights', dataset: 'games', role: 'weight', label: 'My highlights', expr: 'game_weight', type: 'number', description: 'The weight you gave each game in the row list; 1 when unset.' },
    F('games', 'highlighted', 'highlighted games', { agg: 'sum', format: 'integer', additivity: 'additive', polarity: 'neutral' }),
    ...hiddenRank('games', ['ally_avg_top_pct', 'enemy_avg_top_pct', 'opp_ranked_wr', 'opp_level_at_game', 'opp_division']),
    // lobby players
    D('lobby_players', 'queue_name', 'queue'), D('lobby_players', 'champion', 'champion'), D('lobby_players', 'position', 'role'), D('lobby_players', 'riot_id', 'player'),
    D('lobby_players', 'tier', 'tier', { hidden: true }), D('lobby_players', 'rank', 'rank', { hidden: true }),
    F('lobby_players', 'win', 'win rate', { agg: 'rate', format: 'percent' }), F('lobby_players', 'cs_per_min', 'CS per min'),
    F('lobby_players', 'deaths', 'deaths', { polarity: 'lower', additivity: 'additive' }), F('lobby_players', 'solo_kills', 'solo kills', { additivity: 'additive' }),
    F('lobby_players', 'vision_pm', 'vision per min'), F('lobby_players', 'kp', 'kill participation', { format: 'percent' }),
    ...hiddenRank('lobby_players', ['top_pct']),
    // roster
    D('roster', 'riot_id', 'player'), D('roster', 'seen_on', 'seen on account'), D('roster', 'tier', 'tier', { hidden: true }), D('roster', 'rank', 'rank', { hidden: true }),
    F('roster', 'games_together', 'games together', { additivity: 'additive', agg: 'sum', format: 'integer' }),
    F('roster', 'ranked_wr', 'ranked win rate', { format: 'percent', hidden: true }), F('roster', 'level', 'summoner level', { polarity: 'neutral' }),
    ...hiddenRank('roster', ['top_pct', 'ranked_games']),
    ...hiddenRank('lobby_relative', ['rank']),
  ];

  const Q = (o: Partial<Query> & Pick<Query, 'id' | 'name'>): Query => ({ dataset: 'games', measures: [], groupBy: [], filters: [], last: 50, compare: { kind: 'none' }, followDashboard: true, ...o });
  const V = (o: Partial<Visualization> & Pick<Visualization, 'id' | 'name' | 'queryId' | 'type'>): Visualization => ({ color: 1, width: 3, window: 10, labels: true, ...o });
  const m = (field: string, agg?: Query['measures'][number]['agg']) => [{ field, ...(agg ? { agg } : {}) }];

  const queries: Query[] = [
    // Lobby lens
    Q({ id: 'q_lens', name: 'Last 50 solo-queue games', filters: RS, measures: m('cs_per_min'), compare: LOBBY_ROLE }),
    Q({ id: 'q_solo_opp', name: 'Solo kills vs my lane opponents, last 50', filters: RS, measures: m('solo_kills'), compare: opp('opp_solo_kills') }),
    Q({ id: 'q_obj_lobby', name: 'Objective takedowns vs my lobbies, last 50', filters: RS, measures: m('obj_takedowns'), compare: LOBBY_ROLE }),
    Q({ id: 'q_vision_lobby', name: 'Vision per min vs my lobbies, last 50', filters: RS, measures: m('vision_pm'), compare: LOBBY_ROLE }),
    Q({ id: 'q_jg', name: 'Enemy jungler kills in my lane before 15, by champion', filters: RS, last: 0, measures: m('enemy_jg_ganks_pre15'), groupBy: [{ field: 'champion' }], minRows: 3, limit: 12 }),
    Q({ id: 'q_rel', name: 'CS/min lead: mine vs my opponents\' over their lobbies', filters: RS, measures: m('cspm_diff'), compare: opp('opp_rel_cspm', 'my opponents\' lead over their own lane opponents') }),
    // Trends
    Q({ id: 'q_t_cs', name: 'CS/min, last 100 solo-queue games', filters: RS, last: 100, measures: m('cs_per_min'), compare: LOBBY_ROLE }),
    Q({ id: 'q_t_win', name: 'Win rate, last 100 solo-queue games', filters: RS, last: 100, measures: m('win') }),
    Q({ id: 'q_t_lead', name: 'CS/min lead over lane opponent (formula), last 100', filters: RS, last: 100, measures: [{ expr: 'cs_per_min - opp_cs_per_min', label: 'CS/min lead (formula)', agg: 'avg' }] }),
    Q({ id: 'q_t_vision', name: 'Vision per min, last 100', filters: RS, last: 100, measures: m('vision_pm'), compare: LOBBY_ROLE }),
    Q({ id: 'q_t_solo_slope', name: 'Solo kills: rate of change per 10 games', filters: RS, last: 100, measures: m('solo_kills'), series: { op: 'slope', window: 20 } }),
    Q({ id: 'q_t_net_solo', name: 'Net solo kills vs lane opponent, running total', filters: RS, last: 100, measures: [{ expr: 'solo_kills - opp_solo_kills', label: 'net solo kills', agg: 'sum' }], series: { op: 'cumulative', window: 10 } }),
    Q({ id: 'q_t_deaths_delta', name: 'Deaths: change vs previous 20 games', filters: RS, last: 100, measures: m('deaths'), series: { op: 'delta', window: 20 } }),
    // Matchups
    Q({ id: 'q_gp_cs10', name: 'Gangplank: CS at 10 lead by lane opponent', last: 0, filters: [{ field: 'champion', op: '=', value: 'Gangplank' }, { field: 'position', op: '=', value: 'TOP' }], measures: m('cs10_diff'), groupBy: [{ field: 'opp_champion' }], minRows: 2, compare: { kind: 'target', value: 0, label: 'even' } }),
    Q({ id: 'q_champ_wr', name: 'Solo-queue win rate by champion, all accounts', last: 0, filters: RS, measures: m('win'), groupBy: [{ field: 'champion' }], minRows: 3, sort: 'count_desc', limit: 15, compare: { kind: 'target', value: 0.5, label: '50%' } }),
    Q({ id: 'q_kda_champ', name: 'KDA by champion vs lobby players on that champion', last: 100, filters: RS, measures: m('kda'), groupBy: [{ field: 'champion' }], minRows: 3, limit: 10, compare: LOBBY_ROLE_CHAMP }),
    Q({ id: 'q_week_hour', name: 'Win rate by weekday and hour', last: 0, filters: RS, measures: m('win'), groupBy: [{ field: 'game_start_utc', grain: 'weekday' }, { field: 'game_start_utc', grain: 'hour' }] }),
    Q({ id: 'q_monthly', name: 'Games and win rate by month and role', last: 0, filters: RS, measures: [{ agg: 'count' }, { field: 'win' }], groupBy: [{ field: 'game_start_utc', grain: 'month' }, { field: 'position' }], rollup: true }),
    // Weights and showcase
    Q({ id: 'q_cs_plain', name: 'CS per min: per-game average, all solo games', last: 0, filters: RS, measures: [{ field: 'cs_per_min' }, { field: 'cs_per_min_tw' }] }),
    Q({ id: 'q_cs_weighted_len', name: 'CS per min weighted by game length', last: 0, filters: RS, measures: m('cs_per_min'), weight: 'duration_min' }),
    Q({ id: 'q_showcase', name: 'Showcase: KDA weighted by my highlights', last: 0, filters: RS, measures: m('kda'), weight: 'game_weight' }),
    Q({ id: 'q_gp_showcase', name: 'Gangplank showcase: win rate and CS per min, last 25 Gangplank games', last: 25, filters: [...RS, { field: 'champion', op: '=', value: 'Gangplank' }], measures: [{ field: 'win' }, { field: 'cs_per_min' }, { field: 'solo_kills' }], compare: LOBBY_ROLE_CHAMP }),
    Q({ id: 'q_curve', name: 'Win rate by games played on the champion', last: 0, filters: RS, measures: [{ field: 'win' }, { agg: 'count' }], groupBy: [{ field: 'champ_experience' }], sort: 'key_asc' }),
    Q({ id: 'q_curve_w', name: 'KDA with the learning-curve weighting', last: 0, filters: RS, measures: m('kda_ratio'), weight: 'w_learning_curve' }),
    Q({ id: 'q_curve_w2', name: 'Win rate with the learning-curve weighting', last: 0, filters: RS, measures: m('win'), weight: 'w_learning_curve' }),
  ];
  const vizs: Visualization[] = [
    V({ id: 'v_card', name: 'You vs who you actually play', queryId: 'q_lens', type: 'card', width: 6, note: 'Every column is a measured group of real players. No rank, no distribution.',
      card: {
        rows: [
          { label: 'CS per min', field: 'cs_per_min', alias: 'cspm' }, { label: 'solo kills', field: 'solo_kills' }, { label: 'kill participation', field: 'kp' },
          { label: 'objective takedowns', field: 'obj_takedowns' }, { label: 'objective damage', field: 'obj_damage' }, { label: 'lane gold/XP lead', field: 'lane_gold_adv' },
          { label: 'damage per min', field: 'dmg_pm' }, { label: 'vision per min', field: 'vision_pm' }, { label: 'deaths', field: 'deaths', polarity: 'lower' },
        ],
        columns: [
          { label: 'you', kind: 'self' },
          { label: 'your lane opponents', kind: 'paired', pattern: 'opp_{f}' },
          { label: 'your lobbies, same role', kind: 'reference', dataset: 'lobby_players', filters: [{ field: 'queue_name', op: '=', value: 'Ranked Solo' }], weightBy: ['position'] },
          { label: 'opponents vs their lobbies', kind: 'paired', pattern: 'opp_rel_{alias}', signed: true },
        ],
      } }),
    V({ id: 'v_solo', name: 'Solo kills vs lane opponents', queryId: 'q_solo_opp', type: 'kpi', color: 2, width: 2 }),
    V({ id: 'v_vision', name: 'Vision per min vs lobby', queryId: 'q_vision_lobby', type: 'kpi', color: 7, width: 2, note: 'Vision has been the one clear weakness in every analysis so far.' }),
    V({ id: 'v_rel', name: 'CS/min lead: mine vs theirs', queryId: 'q_rel', type: 'kpi', color: 1, width: 2, note: 'My lead over my lane opponents against their average lead over the people they are matched with.' }),
    V({ id: 'v_jg', name: 'Enemy jungler presence in my lane', queryId: 'q_jg', type: 'bar', color: 8, width: 6, note: 'Kills before 15:00 in your lane with the enemy jungler involved. Only your games have timelines.' }),
    V({ id: 'v_t_cs', name: 'CS/min: is it trending?', queryId: 'q_t_cs', type: 'trend', color: 1 }),
    V({ id: 'v_t_win', name: 'Win rate: is it trending?', queryId: 'q_t_win', type: 'trend', color: 6, window: 20, note: 'Win rate is the noisiest stat here; the test needs many games before p drops.' }),
    V({ id: 'v_t_lead', name: 'Lead over lane opponent: trend', queryId: 'q_t_lead', type: 'trend', color: 2 }),
    V({ id: 'v_t_vision', name: 'Vision: is it trending?', queryId: 'q_t_vision', type: 'trend', color: 7 }),
    V({ id: 'v_t_slope', name: 'Solo kills: rate of change', queryId: 'q_t_solo_slope', type: 'line', color: 3, width: 2, note: 'd/dt: least-squares slope over each 20-game window, per 10 games. Above zero = rising.' }),
    V({ id: 'v_t_cum', name: 'Net solo kills, running total', queryId: 'q_t_net_solo', type: 'area', color: 4, width: 2, note: '∫: running sum of (my solo kills − opponent solo kills).' }),
    V({ id: 'v_t_delta', name: 'Deaths: Δ vs previous 20 games', queryId: 'q_t_deaths_delta', type: 'line', color: 8, width: 2, note: 'Below zero = fewer deaths than the 20 games before.' }),
    V({ id: 'v_gp', name: 'Gangplank: CS at 10 lead by lane opponent', queryId: 'q_gp_cs10', type: 'bar', width: 3, note: 'Positive = ahead at 10 minutes.' }),
    V({ id: 'v_champ_wr', name: 'Win rate by champion, solo queue', queryId: 'q_champ_wr', type: 'bar', color: 8, width: 3 }),
    V({ id: 'v_kda_champ', name: 'KDA by champion vs lobby players on that champion', queryId: 'q_kda_champ', type: 'sparktable', color: 5, width: 6 }),
    V({ id: 'v_heat', name: 'Win rate by weekday × hour (UTC)', queryId: 'q_week_hour', type: 'heatmap', width: 6 }),
    V({ id: 'v_monthly', name: 'Games and win rate by month and role, with subtotals', queryId: 'q_monthly', type: 'table', width: 6 }),
    V({ id: 'v_cs_plain', name: 'CS per min: per-game average vs total CS ÷ total minutes', queryId: 'q_cs_plain', type: 'table', width: 3, note: 'The second number weights every minute equally instead of every game.' }),
    V({ id: 'v_cs_len', name: 'CS per min weighted by game length', queryId: 'q_cs_weighted_len', type: 'kpi', color: 3, width: 3 }),
    V({ id: 'v_showcase', name: 'KDA, weighted by my highlights', queryId: 'q_showcase', type: 'kpi', color: 5, width: 3, note: 'Star or weight games in the row list under the query builder. Unweighted value shown underneath so the weighting never hides.' }),
    V({ id: 'v_curve', name: 'Win rate by games played on the champion', queryId: 'q_curve', type: 'column', color: 3, width: 3, note: 'Counted within this history, in time order, across all accounts.' }),
    V({ id: 'v_curve_w2', name: 'Win rate, learning-curve weighted', queryId: 'q_curve_w2', type: 'kpi', color: 6, width: 3, note: 'Hard champions count half until their 150th game. The unweighted rate is shown underneath.' }),
    V({ id: 'v_gp_show', name: 'Gangplank, last 25: vs lobby players on Gangplank', queryId: 'q_gp_showcase', type: 'kpi', color: 2, width: 3 }),
  ];
  const T = (ids: string[]): Dashboard['tiles'] => ids.map((vizId, i) => ({ id: `t_${vizId}_${i}`, vizId }));
  const dashboards: Dashboard[] = [
    { id: 'd_lens', name: 'Lobby lens (no rank)', filters: [], tiles: T(['v_card', 'v_solo', 'v_vision', 'v_rel', 'v_jg']) },
    { id: 'd_trends', name: 'Trends & improvement', filters: [], tiles: T(['v_t_cs', 'v_t_win', 'v_t_lead', 'v_t_vision', 'v_t_slope', 'v_t_cum', 'v_t_delta']) },
    { id: 'd_showcase', name: 'Showcase & weights', filters: [], tiles: T(['v_curve', 'v_curve_w2', 'v_cs_plain', 'v_cs_len', 'v_showcase', 'v_gp_show', 'v_monthly']) },
    { id: 'd_matchups', name: 'Champions & matchups', filters: [], tiles: T(['v_champ_wr', 'v_gp', 'v_kda_champ', 'v_heat']) },
  ];
  return {
    id: 'lol', name: 'League of Legends', description: 'Your games, the players in your lobbies, and the players in theirs, from the Riot API pipeline.',
    domainNotes: [
      'Domain: League of Legends. games = the user\'s own games (accounts: takinturrets = main, asd123456efg = alt, Velocoraptor = new). lobby_players = recent games of everyone who shared a lobby with the user (the reference population). roster / lobby_relative = one row per player met.',
      'games.queue values: Ranked Solo, Ranked Flex, Normal Draft, Swiftplay. lobby_players.queue_name has the same names. position values: TOP, JUNGLE, MIDDLE, BOTTOM, UTILITY.',
      'opp_* columns on games are the lane opponent in the same game (opp_cs_per_min, opp_solo_kills, opp_kp, opp_vision_pm, opp_dmg_pm, opp_gold_pm, opp_obj_takedowns, opp_obj_damage, opp_lane_gold_adv, opp_cs_at_10). opp_rel_* = that opponent\'s average lead over their own lane opponents (second-degree baseline; opp_rel_cspm for CS per min). rel_* = the user\'s lead over the lane opponent.',
      'Default comparison for "vs my lobbies / lobby players" is reference dataset lobby_players filtered queue_name = Ranked Solo, weightBy position. "vs my lane opponents" is paired with the opp_ column. Rank and tier fields are hidden; do not build on them unless asked.',
      'game_weight = the user\'s highlight weight per game (1 when unset); highlighted = 1 for games weighted above 1. "Showcase", "highlight", "my best games" → weight game_weight or filter highlighted = 1. Weighting schemes are fields with role weight (w_learning_curve, w_main_role, w_support_half, w_duration, w_highlights); set query.weight to a weight field id or to an expression such as if(position = \'UTILITY\', 0.5, 1) or if(champion = \'Riven\' and champ_game_no > 150, 2, 1). champ_game_no = the Nth game on that champion in this history; champ_experience buckets it; hard_champion = 1 for mechanically hard champions. Time-weighted CS/min = field cs_per_min_tw (ratio of total CS to total minutes). enemy_jg_ganks_pre15 exists only for the user\'s own games.',
    ].join('\n'),
    sources, items, datasets, fields, queries, visualizations: vizs, dashboards, activeDashboard: 'd_lens', seedVersion: 1,
  };
}
