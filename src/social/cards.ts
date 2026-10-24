// The Social page's three stories and their cards. Every card shares one shape, so any card can be
// drawn in any chart style: that is the plug-and-play part. The numbers come from sample.json, which
// scripts/make_social_sample.mjs builds from the published (hashed) sample data.
import S from './sample.json';

export type Style = 'rows' | 'bars' | 'big';
export type Tone = 'me' | 'ref' | 'good' | 'bad';
export interface Item { label: string; v: number; text?: string; ref?: number; refText?: string; tone?: Tone }
export interface Card {
  id: string;
  kicker: string;
  title: string;
  sub: string;
  items: Item[];
  vName: string;
  refName?: string;
  /** Draw a dashed line across the chart at this value (e.g. a 50% win rate). */
  line?: { v: number; label: string };
  /** Values go below zero: draw from a zero line. */
  diverging?: boolean;
  big: { value: string; caption: string };
  foot: string;
  style: Style;
  styles: Style[];
}
export interface Story { id: string; name: string; blurb: string; cards: Card[] }

const pct = (v: number, dp = 0) => `${v.toFixed(dp)}%`;
const signed = (v: number) => `${v > 0 ? '+' : ''}${Math.round(v)}%`;
const ALL: Style[] = ['rows', 'bars', 'big'];

const L = S.lobby, F = S.farming, R = S.rank, SP = S.sample, M = S.mode, RV = S.reviews;
const better = L.stats.filter(s => s.better).length;
const solo = L.stats.find(s => s.label.startsWith('Solo'))!;
const cs = L.stats.find(s => s.label.startsWith('CS'))!;

const lobby: Card[] = [
  {
    id: 'lobby-stats', kicker: 'Me vs my lobby', title: `Better than my lobby at ${better} of ${L.stats.length} things`,
    sub: `My ${L.games} ranked games against the median of the ${L.lobbyPlayers.toLocaleString('en-US')} players I met.`,
    items: L.stats.map(s => ({ label: s.label, v: s.pct, text: signed(s.pct), tone: s.better ? 'good' : 'bad', refText: `${s.me}${s.unit} vs ${s.lobby}${s.unit}` })),
    vName: 'difference from the lobby median', diverging: true,
    big: { value: signed(solo.pct), caption: `more solo kills per game than my lobby (${solo.me} vs ${solo.lobby})` },
    foot: 'Green = better than the lobby. Fewer deaths counts as better.', style: 'rows', styles: ALL,
  },
  {
    id: 'farming-rank', kicker: 'Farming', title: 'CS per minute climbs with rank',
    sub: `Median CS/min by rank in ${F.games.toLocaleString('en-US')} lane games of players I met, and mine.`,
    items: [...F.byTier.map(t => ({ label: t.label, v: t.v, text: t.v.toFixed(2), tone: 'ref' as Tone })), { label: 'Me', v: F.mine, text: F.mine.toFixed(2), tone: 'me' }],
    vName: 'CS per minute',
    big: { value: F.mine.toFixed(2), caption: `my CS/min, against ${cs.lobby} for my lobby: between the Emerald and Diamond medians` },
    foot: 'Supports left out. Rank = the player\'s current rank.', style: 'bars', styles: ALL,
  },
  {
    id: 'farming-wins', kicker: 'Farming', title: 'Farming more barely moves your win rate',
    sub: `Win rate of ${F.wrByCs.reduce((s, b) => s + b.n, 0).toLocaleString('en-US')} players grouped by their CS/min. Better farmers climb, then win about half.`,
    items: F.wrByCs.map(b => ({ label: b.label, v: b.v, text: pct(b.v), tone: 'me' as Tone })),
    vName: 'win rate', line: { v: 50, label: '50%' },
    big: { value: `${(F.wrByCs[F.wrByCs.length - 1].v - F.wrByCs[0].v).toFixed(0)} pts`, caption: `win-rate gap between the lowest and highest farmers (${pct(F.wrByCs[0].v)} vs ${pct(F.wrByCs[F.wrByCs.length - 1].v)})` },
    foot: 'Players with 15+ lane games; groups of 50+ players.', style: 'bars', styles: ALL,
  },
];

