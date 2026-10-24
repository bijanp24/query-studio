// Builds src/social/sample.json: the small, already-aggregated numbers the Social page draws. It reads
// only the published sample in public/data (other players are hashed there), keeps no per-player rows,
// and is deterministic, so rerunning it after a snapshot refresh changes only the numbers.
import { readFileSync, writeFileSync } from 'node:fs';

function csv(path) {
  const text = readFileSync(path, 'utf8'); const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [head, ...body] = rows;
  return body.filter(r => r.length > 1).map(r => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
}
const D = 'public/data/lol/';
const num = v => (v === '' || v == null ? NaN : +v);
const median = a => { const s = a.filter(Number.isFinite).sort((x, y) => x - y); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : NaN; };
const mean = a => { const s = a.filter(Number.isFinite); return s.reduce((x, y) => x + y, 0) / s.length; };
const r2 = x => Math.round(x * 100) / 100, r1 = x => Math.round(x * 10) / 10;

// Rank points: 100 per division, Iron IV = 0, Master and above from 2800 plus LP.
const TIERS = ['IRON', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'EMERALD', 'DIAMOND'];
const DIVS = ['IV', 'III', 'II', 'I'];
const nice = t => t[0] + t.slice(1).toLowerCase();
const short = { IRON: 'Iron', BRONZE: 'Bronze', SILVER: 'Silver', GOLD: 'Gold', PLATINUM: 'Plat', EMERALD: 'Emerald', DIAMOND: 'Diamond' };
function label(p) {
  if (p >= 2800) return 'Master+';
  const t = Math.floor(p / 400), d = Math.floor((p % 400) / 100);
  return `${nice(TIERS[t])} ${DIVS[d]}`;
}
const divIndex = (tier, div) => TIERS.indexOf(tier) * 4 + DIVS.indexOf(div);

// ---------- ladder (the population) ----------
const ladder = csv(D + 'ladder.csv').map(r => ({ tier: r.tier, div: r.division, n: num(r.accounts) }));
const ladderTotal = ladder.reduce((s, r) => s + r.n, 0);
const ladderDiv = {}; // division index -> accounts; Master+ = 28
for (const r of ladder) { const i = TIERS.includes(r.tier) ? divIndex(r.tier, r.div) : 28; ladderDiv[i] = (ladderDiv[i] || 0) + r.n; }

// ---------- players met (the sample) ----------
const met = csv(D + 'met_rank_today.csv').filter(r => r.tier_today && r.tier_today !== 'UNRANKED' && Number.isFinite(num(r.rank_score_today)));
const metPts = met.map(r => num(r.rank_score_today));
const metDiv = {};
for (const r of met) { const i = TIERS.includes(r.tier_today) ? divIndex(r.tier_today, r.division_today) : 28; metDiv[i] = (metDiv[i] || 0) + 1; }
const metMedian = median(metPts);
// Ladder median: walk the cumulative count, assume LP spread evenly inside each division.
function ladderQuantile(q) {
  let acc = 0; const target = q * ladderTotal;
  for (let i = 0; i <= 28; i++) { const n = ladderDiv[i] || 0; if (acc + n >= target) return i * 100 + 100 * (target - acc) / n; acc += n; }
  return 2800;
}
const ladderMedian = ladderQuantile(0.5);
const pctBelow = p => { let acc = 0; for (let i = 0; i <= 28; i++) { const n = ladderDiv[i] || 0; if ((i + 1) * 100 <= p) acc += n; else { acc += n * Math.max(0, (p - i * 100) / 100); break; } } return 100 * acc / ladderTotal; };

const tierShare = (counts, total) => [...TIERS.map((t, k) => ({ label: short[t], v: [0, 1, 2, 3].reduce((s, d) => s + (counts[k * 4 + d] || 0), 0) / total * 100 })), { label: 'Master+', v: (counts[28] || 0) / total * 100 }];
const metTiers = tierShare(metDiv, met.length), ladTiers = tierShare(ladderDiv, ladderTotal);

// ---------- sample vs population ----------
// 1,000 random samples drawn from the ladder, each the effective size of the met sample (56% of rank
// variance sits between games, so the ~8,900 players behave like ~1,784 independent ones).
const EFF_N = 1784;
let seed = 20261024; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
const cum = []; { let a = 0; for (let i = 0; i <= 28; i++) { a += (ladderDiv[i] || 0) / ladderTotal; cum.push(a); } }
const draw = () => { const u = rnd(); let i = 0; while (cum[i] < u) i++; return i * 100 + rnd() * 100; };
const sims = [];
for (let s = 0; s < 1000; s++) { const a = []; for (let k = 0; k < EFF_N; k++) a.push(draw()); sims.push(median(a)); }
sims.sort((x, y) => x - y);
const simLo = sims[25], simHi = sims[974], simMax = sims[999];
const beat = sims.filter(m => m < metMedian).length;
// Histogram of the simulated medians, in 25-point bins, plus where the real one sits.
const simBins = {}; for (const m of sims) { const b = Math.floor(m / 25) * 25; simBins[b] = (simBins[b] || 0) + 1; }

// ---------- the mode ----------
const divRows = Object.entries(metDiv).map(([i, n]) => ({ i: +i, n })).sort((a, b) => b.n - a.n);
const ladderMode = Object.entries(ladderDiv).map(([i, n]) => ({ i: +i, n })).sort((a, b) => b.n - a.n)[0];
const divLabel = i => (i === 28 ? 'Master+' : `${short[TIERS[Math.floor(i / 4)]]} ${DIVS[i % 4]}`);
const modeTop = divRows.slice(0, 6).map(r => ({ label: divLabel(r.i), v: r.n / met.length * 100, ref: (ladderDiv[r.i] || 0) / ladderTotal * 100 }));

// ---------- me vs my lobby ----------
const lr = csv(D + 'lobby_relative.csv');
const me = lr.find(r => r.riot_id === 'takinturrets#NA1');
const others = lr.filter(r => r.riot_id.startsWith('player-') && num(r.ranked_games_parsed) >= 10);
const STATS = [
  ['mean_cspm', 'CS / min', 1, 2], ['mean_kp', 'Kill participation', 1, 0], ['mean_dmg_pm', 'Damage / min', 1, 0],
  ['mean_gold_pm', 'Gold / min', 1, 0], ['mean_solo_kills', 'Solo kills / game', 1, 1], ['mean_deaths', 'Deaths / game', -1, 1], ['mean_vision_pm', 'Vision / min', 1, 2],
];
const lobby = STATS.map(([k, name, dir, dp]) => {
  const mine = num(me[k]), lob = median(others.map(r => num(r[k])));
  const pct = (mine - lob) / lob * 100;
  return { label: name, me: k === 'mean_kp' ? mine * 100 : mine, lobby: k === 'mean_kp' ? lob * 100 : lob, pct: r1(pct), better: dir * pct > 0, unit: k === 'mean_kp' ? '%' : '', dp };
});

// ---------- farming ----------
const pg = csv(D + 'player_games.csv').filter(r => r.position && r.position !== 'UTILITY' && Number.isFinite(num(r.cs_per_min)));
const TIER_N = ['Iron', 'Bronze', 'Silver', 'Gold', 'Platinum', 'Emerald', 'Diamond'];
const csByTier = TIER_N.map(t => { const g = pg.filter(r => r.rank.split(' ')[0] === t); return { label: t === 'Platinum' ? 'Plat' : t, v: median(g.map(r => num(r.cs_per_min))), n: g.length }; }).filter(r => r.n >= 150);
const byPlayer = {};
for (const r of pg) (byPlayer[r.puuid] ||= []).push(r);
const players = Object.values(byPlayer).filter(g => g.length >= 15).map(g => ({ cs: mean(g.map(r => num(r.cs_per_min))), wr: mean(g.map(r => num(r.win))) }));
const BUCKETS = [[5, 5.5], [5.5, 6], [6, 6.5], [6.5, 7], [7, 7.5], [7.5, 8], [8, 9]];
const wrByCs = BUCKETS.map(([a, b]) => { const g = players.filter(p => p.cs >= a && p.cs < b); return { label: `${a}–${b}`, v: mean(g.map(p => p.wr)) * 100, n: g.length }; }).filter(r => r.n >= 50);
const myGames = csv(D + 'my_matchups.csv').filter(r => r.account === 'takinturrets#NA1' && r.position !== 'UTILITY');
const myCs = median(myGames.map(r => num(r.cs_per_min)));

// ---------- review bombing (synthetic example) ----------
const rv = csv('public/data/examples/reviews.csv').filter(r => r.title === 'Starfall Tactics');
const starShare = rows => [1, 2, 3, 4, 5].map(s => rows.filter(r => +r.stars === s).length / rows.length * 100);
const before = rv.filter(r => r.period.startsWith('before')), after = rv.filter(r => r.period.startsWith('after'));
const cleaned = after.filter(r => +r.account_age_days >= 30);
const avg = rows => mean(rows.map(r => +r.stars));

const out = {
  generated: new Date().toISOString().slice(0, 10),
  rank: {
    players: met.length, ladderAccounts: ladderTotal,
    metMedian: label(metMedian), metMedianPct: r1(100 - pctBelow(metMedian)), ladderMedian: label(ladderMedian),
    gapDivisions: r1((metMedian - ladderMedian) / 100),
    tiers: metTiers.map((t, k) => ({ label: t.label, v: r1(t.v), ref: r1(ladTiers[k].v) })),
  },
  sample: {
    effN: EFF_N, sims: 1000, beat, real: label(metMedian), lo: label(simLo), hi: label(simHi), maxSim: label(simMax),
    gapDivisions: r1((metMedian - simHi) / 100),
    hist: Object.entries(simBins).map(([b, n]) => ({ label: label(+b), x: +b, v: n })).sort((a, b) => a.x - b.x), realX: metMedian,
  },
  mode: {
    top: modeTop.map(r => ({ ...r, v: r1(r.v), ref: r1(r.ref) })), ladderMode: divLabel(ladderMode.i),
    modeTopPct: r1(100 - pctBelow((divRows[0].i + 1) * 100)),
  },
  lobby: { account: 'takinturrets', games: num(me.ranked_games_parsed), lobbyPlayers: others.length, stats: lobby.map(s => ({ ...s, me: +s.me.toFixed(s.dp), lobby: +s.lobby.toFixed(s.dp) })) },
  farming: { byTier: csByTier.map(r => ({ label: r.label, v: r2(r.v) })), wrByCs: wrByCs.map(r => ({ label: r.label, v: r1(r.v), n: r.n })), players: players.length, games: pg.length, mine: r2(myCs), myGames: myGames.length },
  reviews: {
    title: 'Starfall Tactics', before: starShare(before).map(r1), after: starShare(after).map(r1), cleaned: starShare(cleaned).map(r1),
    nBefore: before.length, nAfter: after.length, nCleaned: cleaned.length, avgBefore: r2(avg(before)), avgAfter: r2(avg(after)), avgCleaned: r2(avg(cleaned)),
  },
};
writeFileSync('src/social/sample.json', JSON.stringify(out, null, 1) + '\n');
console.log(JSON.stringify(out, null, 1));
