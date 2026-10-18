"""Copies the League processed layer into the app's published snapshot, replacing other players'
Riot IDs and PUUIDs with short stable hashes. The user's own accounts keep their names."""
import csv, glob, hashlib, json, os, sys
src, out = sys.argv[1], sys.argv[2]
own_puuid, own_names = set(), set()
for f in glob.glob('/mnt/project-files/data/raw/accounts/*.json'):
    a = json.load(open(f)); own_puuid.add(a.get('puuid')); own_names.add(f"{a.get('gameName')}#{a.get('tagLine')}")
h = lambda s, n: hashlib.sha1(s.encode()).hexdigest()[:n]
def rid(v):
    # Every other name is hashed, including real players whose names start or end with BOT.
    if not v or v in own_names: return v
    return 'player-' + h(v, 6)
def pid(v):
    if not v or v in own_puuid or v == 'BOT': return v
    return h(v, 12)
for name in ['my_matchups', 'my_games', 'player_games', 'roster', 'lobby_relative', 'champion_baselines', 'tier_baselines']:
    with open(f'{src}/{name}.csv', newline='') as fi, open(f'{out}/{name}.csv', 'w', newline='') as fo:
        r = csv.DictReader(fi); w = csv.DictWriter(fo, fieldnames=r.fieldnames); w.writeheader()
        for row in r:
            for c in ('riot_id', 'opp_riot_id'):
                if c in row: row[c] = rid(row[c])
            if 'puuid' in row: row['puuid'] = pid(row['puuid'])
            if 'other_names_seen' in row: row['other_names_seen'] = ''
            w.writerow(row)
    print(name, os.path.getsize(f'{out}/{name}.csv'))
