"""Runs the compiled SQL in DuckDB over the tables the local engine built and compares the numbers."""
import json, math, sys, os
import duckdb

OUT = sys.argv[1]
TOL = 1e-6
report = json.load(open(os.path.join(OUT, 'cases.json')))
TYPES = {'number': 'DOUBLE', 'string': 'VARCHAR', 'time': 'VARCHAR'}

def close(a, b):
    if a is None or b is None: return a is None and b is None
    try: a, b = float(a), float(b)
    except (TypeError, ValueError): return str(a) == str(b)
    if math.isnan(a) and math.isnan(b): return True
    return abs(a - b) <= TOL * max(1, abs(a), abs(b))

def key(v):
    if v is None: return None
    try:
        f = float(v)
        return str(int(f)) if f == int(f) else repr(f)
    except (TypeError, ValueError): return str(v)

def load(con, name, d, file, columns):
    cols = ', '.join(f"'{c['name']}': '{TYPES[c['type']]}'" for c in columns)
    con.execute(f"CREATE OR REPLACE TABLE {name} AS SELECT * FROM read_csv('{os.path.join(d, file)}', header=true, nullstr='\\N', columns={{{cols}}}, quote='\"', escape='\"', auto_detect=false)")

fails, passes, notes = [], 0, []
for w in report:
    d = os.path.join(OUT, w['ws']); con = duckdb.connect()
    for it in w['items']: load(con, 'src_' + it['id'].lower(), d, it['file'], it['columns'])
    for ds in w['datasets']: load(con, ds['sqlName'], d, ds['file'], ds['columns'])
    # Processed-layer build: the SQL build must give the same table as the in-browser build.
    for ds in w['datasets']:
        cols = [c['name'] for c in ds['columns']]
        try:
            con.execute(f"CREATE OR REPLACE TEMP TABLE sqlbuild AS {ds['buildSql']}")
        except Exception as e:
            fails.append(f"{w['ws']}/build {ds['id']}: SQL error {str(e)[:300]}"); continue
        have = [r[0] for r in con.execute("DESCRIBE sqlbuild").fetchall()]
        missing = [c for c in cols if c not in have]
        if missing: fails.append(f"{w['ws']}/build {ds['id']}: SQL build lacks {missing}"); continue
        n_sql = con.execute("SELECT COUNT(*) FROM sqlbuild").fetchone()[0]
        if n_sql != ds['rows']: fails.append(f"{w['ws']}/build {ds['id']}: rows {n_sql} vs {ds['rows']}"); continue
        num = [c['name'] for c in ds['columns'] if c['type'] == 'number']
        txt = [c['name'] for c in ds['columns'] if c['type'] != 'number']
        bad = []
        for c in num:
            a = con.execute(f'SELECT SUM(CAST("{c}" AS DOUBLE)), COUNT("{c}") FROM sqlbuild').fetchone()
            b = con.execute(f'SELECT SUM("{c}"), COUNT("{c}") FROM {ds["sqlName"]}').fetchone()
            if not (close(a[0], b[0]) and a[1] == b[1]): bad.append(f"{c} sum/count {a} vs {b}")
        for c in txt:
            a = con.execute(f'SELECT COUNT(DISTINCT CAST("{c}" AS VARCHAR)), COUNT("{c}") FROM sqlbuild').fetchone()
            b = con.execute(f'SELECT COUNT(DISTINCT "{c}"), COUNT("{c}") FROM {ds["sqlName"]}').fetchone()
            if a != b: bad.append(f"{c} distinct/count {a} vs {b}")
        if bad: fails.append(f"{w['ws']}/build {ds['id']}: " + '; '.join(bad[:6]))
        else: passes += 1

    for c in w['cases']:
        e, sql = c['engine'], c['sql']; tag = f"{w['ws']}/{c['id']}"
        try: rows = con.execute(sql['main']).fetchall(); desc = [x[0] for x in con.description]
        except Exception as ex: fails.append(f"{tag}: SQL error {str(ex)[:400]}\n{sql['main'][:1500]}"); continue
        problems = []
        ix = {n: i for i, n in enumerate(desc)}
        if e['seriesOp'] != 'none' and not e['grouped']:
            got = [r[ix['value']] for r in rows]
            want = e['series'] or []
            if len(got) != len(want): problems.append(f"series length {len(got)} vs {len(want)}")
            else:
                bad = [i for i, (a, b) in enumerate(zip(got, want)) if not close(a, b)]
                if bad: problems.append(f"series differs at {len(bad)} points, first {bad[0]}: {got[bad[0]]} vs {want[bad[0]]}")
        elif e['grouped']:
            nd = len([k for k in desc if k.startswith('d') and k[1:].isdigit()])
            if e['seriesOp'] != 'none':
                got = {tuple(key(r[ix[f'd{k+1}']]) for k in range(nd)): r[ix['value']] for r in rows}
                want = {tuple(key(x) for x in g['keys']): g['values'][0] for g in e['groups']}
            else:
                got = {tuple(key(r[ix[f'd{k+1}']]) for k in range(nd)): [r[ix['n']]] + [r[ix[f'm{j+1}']] for j in range(len(e['values']))] for r in rows}
                want = {tuple(key(x) for x in g['keys']): [g['n']] + g['values'] for g in e['groups']}
            if set(got) != set(want):
                problems.append(f"group keys differ: only SQL {sorted(set(got)-set(want), key=str)[:5]}, only engine {sorted(set(want)-set(got), key=str)[:5]}")
            for k in set(got) & set(want):
                a, b = got[k], want[k]
                if isinstance(a, list):
                    if not all(close(x, y) for x, y in zip(a, b)): problems.append(f"group {k}: {a} vs {b}"); break
                elif not close(a, b): problems.append(f"group {k}: {a} vs {b}"); break
            if e['seriesOp'] == 'none' and not problems:
                order_sql = [tuple(key(r[ix[f'd{k+1}']]) for k in range(nd)) for r in rows]
                order_eng = [tuple(key(x) for x in g['keys']) for g in e['groups']]
                if order_sql != order_eng: notes.append(f"{tag}: same groups, different order (first SQL {order_sql[:3]}, engine {order_eng[:3]})")
            if sql.get('totals') and e.get('totals'):
                trows = con.execute(sql['totals']).fetchall(); td = [x[0] for x in con.description]; tix = {n: i for i, n in enumerate(td)}
                tg = {}
                for r in trows:
                    k = key(r[tix['d1']]) if 'd1' in tix else None
                    tg[k] = [r[tix['n']]] + [r[tix[f'm{j+1}']] for j in range(len(e['values']))]
                tw = {(key(g['keys'][0]) if g['total'] == 'subtotal' else None): [g['n']] + g['values'] for g in e['totals']}
                if set(tg) != set(tw): problems.append(f"totals keys differ {sorted(map(str,tg))[:4]} vs {sorted(map(str,tw))[:4]}")
                else:
                    for k in tw:
                        if not all(close(x, y) for x, y in zip(tg[k], tw[k])): problems.append(f"total {k}: {tg[k]} vs {tw[k]}"); break
        else:
            r = rows[0]
            if r[ix['n']] != e['n']: problems.append(f"n {r[ix['n']]} vs {e['n']}")
            for j, v in enumerate(e['values']):
                if e['weightedMedian']: continue
                if not close(r[ix[f'm{j+1}']], v): problems.append(f"m{j+1} {r[ix[f'm{j+1}']]} vs {v}")
        if sql.get('compare') and not (e['grouped']):
            try:
                cv = con.execute(sql['compare']).fetchone()[0]
                if not close(cv, e['compare']): problems.append(f"compare {cv} vs {e['compare']}")
            except Exception as ex: problems.append(f"compare SQL error {str(ex)[:300]}")
        if problems: fails.append(f"{tag}: " + '; '.join(problems))
        else: passes += 1

print(f"{passes} passed, {len(fails)} failed")
for f in fails: print('FAIL', f)
for n in notes: print('note', n)
sys.exit(1 if fails else 0)
