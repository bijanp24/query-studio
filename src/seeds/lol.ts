// The League of Legends workspace: the Riot pipeline's processed layer as sources, configured
// entirely through the generic model (no League-specific code anywhere in the engine).
import type { Compare, Dashboard, Field, Filter, Query, Source, SourceItem, Visualization, Workspace, Dataset } from '../core/types';

const RS: Filter[] = [{ field: 'queue', op: '=', value: 'Ranked Solo' }];
const LOBBY_ROLE: Compare = { kind: 'reference', dataset: 'lobby_players', filters: [{ field: 'queue_name', op: '=', value: 'Ranked Solo' }], weightBy: ['position'], label: 'lobby players, same role' };
const LOBBY_ROLE_CHAMP: Compare = { kind: 'reference', dataset: 'lobby_players', filters: [{ field: 'queue_name', op: '=', value: 'Ranked Solo' }], weightBy: ['position', 'champion'], label: 'lobby players, same role and champion' };
const opp = (col: string, label = 'my lane opponents, same games'): Compare => ({ kind: 'paired', field: col, label });

const FILES = ['my_matchups', 'my_games', 'player_games', 'roster', 'lobby_relative', 'champion_baselines', 'tier_baselines', 'met_rank_today',
  // the smurf test and the median sensitivity (data/scripts/hypothesis_test.py, smurf_median_sensitivity.py, smurf_qs_export.py); no Riot IDs
  'smurf_tests', 'smurf_test_summary', 'smurf_sweep', 'smurf_gap_hist', 'smurf_shape', 'smurf_lobby'];
// Published with the app only: the NA ladder, rank snapshots of everyone met, and the user's own accounts over time.
const BUNDLED_ONLY = ['ladder', 'rank_tracking', 'my_rank'];

// Ranks as an ordered scale: Iron IV = 0 … Diamond I = 27, Master 28, Grandmaster 29, Challenger 30.
// Built from tier and division columns, so the live file and the snapshot need no extra columns.
const TIER_NAMES: [string, string][] = [['IRON', 'Iron'], ['BRONZE', 'Bronze'], ['SILVER', 'Silver'], ['GOLD', 'Gold'], ['PLATINUM', 'Plat'], ['EMERALD', 'Emerald'], ['DIAMOND', 'Diamond']];
const DIV_NAMES = ['IV', 'III', 'II', 'I'];
const rankStep = (tier: string, div: string) =>
  `if(decode(${tier}, 'MASTER', 1, 'GRANDMASTER', 1, 'CHALLENGER', 1, 0) = 1, decode(${tier}, 'MASTER', 28, 'GRANDMASTER', 29, 30), ` +
  `decode(${tier}, ${TIER_NAMES.map(([t], i) => `'${t}', ${i * 4}`).join(', ')}, null) + decode(${div}, 'IV', 0, 'III', 1, 'II', 2, 'I', 3, 0))`;
const LABEL_PAIRS = [...TIER_NAMES.flatMap(([, n], i) => DIV_NAMES.map((d, j) => `${i * 4 + j}, '${n} ${d}'`)), "28, 'Master'", "29, 'Grandmaster'", "30, 'Challenger'"];
// decode takes at most 20 pairs, so the labels are split over two nested calls.
const RANK_LABEL = `decode(rank_step, ${LABEL_PAIRS.slice(0, 16).join(', ')}, decode(rank_step, ${LABEL_PAIRS.slice(16).join(', ')}, null))`;
const TIER_FULL = ['Iron', 'Bronze', 'Silver', 'Gold', 'Platinum', 'Emerald', 'Diamond', 'Master', 'Grandmaster', 'Challenger'];
const TIER_KEYS = ['IRON', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'EMERALD', 'DIAMOND', 'MASTER', 'GRANDMASTER', 'CHALLENGER'];
// Tiers as an ordered scale with Unranked below Iron, so a flow can tell a climb from a fall.
const tierStep = (tier: string) => `decode(${tier}, 'UNRANKED', -1, ${TIER_KEYS.map((t, i) => `'${t}', ${i}`).join(', ')}, null)`;
const tierName = (step: string) => `decode(${step}, -1, 'Unranked', ${TIER_FULL.map((t, i) => `${i}, '${t}'`).join(', ')}, null)`;
const rankColumns = (tier: string, div: string) => [{ name: 'rank_step', expr: rankStep(tier, div) }, { name: 'rank_label', expr: RANK_LABEL }];

