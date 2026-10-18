"""Copies the League processed layer into the app's published snapshot, replacing other players'
Riot IDs and PUUIDs with short stable hashes. The user's own accounts keep their names.

  python3 scripts/make_snapshot.py <processed/latest> public/data/lol [names...]

With names, only those outputs are written (for example: met_rank_today ladder rank_tracking my_rank).
The rank files come from the folders next to processed/: ladder/*_summary.csv (the NA solo-queue
ladder), rank_snapshots/*.csv (daily ranks of everyone met) and lp_snapshots.csv (the user's accounts)."""
import csv, glob, hashlib, json, os, sys
src, out = sys.argv[1], sys.argv[2]
only = set(sys.argv[3:])
data = os.path.dirname(os.path.dirname(os.path.abspath(src)))
own_puuid, own_names = set(), set()
for f in glob.glob(f'{data}/raw/accounts/*.json'):
    a = json.load(open(f)); own_puuid.add(a.get('puuid')); own_names.add(f"{a.get('gameName')}#{a.get('tagLine')}")
h = lambda s, n: hashlib.sha1(s.encode()).hexdigest()[:n]
def rid(v):
    # Every other name is hashed, including real players whose names start or end with BOT.
    if not v or v in own_names: return v
    return 'player-' + h(v, 6)
def pid(v):
    if not v or v in own_puuid or v == 'BOT': return v
    return h(v, 12)
want = lambda name: not only or name in only

def write(name, fieldnames, rows):
    with open(f'{out}/{name}.csv', 'w', newline='') as fo:
        w = csv.DictWriter(fo, fieldnames=fieldnames, extrasaction='ignore'); w.writeheader(); w.writerows(rows)
    print(name, len(rows), 'rows', os.path.getsize(f'{out}/{name}.csv'), 'bytes')

for name in ['my_matchups', 'my_games', 'player_games', 'roster', 'lobby_relative', 'champion_baselines', 'tier_baselines', 'met_rank_today']:
    if not want(name): continue
    with open(f'{src}/{name}.csv', newline='') as fi:
        r = csv.DictReader(fi); rows = []
        for row in r:
            for c in ('riot_id', 'opp_riot_id'):
                if c in row: row[c] = rid(row[c])
            if 'puuid' in row: row['puuid'] = pid(row['puuid'])
            if 'other_names_seen' in row: row['other_names_seen'] = ''
            rows.append(row)
        write(name, r.fieldnames, rows)

# The ladder: players per tier and division, with the percentile range each division covers
# (0 = bottom of Iron, 100 = top of Challenger).
summ = sorted(glob.glob(f'{data}/ladder/*_summary.csv'))
div_pct, ladder = {}, []
if summ:
    prev = 0.0
    for r in csv.DictReader(open(summ[-1])):
        lo = float(r['top_pct_at_bottom_of_div']); div_pct[(r['tier'], r['division'])] = (prev, lo)
        ladder.append({'ladder_date': os.path.basename(summ[-1])[:10], 'tier': r['tier'], 'division': r['division'], 'accounts': r['accounts'],
                       'ladder_pct_low': round(100 - lo, 2), 'ladder_pct_high': round(100 - prev, 2), 'median_games': r['median_games'], 'median_wr': r['median_wr']})
        prev = lo
    if want('ladder'): write('ladder', list(ladder[0].keys()), ladder)

def top_pct(tier, d, lp):
    """Same method as the pipeline: interpolate by LP inside the division; Master and above sit mid-band."""
    if (tier, d or 'I') not in div_pct: return None
    top, bot = div_pct[(tier, d or 'I')]
    frac = 0.5 if tier in ('MASTER', 'GRANDMASTER', 'CHALLENGER') else min(max(float(lp or 0) / 100, 0), 0.99)
    return round(bot - frac * (bot - top), 2)

# Rank tracking: one row per player met per rank observation. The first observation is the cached
# rank the met-rank table used; later ones are the daily snapshots of everyone met.
if want('rank_tracking'):
    met = {r['puuid']: r for r in csv.DictReader(open(f'{src}/met_rank_today.csv'))}
    rows = []
    def add(puuid, day, tier, div, lp, source):
        m = met[puuid]
        tier = tier or 'UNRANKED'
        tp = top_pct(tier, div, lp) if tier != 'UNRANKED' else None
        rows.append({'snapshot_date': day, 'puuid': pid(puuid), 'riot_id': rid(m['riot_id']), 'side': m['side'], 'seen_on': m['seen_on'],
                     'games_together': m['games_together'], 'tier': tier, 'division': div if tier != 'UNRANKED' else '', 'lp': lp if tier != 'UNRANKED' else '',
                     'top_pct': '' if tp is None else tp, 'ladder_pct': '' if tp is None else round(100 - tp, 2), 'source': source})
    for p, m in met.items():
        day = m['rank_source'].split(' ')[-1] if m['rank_source'] != 'missing' else ''
        if day: add(p, day, m['tier_today'] if m['tier_today'] != 'UNRANKED' else '', m['division_today'], m['lp_today'], 'cached')
    for f in sorted(glob.glob(f'{data}/rank_snapshots/*.csv')):
        day, seen = os.path.basename(f)[:10], {}
        for r in csv.DictReader(open(f)):
            if r['puuid'] in met and r['queue'] in ('RANKED_SOLO_5x5', '') and (r['queue'] or r['puuid'] not in seen): seen[r['puuid']] = r
        for p, r in seen.items(): add(p, day, r['tier'], r['division'], r['lp'], 'snapshot')
    rows.sort(key=lambda r: (r['snapshot_date'], r['puuid']))
    write('rank_tracking', list(rows[0].keys()), rows)

# The user's own accounts over time.
if want('my_rank') and os.path.exists(f'{data}/lp_snapshots.csv'):
    rows = []
    for r in csv.DictReader(open(f'{data}/lp_snapshots.csv')):
        tp = top_pct(r['tier'], r['division'], r['lp']) if r['tier'] and r['tier'] != 'UNRANKED' else None
        rows.append({'snapshot_utc': r['utc'][:19] + 'Z', 'account': r['account'], 'tier': r['tier'] or 'UNRANKED', 'division': r['division'], 'lp': r['lp'],
                     'ranked_games': r['ranked_games'], 'top_pct': '' if tp is None else tp, 'ladder_pct': '' if tp is None else round(100 - tp, 2)})
    write('my_rank', list(rows[0].keys()), rows)