const ranks: Card[] = [
  {
    id: 'rank-shape', kicker: 'Who I get matched with', title: `My lobbies sit ${R.gapDivisions} divisions above the ladder`,
    sub: `Rank of the ${R.players.toLocaleString('en-US')} ranked players I met, against all ${(R.ladderAccounts / 1e6).toFixed(2)}M NA accounts.`,
    items: R.tiers.map(t => ({ label: t.label, v: t.v, text: pct(t.v), ref: t.ref, refText: pct(t.ref), tone: 'me' as Tone })),
    vName: 'players I met', refName: 'NA ladder',
    big: { value: R.metMedian, caption: `the median player I meet (top ${Math.round(R.metMedianPct)}% of NA). The ladder median is ${R.ladderMedian}.` },
    foot: 'Share of players in each tier.', style: 'bars', styles: ALL,
  },
  {
    id: 'sample-pop', kicker: 'Sample vs population', title: 'Random players would never look like my lobbies',
    sub: `${SP.sims.toLocaleString('en-US')} random groups of ${SP.effN.toLocaleString('en-US')} NA players. Their median rank, against the median of who I actually met.`,
    items: [
      { label: 'Typical random group', v: SP.hist.reduce((b, h) => (h.v > b.v ? h : b)).x + 12, text: SP.lo === SP.hi ? SP.lo : `${SP.lo}–${SP.hi.split(' ')[1]}`, tone: 'ref' },
      { label: `Highest of ${SP.sims.toLocaleString('en-US')}`, v: SP.hist[SP.hist.length - 1].x + 25, text: SP.maxSim, tone: 'ref' },
      { label: 'My lobbies', v: SP.realX, text: SP.real, tone: 'me' },
    ],
    vName: 'median rank (Iron IV at zero)',
    big: { value: `${SP.beat.toLocaleString('en-US')}/${SP.sims.toLocaleString('en-US')}`, caption: `random groups land below my lobbies. The gap is ${SP.gapDivisions} divisions.` },
    foot: '~8,900 players count as ~1,784 independent ones: players in one game share a rank.', style: 'rows', styles: ALL,
  },
  {
    id: 'mode', kicker: 'The mode', title: `The rank I meet most: ${M.top[0].label.replace('Plat', 'Platinum')}`,
    sub: `The most common ranks among players I met, next to how common they are on the ladder (where the mode is ${M.ladderMode}).`,
    items: M.top.map((t, i) => ({ label: t.label, v: t.v, text: pct(t.v, 1), ref: t.ref, refText: pct(t.ref, 1), tone: i === 0 ? 'me' : 'ref' as Tone })),
    vName: 'players I met', refName: 'NA ladder',
    big: { value: M.top[0].label, caption: `${pct(M.top[0].v, 1)} of everyone I met, more than twice its ${pct(M.top[0].ref, 1)} share of the ladder` },
    foot: 'One peak, no second hump. Top 6 divisions shown.', style: 'rows', styles: ALL,
  },
];

const stars = ['1★', '2★', '3★', '4★', '5★'];
const reviews: Card[] = [
  {
    id: 'bomb', kicker: 'Spot a review bomb', title: `1-star reviews jumped ${Math.round(RV.after[0] / RV.before[0])}× after a patch`,
    sub: `${RV.title}: ${RV.nAfter.toLocaleString('en-US')} reviews after a patch, next to the ${RV.nBefore.toLocaleString('en-US')} before it.`,
    items: RV.after.map((v, i) => ({ label: stars[i], v, text: pct(v), ref: RV.before[i], refText: pct(RV.before[i]), tone: i === 0 ? 'bad' : 'me' as Tone })),
    vName: 'after the patch', refName: 'before',
    big: { value: pct(RV.after[0]), caption: `of reviews are 1 star now, up from ${pct(RV.before[0])}. A second peak = a second crowd.` },
    foot: 'Example data: a made-up game, built to show the method.', style: 'bars', styles: ALL,
  },
  {
    id: 'bomb-clean', kicker: 'Spot a review bomb', title: 'Drop brand-new accounts and the spike is gone',
    sub: `The same reviews, keeping only accounts 30+ days old (${RV.nCleaned.toLocaleString('en-US')} of ${RV.nAfter.toLocaleString('en-US')}).`,
    items: RV.cleaned.map((v, i) => ({ label: stars[i], v, text: pct(v), ref: RV.before[i], refText: pct(RV.before[i]), tone: 'good' as Tone })),
    vName: 'established accounts', refName: 'before the patch',
    big: { value: `${RV.nAfter - RV.nCleaned}`, caption: 'reviews from accounts under 30 days old. Most of the 1-stars came from them.' },
    foot: 'What is left is real, milder criticism. Keep it.', style: 'bars', styles: ALL,
  },
  {
    id: 'bomb-avg', kicker: 'Spot a review bomb', title: 'The average hides it. The mode doesn\'t.',
    sub: 'Average stars only dip. The share of 1-star reviews tells you a crowd showed up.',
    items: [
      { label: 'Avg before', v: RV.avgBefore, text: `${RV.avgBefore.toFixed(1)}★`, tone: 'ref' },
      { label: 'Avg after', v: RV.avgAfter, text: `${RV.avgAfter.toFixed(1)}★`, tone: 'bad' },
      { label: 'Avg, cleaned', v: RV.avgCleaned, text: `${RV.avgCleaned.toFixed(1)}★`, tone: 'good' },
    ],
    vName: 'average stars (out of 5)',
    big: { value: `−${(RV.avgBefore - RV.avgAfter).toFixed(1)}★`, caption: `is all the average moved, while 1-star reviews went from ${pct(RV.before[0])} to ${pct(RV.after[0])}` },
    foot: 'Example data: a made-up game, built to show the method.', style: 'big', styles: ALL,
  },
];

export const STORIES: Story[] = [
  { id: 'lobby', name: 'Me vs my lobby', blurb: 'My stats against the players I actually meet, and what farming does.', cards: lobby },
  { id: 'ranks', name: 'Who I get matched with', blurb: 'Rank of everyone I met vs the ladder, random samples, and the mode.', cards: ranks },
  { id: 'reviews', name: 'Spot a review bomb', blurb: 'The same tools on 1–5 star reviews: find the fake crowd.', cards: reviews },
];
export const GENERATED = S.generated;
