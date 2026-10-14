import React from 'react';
import type { Dataset, DerivedColumn, Feed, Lookup, Table } from '../core/types';
import { useApp } from './ctx';
import { Badge, Check, Collapsible, FiltersEditor, Num, Row, Sel, Txt, uid } from './ui';
import { compileDataset, DIALECTS, type Dialect } from '../core/sql';
import { inferFields } from '../core/semantic';
import { TablePreview } from './Sources';
import { ExprHint } from './Queries';

export function Datasets() {
  const app = useApp();
  const { ws, update, built } = app;
  const [sel, setSel] = React.useState<string | undefined>(ws.datasets.some(d => d.id === app.focus) ? app.focus : ws.datasets[0]?.id);
  React.useEffect(() => { if (app.focus && ws.datasets.some(d => d.id === app.focus)) setSel(app.focus); }, [app.focus]);
  const ds = ws.datasets.find(d => d.id === sel);
  const setDs = (p: Partial<Dataset>) => update(w => ({ ...w, datasets: w.datasets.map(d => d.id === sel ? { ...d, ...p } : d) }));
  const add = () => { const it = ws.items[0]; const d: Dataset = { id: uid('ds'), name: 'New dataset', grain: 'row', feeds: it ? [{ itemId: it.id, priority: 1 }] : [] }; update(w => ({ ...w, datasets: [...w.datasets, d] })); setSel(d.id); };
  const [confirm, setConfirm] = React.useState(false);
  const usedBy = ds ? ws.queries.filter(q => q.dataset === ds.id || (q.compare.kind === 'reference' && q.compare.dataset === ds.id)) : [];
  return <div className="page split">
    <aside className="list">
      <div className="listhead"><b>Processed layer</b><span className="muted small">datasets built from sources</span></div>
      <div className="items">{ws.datasets.map(d => { const b = built[d.id]; return <div key={d.id} className={'item' + (d.id === sel ? ' active' : '')} onClick={() => setSel(d.id)}>
        <span className="name">{d.name}</span>
        <span className="meta">{b ? `${b.table.rows.length.toLocaleString()} ${d.grain || 'row'}s` : 'not built'} · {d.feeds.length} feed{d.feeds.length === 1 ? '' : 's'}{b?.errors.length ? ' · ⚠' : ''}</span>
      </div>; })}</div>
      <button onClick={add}>+ New dataset</button>
    </aside>
    <section className="editor">{!ds ? <div className="empty">No dataset selected.</div> : <div className="qe">
      <div className="qhead"><Txt className="qname" value={ds.name} onChange={v => setDs({ name: v })} />
        <div className="actions">{confirm ? <><button className="danger" onClick={() => { update(w => ({ ...w, datasets: w.datasets.filter(d => d.id !== ds.id) })); setConfirm(false); setSel(ws.datasets.find(d => d.id !== ds.id)?.id); }}>Delete{usedBy.length ? ` (${usedBy.length} queries use it)` : ''}</button><button className="ghost" onClick={() => setConfirm(false)}>Keep</button></> : <button className="ghost" onClick={() => setConfirm(true)}>Delete</button>}</div></div>
      <DatasetEditor ds={ds} setDs={setDs} />
    </div>}</section>
  </div>;
}

function cols(t?: Table) { return (t?.columns || []).map(c => [c.name, c.name] as [string, string]); }

