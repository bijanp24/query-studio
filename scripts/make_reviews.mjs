// Generates the clearly-labeled example data for the "Reviews" workspace: 1-to-5 star reviews of
// three made-up titles, one of which is review-bombed. Deterministic (seeded), so rebuilding gives
// identical files. Usage: node scripts/make_reviews.mjs public/data/examples
//
//   Starfall Tactics (game)  a typical J-shaped spread, then a pricing patch on 2026-09-15 followed by
//                            ten days of 1-star reviews from accounts days old with no playtime; the
//                            established players also cool a little (real criticism, not bombing)
//   Harbor Lights (movie)    a steady hump around 4 stars all year: the control, nothing happens
//   Ironclad Rally (game)    a genuinely poor launch on 2026-08-01: low stars from established
//                            accounts with real playtime, one peak, no burst
import fs from 'node:fs';
const out = process.argv[2];
let seed = 20261024; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
const pick = (w) => { const t = w.reduce((a, b) => a + b, 0); let u = rnd() * t; for (let i = 0; i < w.length; i++) { u -= w[i]; if (u <= 0) return i; } return w.length - 1; };
const poisson = (mu) => { let k = 0, p = Math.exp(-mu), c = p; const u = rnd(); while (u > c && k < 1000) { k++; p *= mu / k; c += p; } return k; };
const day = (d) => new Date(Date.UTC(2026, 0, 1) + d * 864e5).toISOString().slice(0, 10);
const dayIndex = (iso) => Math.round((Date.parse(iso + 'T00:00:00Z') - Date.UTC(2026, 0, 1)) / 864e5);
const PATCH = dayIndex('2026-09-15'), END = dayIndex('2026-10-20');
const rows = []; let id = 1;
const LABEL = ['1 star', '2 stars', '3 stars', '4 stars', '5 stars'];
function add(title, kind, d, stars, organic) {
  // Organic reviewers have older accounts, more reviews and real playtime; bombers are days old, write a few words, barely played.
  const age = organic ? Math.round(60 + rnd() * 2400) : Math.round(rnd() * 12);
  const n = organic ? 1 + poisson(14) : 1 + (rnd() < 0.2 ? 1 : 0);
  const hours = kind === 'game' ? +(organic ? 2 + rnd() * 140 : rnd() * 0.6).toFixed(1) : '';
  const words = organic ? 15 + Math.round(rnd() * 220) : 2 + Math.round(rnd() * 12);
  rows.push({ review_id: `R${String(id++).padStart(6, '0')}`, title, kind, review_date: day(d), stars: stars + 1, star_label: LABEL[stars],
    account_age_days: age, account_reviews: n, playtime_hours: hours, review_words: words, verified: organic ? (rnd() < 0.85 ? 1 : 0) : (rnd() < 0.1 ? 1 : 0),
    period: d >= PATCH ? 'after 2026-09-15' : 'before 2026-09-15' });
}
for (let d = 0; d <= END; d++) {
  // Starfall Tactics: J-shaped like most games; after the patch established players drift down a little.
  const sf = d >= PATCH ? [8, 6, 12, 30, 44] : [6, 4, 9, 28, 53];
  for (let i = poisson(d >= PATCH ? 24 : 18); i > 0; i--) add('Starfall Tactics', 'game', d, pick(sf), true);
  if (d >= PATCH && d < PATCH + 10) for (let i = poisson(d < PATCH + 3 ? 50 : 15); i > 0; i--) add('Starfall Tactics', 'game', d, rnd() < 0.93 ? 0 : 1, false);
  // Harbor Lights: one hump around 4 stars, all year.
  for (let i = poisson(11); i > 0; i--) add('Harbor Lights', 'movie', d, pick([3, 6, 18, 42, 31]), true);
  // Ironclad Rally: released 2026-08-01, poorly received by the people who actually played it.
  if (d >= dayIndex('2026-08-01')) for (let i = poisson(d < dayIndex('2026-08-15') ? 45 : 14); i > 0; i--) add('Ironclad Rally', 'game', d, pick([30, 27, 22, 14, 7]), true);
}
const csv = [Object.keys(rows[0]).join(','), ...rows.map(r => Object.values(r).join(','))].join('\n') + '\n';
fs.writeFileSync(`${out}/reviews.csv`, csv);
console.log(rows.length, 'reviews');