export function lolWorkspace(): Workspace {
  const sources: Source[] = [
    { id: 'riot_project', name: 'Riot pipeline (project files)', kind: 'project', base: 'data/processed/latest/', description: 'The hourly processed layer the Riot API pull writes to the project folder. Live for project members.' },
    { id: 'riot_snapshot', name: 'Published snapshot', kind: 'bundled', base: 'data/lol/', description: 'A copy of the processed layer published with the app (2026-10-18), with other players\' Riot IDs and PUUIDs replaced by short hashes. Used when the project files cannot be read.' },
    { id: 'highlights', name: 'My highlights and weights', kind: 'manual', description: 'Games you starred or weighted in the app. Joined onto My games by account and match.' },
  ];
  const items: SourceItem[] = [];
  for (const f of FILES) {
    items.push({ id: `p_${f}`, sourceId: 'riot_project', name: `${f}.csv`, format: 'csv', path: `${f}.csv` });
    items.push({ id: `b_${f}`, sourceId: 'riot_snapshot', name: `${f}.csv`, format: 'csv', path: `${f}.csv` });
  }
  for (const f of BUNDLED_ONLY) items.push({ id: `b_${f}`, sourceId: 'riot_snapshot', name: `${f}.csv`, format: 'csv', path: `${f}.csv` });
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
        { name: 'lobby_level', expr: '100 - (4 * ally_avg_top_pct + 5 * enemy_avg_top_pct) / 9' },
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
    { id: 'roster', name: 'Players met', grain: 'player', feeds: both('roster', true), key: ['puuid'], description: 'One row per player who shared a game with you: games together, record with and against, rank, level.', derived: [{ name: 'tier', expr: "split_part(rank, ' ', 1)" }, { name: 'ladder_pct', expr: '100 - top_pct' }] },
    { id: 'lobby_relative', name: 'Lobby-relative players', grain: 'player', feeds: both('lobby_relative', true), key: ['puuid'], description: 'Each player met (and your accounts): ranked-solo averages, their lead over their own lane opponents (rel_*), and what their opponents average (their_opp_*).' },
    { id: 'champion_baselines', name: 'Champion baselines', grain: 'role × champion', feeds: both('champion_baselines', true), key: ['position', 'champion'] },
    { id: 'tier_baselines', name: 'Tier baselines', grain: 'role × tier', feeds: both('tier_baselines', true), key: ['position', 'tier'] },
    {
      id: 'met_players', name: 'Players met: rank today', grain: 'player', feeds: both('met_rank_today', true), key: ['puuid'],
      description: 'Everyone who shared a game with you, on any account, with their solo-queue rank today (the newest rank snapshot or cached rank; rank_source says which and when). side = whether they were only on your team, only against you, or both.',
      derived: [...rankColumns('tier_today', 'division_today'), { name: 'ladder_pct', expr: 'if(top_pct_today >= 0, 100 - top_pct_today, null)' }],
    },
    {
      id: 'ladder', name: 'NA solo-queue ladder', grain: 'ladder division', feeds: [{ itemId: 'b_ladder', priority: 1 }], key: ['tier', 'division'],
      description: 'Every ranked NA solo-queue account counted per tier and division (Master capped at 10,000 in the source), with the ladder percentile range each division covers. The reference population for rank distributions.',
      derived: [...rankColumns('tier', 'division'), { name: 'ladder_pct', expr: '(ladder_pct_low + ladder_pct_high) / 2' }],
    },
    {
      id: 'rank_tracking', name: 'Players met: rank over time', grain: 'rank snapshot', sequence: 'snapshot_date', key: ['puuid', 'snapshot_date'], feeds: [{ itemId: 'b_rank_tracking', priority: 1 }],
      description: 'One row per player met per rank snapshot: the first cached rank, then the daily snapshots. Change columns compare each snapshot with the same player\'s previous one.',
      derived: [
        ...rankColumns('tier', 'division'),
        { name: 'prev_ladder_pct', expr: 'ladder_pct', window: { fn: 'lag', partitionBy: ['puuid'] } },
        { name: 'prev_rank_step', expr: 'rank_step', window: { fn: 'lag', partitionBy: ['puuid'] } },
        { name: 'ladder_change', expr: 'ladder_pct - prev_ladder_pct' },
        { name: 'divisions_moved', expr: 'rank_step - prev_rank_step' },
        { name: 'prev_tier', expr: 'tier', window: { fn: 'lag', partitionBy: ['puuid'] } },
        { name: 'tier_step', expr: tierStep('tier') },
        { name: 'prev_tier_step', expr: tierStep('prev_tier') },
        { name: 'tier_name', expr: tierName('tier_step') },
        { name: 'prev_tier_name', expr: tierName('prev_tier_step') },
        { name: 'prev_rank_label', expr: 'rank_label', window: { fn: 'lag', partitionBy: ['puuid'] } },
        { name: 'moved_up', expr: 'if(rank_step > prev_rank_step, 1, 0)' },
        { name: 'moved_down', expr: 'if(rank_step < prev_rank_step, 1, 0)' },
      ],
    },
    {
      id: 'my_rank', name: 'My rank over time', grain: 'rank snapshot', sequence: 'snapshot_utc', feeds: [{ itemId: 'b_my_rank', priority: 1 }], key: ['account', 'snapshot_utc'],
      description: 'Solo-queue rank of each of your accounts at every snapshot the pipeline took.',
      derived: [{ name: 'account_name', expr: "split_part(account, '#', 1)" }, ...rankColumns('tier', 'division')],
    },    {
      id: 'smurf_tests', name: 'Smurf test: evidence', grain: 'evidence item', feeds: both('smurf_tests', true), key: ['case_name', 'evidence'],
      description: 'One row per piece of evidence per investigated player, tested both ways: H0 = plays at their shown rank (not a smurf), H1 = plays well above it. P(e | H0) and P(e | H1) come from players met in your lobbies; the likelihood ratio says which hypothesis the evidence favours and by how much; each p-value asks how surprising the evidence is if that hypothesis were true. Subjects are hashed.',
    },
    { id: 'smurf_test_summary', name: 'Smurf test: verdicts', grain: 'investigated player', feeds: both('smurf_test_summary', true), key: ['case_name'],
      description: 'One row per investigated player: combined p-value under each hypothesis, the Bayes factor (product of likelihood ratios, treating items as independent) and the posterior chance of a smurf from a 9% prior and from even odds.' },
    { id: 'smurf_sweep', name: 'Smurfs and the median: sweep', grain: 'scenario × smurf share', feeds: both('smurf_sweep', true), key: ['scenario', 'smurf_share_pct'],
      description: 'What happens to the median rank of the players met if a share of the players below the median are smurfs whose true rank is higher. A: smurfs land exactly on the median. B: smurfs land at the level of the lobbies they were met in. C: smurfs land anywhere above the median. Upper bound: every smurf lands above the new median, so the median becomes the old (50 + share)th percentile.' },
    { id: 'smurf_gap_hist', name: 'Smurfs and the median: lobby gap', grain: 'gap bin × account group', feeds: both('smurf_gap_hist', true), key: ['games_group', 'gap_bin'],
      description: 'Each player in your Ranked Solo games: their rank today minus the median rank today of the other nine, in divisions, split by how many solo games they have played this season. Matchmaking pairs by hidden MMR, so a player far below their own lobby is rated above their shown rank.' },
    { id: 'smurf_shape', name: 'Smurfs and the median: shape check', grain: 'simulation', feeds: both('smurf_shape', true), key: ['true_distribution', 'smurf_share_pct'],
      description: 'Could a symmetric rank distribution hide smurfs? Start from a smurf-free distribution, demote a share of players by gaps drawn from real lobby gaps, and measure the skew of what would be shown. Observed skew of the players met: -0.03 (95% range -0.10 to +0.04).' },
    { id: 'smurf_lobby', name: 'Smurfs and the median: one lobby', grain: 'player slot', feeds: both('smurf_lobby', true), key: ['scenario', 'slot'],
      description: 'The ten ranks in one live game (Silver IV among Gold II to Plat IV), sorted, as shown and with the Silver IV played as Plat IV. The median of ten is the average of slots 5 and 6.' },
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
    F('games', 'lobby_level', 'lobby level (ladder percentile)', { agg: 'median', format: 'decimal1', polarity: 'neutral', description: 'Where the other nine players in the game sit on the ladder, 0 to 100 (50 = the median player, 69 = Plat IV). Uses each player\'s rank as of the pull, not their rank on the day of the game.' }),
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
    F('roster', 'ladder_pct', 'ladder percentile', { agg: 'median', format: 'decimal1', description: 'Where the player sits on the ladder today, 0 to 100 (50 = the median ranked player). Players with no rank have no value.' }),
    ...hiddenRank('roster', ['top_pct', 'ranked_games']),
    ...hiddenRank('lobby_relative', ['rank']),
    // players met: rank today, against the ladder
    D('met_players', 'rank_label', 'rank', { sortBy: 'rank_step' }), D('met_players', 'side', 'side (ally, enemy, both)'), D('met_players', 'seen_on', 'seen on account'),
    D('met_players', 'riot_id', 'player'), D('met_players', 'rank_source', 'rank source'),
    F('met_players', 'players', 'players', { expr: '1', agg: 'sum', format: 'integer', additivity: 'additive', polarity: 'neutral' }),
    F('met_players', 'ladder_pct', 'ladder percentile', { agg: 'median', format: 'decimal1', polarity: 'neutral', description: 'Where the player sits on the NA ladder today, 0 to 100 (50 = the median ranked player). Unranked players have no value.' }),
    F('met_players', 'rank_step', 'rank (divisions above Iron IV)', { agg: 'median', format: 'decimal1', polarity: 'neutral' }),
    F('met_players', 'games_together', 'games together', { agg: 'sum', format: 'integer', additivity: 'additive', polarity: 'neutral' }),
    D('ladder', 'rank_label', 'rank', { sortBy: 'rank_step' }), D('ladder', 'tier', 'tier'),
    F('ladder', 'players', 'players', { expr: 'accounts', agg: 'sum', format: 'integer', additivity: 'additive', polarity: 'neutral', description: 'Ranked accounts in the division.' }),
    // rank over time
    D('rank_tracking', 'snapshot_date', 'snapshot date', { type: 'time' }), D('rank_tracking', 'rank_label', 'rank', { sortBy: 'rank_step' }),
    D('rank_tracking', 'side', 'side (ally, enemy, both)'), D('rank_tracking', 'source', 'rank source'), D('rank_tracking', 'riot_id', 'player'),
    F('rank_tracking', 'players', 'players', { expr: '1', agg: 'sum', format: 'integer', additivity: 'semi_additive', polarity: 'neutral', description: 'Players with a rank in the snapshot. Sums across players, not across snapshots.' }),
    F('rank_tracking', 'ladder_pct', 'ladder percentile', { agg: 'median', format: 'decimal1', polarity: 'neutral' }),
    F('rank_tracking', 'ladder_change', 'change in ladder percentile since the previous snapshot', { agg: 'median', format: 'decimal1', polarity: 'neutral' }),
    F('rank_tracking', 'divisions_moved', 'divisions moved since the previous snapshot', { agg: 'avg', format: 'decimal2', polarity: 'neutral' }),
    F('rank_tracking', 'moved_up', 'moved up a division or more', { agg: 'rate', format: 'percent', polarity: 'neutral' }),
    F('rank_tracking', 'moved_down', 'moved down a division or more', { agg: 'rate', format: 'percent', polarity: 'neutral' }),
    D('rank_tracking', 'prev_tier', 'tier at the previous snapshot', { hidden: true }),
    D('rank_tracking', 'tier_name', 'tier', { sortBy: 'tier_step' }), D('rank_tracking', 'prev_tier_name', 'tier at the previous snapshot', { sortBy: 'prev_tier_step' }),
    D('rank_tracking', 'prev_rank_label', 'rank at the previous snapshot', { sortBy: 'prev_rank_step' }),
    D('my_rank', 'account_name', 'account'), D('my_rank', 'snapshot_utc', 'snapshot time (UTC)', { type: 'time' }), D('my_rank', 'rank_label', 'rank', { sortBy: 'rank_step' }),
    F('my_rank', 'ladder_pct', 'my ladder percentile', { agg: 'median', format: 'decimal1', polarity: 'higher' }),
    F('my_rank', 'lp', 'LP', { agg: 'median', format: 'integer', polarity: 'higher' }),
  ];

  fields.push(
    D('smurf_tests', 'case_name', 'case'), D('smurf_tests', 'evidence', 'evidence'), D('smurf_tests', 'observed', 'observed'), D('smurf_tests', 'favours', 'favours'), D('smurf_tests', 'basis', 'basis (data or assumed)'),
    F('smurf_tests', 'log10_lr', 'evidence weight (log10 likelihood ratio, + = smurf)', { agg: 'sum', format: 'decimal2', additivity: 'additive', polarity: 'neutral', description: 'log10 of P(e | smurf) / P(e | not a smurf). +1 = ten times likelier if a smurf, -1 = ten times likelier if not. Sums across independent items.' }),
    F('smurf_tests', 'likelihood_ratio', 'likelihood ratio (smurf : not)', { agg: 'max', format: 'decimal2', polarity: 'neutral' }),
    F('smurf_tests', 'p_value_if_not_smurf', 'p-value if NOT a smurf', { agg: 'min', format: 'decimal2', polarity: 'neutral', description: 'How often a player who plays at their shown rank shows evidence at least this smurf-like. Below 0.05 rejects "not a smurf" on this item.' }),
    F('smurf_tests', 'p_value_if_smurf', 'p-value if a smurf', { agg: 'min', format: 'decimal2', polarity: 'neutral', description: 'How often a smurf shows evidence at least this un-smurf-like. Below 0.05 rejects "smurf" on this item.' }),
    D('smurf_test_summary', 'case_name', 'case'), D('smurf_test_summary', 'shown_rank', 'shown rank'), D('smurf_test_summary', 'not_smurf_hypothesis', 'assume NOT a smurf'), D('smurf_test_summary', 'smurf_hypothesis', 'assume a smurf'),
    F('smurf_test_summary', 'p_if_not_smurf', 'combined p if NOT a smurf', { agg: 'min', format: 'decimal2', polarity: 'neutral' }),
    F('smurf_test_summary', 'p_if_smurf', 'combined p if a smurf', { agg: 'min', format: 'decimal2', polarity: 'neutral' }),
    F('smurf_test_summary', 'bayes_factor', 'Bayes factor (smurf : not)', { agg: 'max', format: 'decimal2', polarity: 'neutral' }),
    F('smurf_test_summary', 'posterior_smurf', 'chance of a smurf, 9% prior', { agg: 'max', format: 'percent', polarity: 'neutral' }),
    F('smurf_test_summary', 'posterior_even_odds', 'chance of a smurf, even odds', { agg: 'max', format: 'percent', polarity: 'neutral' }),
    D('smurf_sweep', 'scenario', 'scenario'), D('smurf_sweep', 'share_label', 'smurf share of players met'), D('smurf_sweep', 'median_rank', 'median rank'),
    F('smurf_sweep', 'median_shift_points', 'median moves up (rank points, 100 = one division)', { agg: 'avg', format: 'integer', polarity: 'neutral' }),
    F('smurf_sweep', 'median_ladder_pct', 'median ladder percentile', { agg: 'avg', format: 'decimal1', polarity: 'neutral' }),
    F('smurf_sweep', 'median_ladder_shift', 'median moves up (ladder percentile points)', { agg: 'avg', format: 'decimal1', polarity: 'neutral' }),
    F('smurf_sweep', 'iqr_points', 'middle half (IQR, rank points)', { agg: 'avg', format: 'integer', polarity: 'neutral' }),
    F('smurf_sweep', 'fisher_skew', 'skew', { agg: 'avg', format: 'decimal2', polarity: 'neutral' }),
    D('smurf_gap_hist', 'games_group', 'season games'), D('smurf_gap_hist', 'gap_bin', 'rank vs own lobby (rank points, 100 = one division)', { type: 'number' }),
    F('smurf_gap_hist', 'share_pct', 'share of the group (%)', { agg: 'sum', format: 'decimal1', additivity: 'additive', polarity: 'neutral' }),
    F('smurf_gap_hist', 'player_games', 'player-games', { agg: 'sum', format: 'integer', additivity: 'additive', polarity: 'neutral' }),
    D('smurf_shape', 'true_distribution', 'smurf-free starting distribution'), D('smurf_shape', 'smurf_share_pct', 'hidden smurf share (%)'),
    F('smurf_shape', 'fisher_skew', 'skew of the shown ranks', { agg: 'avg', format: 'decimal2', polarity: 'neutral' }),
    F('smurf_shape', 'excess_kurtosis', 'excess kurtosis', { agg: 'avg', format: 'decimal2', polarity: 'neutral' }),
    F('smurf_shape', 'inside_observed_range', 'inside the observed skew range', { agg: 'max', format: 'integer', polarity: 'neutral' }),
    D('smurf_lobby', 'scenario', 'scenario'), D('smurf_lobby', 'rank', 'rank'), D('smurf_lobby', 'slot', 'slot (sorted)'),
    F('smurf_lobby', 'rank_points', 'rank points', { agg: 'median', format: 'integer', polarity: 'neutral' }),
  );
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
    // Player profile: Baseline, Consistency, Peak, Trend
    Q({ id: 'q_bcpt', name: 'My profile: all solo-queue games', last: 0, filters: RS, measures: [{ field: 'lobby_level' }, { field: 'cs_per_min', agg: 'median' }, { field: 'solo_kills' }, { field: 'vision_pm', agg: 'median' }, { field: 'win' }] }),
    Q({ id: 'q_lobby_level', name: 'Lobby level over my solo-queue games', last: 0, filters: RS, measures: m('lobby_level') }),
    Q({ id: 'q_cs_ribbon', name: 'CS per min over my solo-queue games', last: 0, filters: RS, measures: m('cs_per_min', 'median') }),
    Q({ id: 'q_lobby_by_acct', name: 'Lobby level by account', last: 0, filters: RS, measures: [{ field: 'lobby_level', label: 'lobby level, median' }, { field: 'lobby_level', agg: 'p25', label: 'lower quartile' }, { field: 'lobby_level', agg: 'p75', label: 'upper quartile' }, { agg: 'count' }], groupBy: [{ field: 'account_name' }], minRows: 5 }),
    Q({ id: 'q_met_pct', name: 'Everyone I have played with or against: ladder percentile today', dataset: 'roster', last: 0, measures: m('ladder_pct') }),
    Q({ id: 'q_curve_w2', name: 'Win rate with the learning-curve weighting', last: 0, filters: RS, measures: m('win'), weight: 'w_learning_curve' }),
    // Rank distribution of the players met, against the ladder
    Q({ id: 'q_met_dist', name: 'Everyone I have played with or against, by rank today', dataset: 'met_players', last: 0, measures: m('players'), groupBy: [{ field: 'rank_label' }], filters: [{ field: 'rank_label', op: 'not_null', value: '' }] }),
    Q({ id: 'q_met_dist_enemy', name: 'My opponents, by rank today', dataset: 'met_players', last: 0, measures: m('players'), groupBy: [{ field: 'rank_label' }], filters: [{ field: 'rank_label', op: 'not_null', value: '' }, { field: 'side', op: 'in', value: 'enemy, both' }] }),
    Q({ id: 'q_met_dist_ally', name: 'My teammates, by rank today', dataset: 'met_players', last: 0, measures: m('players'), groupBy: [{ field: 'rank_label' }], filters: [{ field: 'rank_label', op: 'not_null', value: '' }, { field: 'side', op: 'in', value: 'ally, both' }] }),
    Q({ id: 'q_met_ladder_pct', name: 'Players met: ladder percentile today', dataset: 'met_players', last: 0, measures: m('ladder_pct') }),
    Q({ id: 'q_met_side', name: 'Players met by side: ladder percentile today', dataset: 'met_players', last: 0, measures: [{ field: 'ladder_pct', agg: 'p25', label: 'lower quartile' }, { field: 'ladder_pct', label: 'median' }, { field: 'ladder_pct', agg: 'p75', label: 'upper quartile' }, { field: 'players' }], groupBy: [{ field: 'side' }], sort: 'key_asc' }),
    // Rank tracking
    Q({ id: 'q_track_by_date', name: 'Players met: ladder percentile by snapshot date', dataset: 'rank_tracking', last: 0, measures: [{ field: 'ladder_pct', agg: 'p25', label: 'lower quartile' }, { field: 'ladder_pct', label: 'median' }, { field: 'ladder_pct', agg: 'p75', label: 'upper quartile' }, { field: 'players' }], groupBy: [{ field: 'snapshot_date', grain: 'day' }] }),
    Q({ id: 'q_track_change', name: 'Players met: change in ladder percentile since the previous snapshot', dataset: 'rank_tracking', last: 0, measures: m('ladder_change'), filters: [{ field: 'ladder_change', op: 'not_null', value: '' }] }),
    Q({ id: 'q_track_moved', name: 'Players met: who climbed and who fell, by tier at the previous snapshot', dataset: 'rank_tracking', last: 0, measures: [{ field: 'moved_up' }, { field: 'moved_down' }, { field: 'divisions_moved' }], filters: [{ field: 'prev_rank_step', op: 'not_null', value: '' }, { field: 'rank_step', op: 'not_null', value: '' }], groupBy: [{ field: 'prev_tier' }], minRows: 10, rollup: true }),
    Q({ id: 'q_flow_tier', name: 'Rank flow: tier at the previous snapshot → tier now', dataset: 'rank_tracking', last: 0, measures: m('players'), groupBy: [{ field: 'prev_tier_name' }, { field: 'tier_name' }], filters: [{ field: 'prev_tier_name', op: 'not_null', value: '' }, { field: 'tier_name', op: 'not_null', value: '' }] }),
    Q({ id: 'q_flow_div', name: 'Rank flow by division: previous snapshot → now', dataset: 'rank_tracking', last: 0, measures: m('players'), groupBy: [{ field: 'prev_rank_label' }, { field: 'rank_label' }], filters: [{ field: 'prev_rank_label', op: 'not_null', value: '' }, { field: 'rank_label', op: 'not_null', value: '' }] }),
    Q({ id: 'q_my_rank', name: 'My main account: ladder percentile over time', dataset: 'my_rank', last: 0, measures: m('ladder_pct'), filters: [{ field: 'account_name', op: '=', value: 'takinturrets' }] }),
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
    V({ id: 'v_profile', name: 'My profile: baseline, consistency, peak, trend', queryId: 'q_bcpt', type: 'profile', color: 1, width: 6, window: 20, note: 'Baseline = all games. Consistency = the middle half. Peak = the best 20-game stretch. Trend = change per 100 games, called only when its 95% range leaves zero.' }),
    V({ id: 'v_lobby_ribbon', name: 'Lobby level: rolling baseline and spread', queryId: 'q_lobby_level', type: 'ribbon', color: 4, width: 3, window: 20, note: 'Rank-based: uses each player\'s rank as of the pull. Daily rank snapshots will replace this with rank at game time.' }),
    V({ id: 'v_cs_ribbon', name: 'CS per min: rolling baseline and spread', queryId: 'q_cs_ribbon', type: 'ribbon', color: 1, width: 3, window: 20 }),
    V({ id: 'v_lobby_acct', name: 'Lobby level by account', queryId: 'q_lobby_by_acct', type: 'table', width: 3 }),
    V({ id: 'v_met_hist', name: 'Players met: ladder percentile today', queryId: 'q_met_pct', type: 'hist', color: 5, width: 3, note: 'Everyone who shared a game with you, all accounts. 50 = the median ranked player.' }),
    V({ id: 'v_met_dist', name: 'Who I actually play: rank today vs the NA ladder', queryId: 'q_met_dist', type: 'distribution', color: 5, width: 6, dist: { dataset: 'ladder', label: 'the NA ladder' }, note: 'Bars: everyone who shared a game with you, all accounts lumped, by rank today. Outline: every ranked NA solo-queue account. Unranked players are left out.' }),
    V({ id: 'v_met_dist_enemy', name: 'Opponents vs the ladder', queryId: 'q_met_dist_enemy', type: 'distribution', color: 8, width: 3, dist: { dataset: 'ladder', label: 'the NA ladder' } }),
    V({ id: 'v_met_dist_ally', name: 'Teammates vs the ladder', queryId: 'q_met_dist_ally', type: 'distribution', color: 2, width: 3, dist: { dataset: 'ladder', label: 'the NA ladder' } }),
    V({ id: 'v_met_pct_hist', name: 'Players met: ladder percentile, median and middle half', queryId: 'q_met_ladder_pct', type: 'hist', color: 5, width: 3, note: 'Against the ladder itself this would be flat: every percentile holds 1% of ranked players.' }),
    V({ id: 'v_met_side', name: 'Opponents vs teammates: ladder percentile', queryId: 'q_met_side', type: 'table', width: 3, note: '"both" = met on your team in one game and against you in another.' }),
    V({ id: 'v_track_by_date', name: 'Players met: ladder percentile at each snapshot', queryId: 'q_track_by_date', type: 'table', width: 3, note: 'Rows before the first daily snapshot are the cached ranks the met-rank table used, a different subset of players each day. From the daily snapshots on, every row covers everyone met.' }),
    V({ id: 'v_track_change', name: 'How far players met moved since the previous snapshot', queryId: 'q_track_change', type: 'hist', color: 4, width: 3, note: 'Ladder percentile points, per player. Becomes the "rate of change" as snapshots accumulate.' }),
    V({ id: 'v_track_moved', name: 'Players met: who climbed and who fell', queryId: 'q_track_moved', type: 'table', width: 3, note: 'Between each player\'s previous rank snapshot and the latest one, by the tier they were in before.' }),
    V({ id: 'v_flow_tier', name: 'Rank flow: where the players I met went', queryId: 'q_flow_tier', type: 'flow', color: 1, width: 6, note: 'Left: each player\'s tier at their previous snapshot. Right: their tier now. Green bands climbed, red fell, grey stayed. Use the dashboard filter on side to see opponents or teammates only.' }),
    V({ id: 'v_flow_div', name: 'Rank flow by division', queryId: 'q_flow_div', type: 'flow', color: 1, width: 6, note: 'Each row is a division at the previous snapshot; the cells show where its players are now, as a share of the row.' }),
    V({ id: 'v_my_rank_profile', name: 'My rank: baseline, consistency, peak, trend', queryId: 'q_my_rank', type: 'profile', color: 3, width: 3, window: 3, per: 10, note: 'Over the rank snapshots of the main account. Peak = the best 3 snapshots in a row; trend = change per 10 snapshots.' }),
    V({ id: 'v_my_rank_ribbon', name: 'My rank: rolling baseline and spread', queryId: 'q_my_rank', type: 'ribbon', color: 3, width: 3, window: 3 }),
  ];
  const SUSPECT: Filter[] = [{ field: 'case_name', op: 'contains', value: 'Oct 22' }];
  const HEADLINE: Filter[] = [{ field: 'headline', op: '=', value: '1' }];
  queries.push(
    Q({ id: 'q_st_summary', name: 'Smurf test: both hypotheses, every investigated player', dataset: 'smurf_test_summary', last: 0, followDashboard: false,
      measures: [{ field: 'p_if_not_smurf' }, { field: 'p_if_smurf' }, { field: 'bayes_factor' }, { field: 'posterior_smurf' }, { field: 'posterior_even_odds' }],
      groupBy: [{ field: 'case_name' }, { field: 'shown_rank' }] }),
    Q({ id: 'q_st_evidence', name: 'Smurf test: evidence, tested both ways', dataset: 'smurf_tests', last: 0,
      measures: [{ field: 'log10_lr' }, { field: 'p_value_if_not_smurf' }, { field: 'p_value_if_smurf' }], groupBy: [{ field: 'case_name' }, { field: 'evidence' }] }),
    Q({ id: 'q_st_weight', name: 'Smurf test: which way each piece of evidence points (Oct 22 suspect)', dataset: 'smurf_tests', last: 0, filters: SUSPECT,
      measures: m('log10_lr'), groupBy: [{ field: 'evidence' }] }),
    Q({ id: 'q_sm_sweep', name: 'Smurfs and the median: how far the median moves', dataset: 'smurf_sweep', last: 0, filters: [...HEADLINE, { field: 'smurf_share_pct', op: 'in', value: '0,1,2,3,4,5,6,7,8,9,10,12,14,16,18,20' }], sort: 'key_asc',
      measures: m('median_shift_points'), groupBy: [{ field: 'share_label' }, { field: 'scenario' }] }),
    Q({ id: 'q_sm_table', name: 'Smurfs and the median: median rank and ladder percentile by scenario', dataset: 'smurf_sweep', last: 0,
      filters: [...HEADLINE, { field: 'smurf_share_pct', op: 'in', value: '0,5,9,15,20' }],
      measures: [{ field: 'median_ladder_pct' }, { field: 'median_ladder_shift' }, { field: 'median_shift_points' }, { field: 'iqr_points' }], groupBy: [{ field: 'scenario' }, { field: 'share_label' }, { field: 'median_rank' }] }),
    Q({ id: 'q_sm_gap', name: 'Rank vs own lobby: established vs new accounts', dataset: 'smurf_gap_hist', last: 0, sort: 'key_asc',
      filters: [{ field: 'games_group', op: 'in', value: 'Established: 100+ season games,New: 20 or fewer season games' }],
      measures: m('share_pct'), groupBy: [{ field: 'gap_bin' }, { field: 'games_group' }] }),
    Q({ id: 'q_sm_shape', name: 'Could a symmetric distribution hide smurfs?', dataset: 'smurf_shape', last: 0,
      measures: [{ field: 'fisher_skew' }, { field: 'excess_kurtosis' }, { field: 'inside_observed_range' }], groupBy: [{ field: 'true_distribution' }, { field: 'smurf_share_pct' }] }),
    Q({ id: 'q_sm_lobby', name: 'One lobby: shown ranks vs Silver IV played as Plat IV', dataset: 'smurf_lobby', last: 0,
      measures: m('rank_points'), groupBy: [{ field: 'slot' }, { field: 'scenario' }] }),
  );
  vizs.push(
    V({ id: 'v_st_summary', name: 'Smurf or not: both hypotheses tested', queryId: 'q_st_summary', type: 'table', width: 6, note: 'p if NOT a smurf below 0.05 rejects "plays at their shown rank"; p if a smurf below 0.05 rejects "smurf". Neither rejected = the evidence cannot decide. The Bayes factor multiplies the items as if independent, which overstates certainty. The 9% prior is the share quoted from Riot.' }),
    V({ id: 'v_st_weight', name: 'Which way the evidence points: Oct 22 suspect', queryId: 'q_st_weight', type: 'bar', color: 8, width: 6, note: 'Right of zero favours a smurf, left favours not a smurf. +1 = ten times likelier if a smurf. From the op.gg screenshots until the API pull runs.' }),
    V({ id: 'v_st_evidence', name: 'Every piece of evidence, tested both ways', queryId: 'q_st_evidence', type: 'table', width: 6 }),
    V({ id: 'v_sm_sweep', name: 'If smurfs below the median were shown at their true rank, how far would the median move?', queryId: 'q_sm_sweep', type: 'column', color: 1, width: 6, note: 'Rank points (100 = one division) added to the median rank of the players met (Plat I 10 LP today), by the share of all players met who are smurfs from below the median. A leaves the median where it is; the upper bound is the most any share can move it.' }),
    V({ id: 'v_sm_table', name: 'Median rank under each scenario', queryId: 'q_sm_table', type: 'table', width: 3 }),
    V({ id: 'v_sm_lobby', name: 'One lobby of ten', queryId: 'q_sm_lobby', type: 'column', color: 4, width: 3, note: 'Sorted ranks. The median of ten is the average of slots 5 and 6: Gold III 83 LP shown, Gold III 99 LP with the Silver IV played as Plat IV. The mean moves five times as far as the median.' }),
    V({ id: 'v_sm_gap', name: 'How far below their own lobby players sit: established vs new accounts', queryId: 'q_sm_gap', type: 'column', color: 2, width: 6, note: 'Each player in your Ranked Solo games against the median of the other nine (rank today). New accounts sit 5+ divisions below their lobby in 38% of games, established ones in 3%, and new accounts are never far above it.' }),
    V({ id: 'v_sm_shape', name: 'Could 9% hidden smurfs sit inside a symmetric distribution?', queryId: 'q_sm_shape', type: 'table', width: 6, note: 'Observed skew of the players met: -0.03, 95% range -0.10 to +0.04. inside = 1 when the shown ranks would still look like what we observed.' }),
  );
  const T = (ids: string[]): Dashboard['tiles'] => ids.map((vizId, i) => ({ id: `t_${vizId}_${i}`, vizId }));
  const dashboards: Dashboard[] = [
    { id: 'd_lens', name: 'Lobby lens (no rank)', filters: [], tiles: T(['v_card', 'v_solo', 'v_vision', 'v_rel', 'v_jg']) },
    { id: 'd_trends', name: 'Trends & improvement', filters: [], tiles: T(['v_t_cs', 'v_t_win', 'v_t_lead', 'v_t_vision', 'v_t_slope', 'v_t_cum', 'v_t_delta']) },
    { id: 'd_showcase', name: 'Showcase & weights', filters: [], tiles: T(['v_curve', 'v_curve_w2', 'v_cs_plain', 'v_cs_len', 'v_showcase', 'v_gp_show', 'v_monthly']) },
    { id: 'd_profile', name: 'Player profile', filters: [], tiles: T(['v_profile', 'v_lobby_ribbon', 'v_cs_ribbon', 'v_met_hist', 'v_lobby_acct']) },
    { id: 'd_matchups', name: 'Champions & matchups', filters: [], tiles: T(['v_champ_wr', 'v_gp', 'v_kda_champ', 'v_heat']) },
    { id: 'd_met_rank', name: 'Who I play: rank distribution', description: 'The rank of everyone you have played with or against, against the whole ladder.', filters: [], tiles: T(['v_met_dist', 'v_met_dist_enemy', 'v_met_dist_ally', 'v_met_pct_hist', 'v_met_side']) },
    { id: 'd_smurf_test', name: 'Smurf test: both hypotheses', description: 'Every investigated player tested both ways: assume they play at their shown rank, and assume they are a smurf.', filters: [], tiles: T(['v_st_summary', 'v_st_weight', 'v_st_evidence']) },
    { id: 'd_smurf_median', name: 'Smurfs and the median', description: 'How hidden smurfs below the median would move the median and shape of the ranks of the players you meet.', filters: [], tiles: T(['v_sm_sweep', 'v_sm_table', 'v_sm_lobby', 'v_sm_gap', 'v_sm_shape']) },
    { id: 'd_tracking', name: 'Rank tracking', description: 'Rank snapshots over time: the players you met, and your own accounts.', filters: [], tiles: T(['v_flow_tier', 'v_flow_div', 'v_track_by_date', 'v_track_change', 'v_track_moved', 'v_my_rank_profile', 'v_my_rank_ribbon']) },
  ];
  return {
    id: 'lol', name: 'League of Legends', description: 'Your games, the players in your lobbies, and the players in theirs, from the Riot API pipeline.',
    domainNotes: [
      'Domain: League of Legends. games = the user\'s own games (accounts: takinturrets = main, asd123456efg = alt, Velocoraptor = new). lobby_players = recent games of everyone who shared a lobby with the user (the reference population). roster / lobby_relative = one row per player met.',
      'games.queue values: Ranked Solo, Ranked Flex, Normal Draft, Swiftplay. lobby_players.queue_name has the same names. position values: TOP, JUNGLE, MIDDLE, BOTTOM, UTILITY.',
      'opp_* columns on games are the lane opponent in the same game (opp_cs_per_min, opp_solo_kills, opp_kp, opp_vision_pm, opp_dmg_pm, opp_gold_pm, opp_obj_takedowns, opp_obj_damage, opp_lane_gold_adv, opp_cs_at_10). opp_rel_* = that opponent\'s average lead over their own lane opponents (second-degree baseline; opp_rel_cspm for CS per min). rel_* = the user\'s lead over the lane opponent.',
      'Default comparison for "vs my lobbies / lobby players" is reference dataset lobby_players filtered queue_name = Ranked Solo, weightBy position. "vs my lane opponents" is paired with the opp_ column. Rank and tier fields are hidden; do not build on them unless asked.',
      'Player profile: lobby_level = where the other nine players sit on the ladder (0-100 percentile, rank as of the pull). Baseline, consistency, peak and trend of any measure = viz type profile (one card per measure, no groupBy, last 0); a rolling baseline with its spread = viz type ribbon. Use agg median for per-game stats when the user asks for baseline or consistency; p25, p75 and iqr are available. roster.ladder_pct = each player met, ladder percentile today.',
      'Rank distribution: met_players = one row per player met with their rank today (rank_label in ladder order via rank_step, ladder_pct 0-100, side = ally / enemy / both). ladder = the NA solo-queue ladder, one row per division with players = accounts. "Rank of the players I play", "vs the ladder" → query met_players, measures [players], groupBy rank_label, filter rank_label not_null, last 0, visualization distribution with reference ladder. rank_tracking = one row per player met per rank snapshot (ladder_change, divisions_moved, moved_up compare with that player\'s previous snapshot). Rank flow = viz type flow on rank_tracking grouped by [prev_tier_name, tier_name] (or [prev_rank_label, rank_label] for divisions), measure players. my_rank = the user\'s own accounts over time (ladder_pct); baseline, consistency, peak and trend of the user\'s rank = profile on my_rank filtered to one account_name.',
      'Smurf test: smurf_tests = one row per evidence item per investigated player (case_name, evidence, log10_lr + = smurf, p_value_if_not_smurf, p_value_if_smurf); smurf_test_summary = one row per player (p_if_not_smurf, p_if_smurf, bayes_factor, posterior_smurf). smurf_sweep = median of the players met when a share (smurf_share_pct) of players below the median are smurfs, by scenario (headline = 1 for the four main ones). smurf_gap_hist = rank vs own lobby by season games group. smurf_shape = skew of shown ranks with hidden smurfs.',
      'game_weight = the user\'s highlight weight per game (1 when unset); highlighted = 1 for games weighted above 1. "Showcase", "highlight", "my best games" → weight game_weight or filter highlighted = 1. Weighting schemes are fields with role weight (w_learning_curve, w_main_role, w_support_half, w_duration, w_highlights); set query.weight to a weight field id or to an expression such as if(position = \'UTILITY\', 0.5, 1) or if(champion = \'Riven\' and champ_game_no > 150, 2, 1). champ_game_no = the Nth game on that champion in this history; champ_experience buckets it; hard_champion = 1 for mechanically hard champions. Time-weighted CS/min = field cs_per_min_tw (ratio of total CS to total minutes). enemy_jg_ganks_pre15 exists only for the user\'s own games.',
    ].join('\n'),
    suggestions: [
      { text: 'What rank are the players I actually play with and against?', vizId: 'v_met_dist' },
      { text: 'Are my opponents ranked higher than my teammates?', vizId: 'v_met_side' },
      { text: 'Where did the players I met move between snapshots?', vizId: 'v_flow_tier' },
      { text: 'How have the players I met moved since the last snapshot?', vizId: 'v_track_change' },
      { text: 'My rank: baseline, consistency, peak and trend', vizId: 'v_my_rank_profile' },
      { text: 'My baseline, consistency, peak and trend', vizId: 'v_profile' },
      { text: 'Is my lobby level rising or falling?', vizId: 'v_lobby_ribbon' },
      { text: 'Rank of everyone I have played with or against', vizId: 'v_met_hist' },
      { text: 'Which account gets the hardest lobbies?', vizId: 'v_lobby_acct' },
      { text: 'Is this player a smurf? Test both hypotheses', vizId: 'v_st_summary' },
      { text: 'If smurfs were shown at their true rank, how far would my median move?', vizId: 'v_sm_sweep' },
      { text: 'Is my CS per min more consistent on Gangplank than on my other champions?' },
      { text: 'My peak 20-game stretch for solo kills, and when it was' },
      { text: 'Are my solo kills rising while my lobby level stays flat?' },
    ],
    sources, items, datasets, fields, queries, visualizations: vizs, dashboards, activeDashboard: 'd_lens', seedVersion: 4,
  };
}