function DatasetEditor({ ds, setDs }: { ds: Dataset; setDs: (p: Partial<Dataset>) => void }) {
  const app = useApp();
  const { ws, built, items, showHidden } = app;
  const b = built[ds.id];
  const out = b?.table;
  const [dialect, setDialect] = React.useState<Dialect>('redshift');
  const itemOpts = ws.items.map(i => [i.id, `${ws.sources.find(s => s.id === i.sourceId)?.name} · ${i.name}`] as [string, string]);
  const feeds = [...ds.feeds].sort((a, z) => a.priority - z.priority);
  const setFeed = (f: Feed, p: Partial<Feed>) => setDs({ feeds: ds.feeds.map(x => x === f ? { ...x, ...p } : x) });
  const lookupSources = [...ws.datasets.filter(d => d.id !== ds.id).map(d => [d.id, `dataset · ${d.name}`] as [string, string]), ...itemOpts];
  const tableOf = (id: string) => built[id]?.table || items[id]?.table;
  const setLk = (i: number, p: Partial<Lookup>) => setDs({ lookups: (ds.lookups || []).map((l, j) => j === i ? { ...l, ...p } : l) });
  const setDv = (i: number, p: Partial<DerivedColumn>) => setDs({ derived: (ds.derived || []).map((d, j) => j === i ? { ...d, ...p } : d) });
  let sql = '';
  try { const it: Record<string, Table | undefined> = {}; for (const [k, v] of Object.entries(items)) it[k] = v.table; const bt: Record<string, Table | undefined> = {}; for (const [k, v] of Object.entries(built)) bt[k] = v.table; sql = compileDataset(ws, ds, it, bt, dialect); } catch (e) { sql = '-- ' + (e as Error).message; }
  return <div className="dsform">
    <Row label="Description"><textarea rows={2} value={ds.description || ''} onChange={e => setDs({ description: e.target.value })} /></Row>
    <Row label="Grain" hint="What one row is, in plain words. Labels read “50 games”, “144 plots”."><Txt value={ds.grain} onChange={v => setDs({ grain: v })} className="n12" /></Row>
    <Row label="Sequence" hint="Orders rows in time. “Last N”, series operators and window columns use it; ties break on the key."><Sel value={ds.sequence || ''} blank="none" onChange={v => setDs({ sequence: v || undefined })} options={cols(out)} /></Row>
    <Row label="Key" hint="Rows that share the key are one row in the dataset. Leave empty to stack every row.">
      <div className="chips">{(out?.columns || []).filter(c => c.type !== 'number' || (ds.key || []).includes(c.name) || /id$|_no$/.test(c.name)).slice(0, 40).map(c => { const on = (ds.key || []).includes(c.name); return <button key={c.name} className={'chip' + (on ? ' on' : '')} onClick={() => setDs({ key: on ? ds.key!.filter(k => k !== c.name) : [...(ds.key || []), c.name] })}>{c.name}</button>; })}</div>
      {(ds.key || []).length > 0 && <div className="inline">When feeds share a key: <Sel value={ds.mode || 'replace'} onChange={v => setDs({ mode: v })} options={[['replace', 'the higher-priority row wins'], ['coalesce', 'higher priority wins, empty cells filled from lower']]} /></div>}
    </Row>
    <h4>Feeds <span className="muted small">priority 1 is read first and wins</span></h4>
    <table className="data feeds"><thead><tr><th>priority</th><th>table</th><th>options</th><th className="num">rows in</th><th className="num">kept</th><th className="num">replaced</th><th className="num">cells filled</th><th /></tr></thead>
      <tbody>{feeds.map((f, i) => { const st = b?.feeds.find(x => x.itemId === f.itemId && x.priority === f.priority); const t = items[f.itemId]?.table; return <tr key={i}>
        <td><Num className="n4" value={f.priority} min={1} onChange={v => setFeed(f, { priority: v || 1 })} /></td>
        <td><Sel value={f.itemId} onChange={v => setFeed(f, { itemId: v })} options={itemOpts} />{st?.missing && <div className="small muted">{items[f.itemId]?.error || 'not loaded'}</div>}{st?.skipped && <div className="small muted">skipped: a higher-priority feed loaded</div>}</td>
        <td><Check checked={f.fallback} onChange={v => setFeed(f, { fallback: v || undefined })}>fallback only</Check>
          <Collapsible title={`rename${f.rename && Object.keys(f.rename).length ? ` (${Object.keys(f.rename).length})` : ''}, filter${f.filters?.length ? ` (${f.filters.length})` : ''}`}>
            <Txt mono value={Object.entries(f.rename || {}).map(([a, z]) => `${a}=${z}`).join(', ')} onChange={v => setFeed(f, { rename: Object.fromEntries(v.split(',').map(s => s.split('=').map(x => x.trim())).filter(p => p[0] && p[1])) })} placeholder="source_col=dataset_col, …" />
            <FiltersEditor filters={f.filters || []} onChange={x => setFeed(f, { filters: x })} fields={inferFields('feed', t)} showHidden={showHidden} />
          </Collapsible></td>
        <td className="num">{st && !st.missing ? st.rowsIn.toLocaleString() : ''}</td><td className="num">{st && !st.missing ? st.rowsKept.toLocaleString() : ''}</td><td className="num">{st?.rowsReplaced ? st.rowsReplaced.toLocaleString() : ''}</td><td className="num">{st?.cellsFilled ? st.cellsFilled.toLocaleString() : ''}</td>
        <td><button className="ghost icon" onClick={() => setDs({ feeds: ds.feeds.filter(x => x !== f) })}>×</button></td>
      </tr>; })}</tbody></table>
    <button className="ghost" onClick={() => setDs({ feeds: [...ds.feeds, { itemId: ws.items[0]?.id || '', priority: (feeds[feeds.length - 1]?.priority || 0) + 1 }] })}>+ feed</button>
    <h4>Lookups <span className="muted small">left joins that add columns</span></h4>
    {(ds.lookups || []).map((l, i) => { const lt = tableOf(l.from); return <div key={i} className="lookup">
      <div className="inline">from <Sel value={l.from} onChange={v => setLk(i, { from: v, on: [], columns: [] })} options={lookupSources} /> prefix <Txt className="n8" value={l.prefix} onChange={v => setLk(i, { prefix: v || undefined })} /><button className="ghost icon" onClick={() => setDs({ lookups: ds.lookups!.filter((_, j) => j !== i) })}>×</button></div>
      <div className="inline wrap">match {l.on.map(([a, z], k) => <span key={k} className="inline"><Sel value={a} onChange={v => setLk(i, { on: l.on.map((p, j) => j === k ? [v, p[1]] : p) })} options={cols(out)} /> = <Sel value={z} onChange={v => setLk(i, { on: l.on.map((p, j) => j === k ? [p[0], v] : p) })} options={cols(lt)} /><button className="ghost icon" onClick={() => setLk(i, { on: l.on.filter((_, j) => j !== k) })}>×</button></span>)}<button className="ghost" onClick={() => setLk(i, { on: [...l.on, [out?.columns[0]?.name || '', lt?.columns[0]?.name || '']] })}>+ key</button></div>
      <div className="chips">add {(lt?.columns || []).filter(c => !l.on.some(p => p[1] === c.name)).map(c => { const on = l.columns.includes(c.name); return <button key={c.name} className={'chip' + (on ? ' on' : '')} onClick={() => setLk(i, { columns: on ? l.columns.filter(x => x !== c.name) : [...l.columns, c.name] })}>{c.name}</button>; })}</div>
    </div>; })}
    <button className="ghost" onClick={() => setDs({ lookups: [...(ds.lookups || []), { from: lookupSources[0]?.[0] || '', on: [], columns: [] }] })}>+ lookup</button>
    <h4>Derived columns <span className="muted small">computed per row, in order; window columns run along the sequence</span></h4>
    {(ds.derived || []).map((d, i) => <div key={i} className="derived">
      <div className="inline"><Txt mono className="n12" value={d.name} onChange={v => setDv(i, { name: v.replace(/\W+/g, '_') })} placeholder="name" /> =
        {d.window ? <><Sel value={d.window.fn} onChange={v => setDv(i, { window: { ...d.window!, fn: v } })} options={[['row_number', 'row number'], ['running_sum', 'running sum of'], ['running_avg', 'running average of'], ['lag', 'previous row’s']]} />{d.window.fn !== 'row_number' && <Txt mono value={d.expr} onChange={v => setDv(i, { expr: v })} />}</> : <Txt mono value={d.expr} onChange={v => setDv(i, { expr: v })} placeholder="(kills + assists) / max(deaths, 1)" />}
        <Sel value={d.window ? 'window' : 'row'} onChange={v => setDv(i, { window: v === 'window' ? { fn: 'row_number', partitionBy: [] } : undefined })} options={[['row', 'per row'], ['window', 'window']]} />
        <Check checked={d.early} onChange={v => setDv(i, { early: v || undefined })}>before lookups</Check>
        <button className="ghost icon" disabled={i === 0} onClick={() => { const a = [...ds.derived!]; [a[i - 1], a[i]] = [a[i], a[i - 1]]; setDs({ derived: a }); }}>↑</button>
        <button className="ghost icon" onClick={() => setDs({ derived: ds.derived!.filter((_, j) => j !== i) })}>×</button></div>
      {d.window && <div className="chips">within each {(out?.columns || []).filter(c => c.type === 'string').slice(0, 30).map(c => { const on = (d.window!.partitionBy || []).includes(c.name); return <button key={c.name} className={'chip' + (on ? ' on' : '')} onClick={() => setDv(i, { window: { ...d.window!, partitionBy: on ? d.window!.partitionBy!.filter(x => x !== c.name) : [...(d.window!.partitionBy || []), c.name] } })}>{c.name}</button>; })}</div>}
      {!d.window && <div className="hint"><ExprHint expr={d.expr} table={out} /></div>}
    </div>)}
    <button className="ghost" onClick={() => setDs({ derived: [...(ds.derived || []), { name: 'new_column', expr: '' }] })}>+ derived column</button>
    <h4>Result {b && <span className="muted small">{out!.rows.length.toLocaleString()} rows × {out!.columns.length} columns · built {new Date(b.builtAt).toLocaleTimeString()}</span>}</h4>
    {b?.errors.map((e, i) => <div key={i} className="warn small">{e}</div>)}
    {out && <TablePreview t={out} max={10} />}
    <Collapsible title="Build SQL for a warehouse" extra={<Sel className="mini" value={dialect} onChange={setDialect} options={DIALECTS.map(d => [d.id, d.name] as [Dialect, string])} />}>
      <div className="small muted">The same merge, lookups and derived columns as one CREATE TABLE statement. Checked against the browser build in DuckDB.</div>
      <pre className="sql">{sql}</pre>
    </Collapsible>
    <div className="small muted">Fields on this dataset: <button className="link" onClick={() => app.go('model', ds.id)}>open the semantic model</button> <Badge>{ws.fields.filter(f => f.dataset === ds.id).length} curated</Badge></div>
  </div>;
}
