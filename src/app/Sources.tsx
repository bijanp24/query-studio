import React from 'react';
import type { Column, Dataset, Row as DataRow, Source, SourceItem, Table } from '../core/types';
import { useApp } from './ctx';
import { Badge, Check, Row, Sel, Txt, uid } from './ui';
import { excelSheets, formatFromName, jsonArrayPaths, parseBytes, toTable } from '../core/parse';
import { textStore } from './platform';

const KIND: Record<string, string> = { upload: 'uploaded file', project: 'project files', bundled: 'published with the app', url: 'web address', manual: 'typed in the app', postgres: 'PostgreSQL', redshift: 'Amazon Redshift', snowflake: 'Snowflake', bigquery: 'BigQuery', duckdb: 'DuckDB / MotherDuck' };
const CONNECTORS = [
  { kind: 'redshift', name: 'Amazon Redshift' }, { kind: 'postgres', name: 'PostgreSQL' }, { kind: 'snowflake', name: 'Snowflake' },
  { kind: 'bigquery', name: 'BigQuery' }, { kind: 'duckdb', name: 'DuckDB / MotherDuck' }, { kind: 'url', name: 'REST API (Riot, weather services)' },
];
const MAX_UPLOAD = 8_000_000;

function toCSV(t: Table) {
  const esc = (v: unknown) => v == null ? '' : /[",\n\r]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v);
  return [t.columns.map(c => esc(c.name)).join(','), ...t.rows.map(r => t.columns.map(c => esc(r[c.name])).join(','))].join('\n');
}

export function TablePreview({ t, max = 12 }: { t: Table; max?: number }) {
  return <div className="tscroll"><table className="data small">
    <thead><tr>{t.columns.map(c => <th key={c.name}>{c.name}<span className="ctype">{c.type}</span></th>)}</tr></thead>
    <tbody>{t.rows.slice(0, max).map((r, i) => <tr key={i}>{t.columns.map(c => <td key={c.name} className={c.type === 'number' ? 'num' : ''}>{r[c.name] == null ? '' : String(r[c.name])}</td>)}</tr>)}</tbody>
  </table>{t.rows.length > max && <div className="small muted">{max} of {t.rows.length.toLocaleString()} rows</div>}</div>;
}

export function Sources() {
  const app = useApp();
  const { ws, items, update } = app;
  const [open, setOpen] = React.useState<string | null>(null);
  const [adding, setAdding] = React.useState<'upload' | 'manual' | null>(null);
  const usedBy = (itemId: string) => ws.datasets.filter(d => d.feeds.some(f => f.itemId === itemId) || (d.lookups || []).some(l => l.from === itemId));
  const [confirm, setConfirm] = React.useState<string | null>(null);
  const delItem = async (it: SourceItem) => {
    update(w => ({ ...w, items: w.items.filter(i => i.id !== it.id), datasets: w.datasets.map(d => ({ ...d, feeds: d.feeds.filter(f => f.itemId !== it.id), lookups: (d.lookups || []).filter(l => l.from !== it.id) })), sources: w.sources.filter(s => s.id !== it.sourceId || w.items.some(i => i.sourceId === s.id && i.id !== it.id) || s.kind !== 'upload') }));
    if (it.localKey) (await textStore()).del(it.localKey).catch(() => undefined);
    setConfirm(null);
  };
  const hasProject = ws.sources.some(s => s.kind === 'project');
  return <div className="page">
    <div className="pagehead"><h2>Data sources</h2><p className="muted">A source is where data comes from; each of its tables (data source items) can feed one or more datasets in the processed layer, in priority order.</p>
      <div className="inline"><button onClick={() => setAdding(adding === 'upload' ? null : 'upload')}>+ Upload CSV, JSON or Excel</button><button className="ghost" onClick={() => setAdding(adding === 'manual' ? null : 'manual')}>+ Table typed in the app</button>
        {hasProject && <button className="ghost" onClick={() => app.setLive(!app.live)}>{app.live ? 'Use the published snapshot only' : 'Read live project files'}</button>}
        <button className="ghost" onClick={app.reload}>Reload all</button></div>
    </div>
    {adding === 'upload' && <Upload onDone={() => setAdding(null)} />}
    {adding === 'manual' && <ManualNew onDone={() => setAdding(null)} />}
    <div className="sources">
      {ws.sources.map(s => <div key={s.id} className="source">
        <div className="sh"><b>{s.name}</b><Badge tone={s.kind === 'project' ? (app.live ? 'ok' : 'warn') : 'info'}>{KIND[s.kind] || s.kind}</Badge>{s.example && <Badge tone="warn">example data</Badge>}{s.base && <code className="small">{s.base}</code>}</div>
        {s.description && <div className="small muted">{s.description}</div>}
        <table className="data items"><thead><tr><th>table</th><th>format</th><th className="num">rows</th><th className="num">columns</th><th>status</th><th>feeds</th><th /></tr></thead>
          <tbody>{ws.items.filter(i => i.sourceId === s.id).map(it => {
            const st = items[it.id]; const used = usedBy(it.id);
            return <React.Fragment key={it.id}><tr className={open === it.id ? 'sel' : ''}>
              <td><button className="link" onClick={() => setOpen(open === it.id ? null : it.id)}>{it.name}</button></td>
              <td>{it.format}{it.sheet ? ` · ${it.sheet}` : ''}{it.jsonPath ? ` · ${it.jsonPath}` : ''}{it.explode ? `[].${it.explode}` : ''}</td>
              <td className="num">{st?.table ? st.table.rows.length.toLocaleString() : ''}</td>
              <td className="num">{st?.table ? st.table.columns.length : ''}</td>
              <td>{app.loading && !st ? <span className="muted">loading…</span> : st?.error ? <span className={s.kind === 'project' && !app.live ? 'muted' : 'bad'}>{st.error}</span> : st?.table ? <span className="ok">loaded{st.bytes ? ` · ${(st.bytes / 1e6).toFixed(st.bytes > 1e6 ? 1 : 2)} MB` : ''}</span> : ''}</td>
              <td className="small">{used.map(d => d.name).join(', ') || <span className="muted">not used</span>}</td>
              <td>{(s.kind === 'upload' || s.kind === 'manual') && (confirm === it.id ? <><button className="danger" onClick={() => delItem(it)}>Delete</button><button className="ghost" onClick={() => setConfirm(null)}>Keep</button></> : <button className="ghost icon" title="Delete this table" onClick={() => setConfirm(it.id)}>×</button>)}</td>
            </tr>
              {open === it.id && <tr className="detail"><td colSpan={7}>
                {s.kind === 'manual' ? <ManualEdit item={it} /> : st?.table ? <TablePreview t={st.table} /> : <div className="muted">Nothing loaded.</div>}
              </td></tr>}
            </React.Fragment>;
          })}</tbody></table>
      </div>)}
    </div>
    <h3>Connectors that need the query server</h3>
    <p className="muted small">Warehouses and APIs run server-side: credentials never reach the browser, and a query runs where the data lives. The SQL tab of every query already shows the statement for each dialect, and the processed layer’s build compiles to SQL too (Datasets → Build SQL). These cards are placeholders until the server is deployed.</p>
    <div className="connectors">{CONNECTORS.map(c => <div key={c.kind} className="conn"><b>{c.name}</b><span className="small muted">{c.kind === 'url' ? 'Fetch on a schedule or on demand into the processed layer; freshest data costs one round trip.' : 'Tables and saved SQL become data source items; queries compile to this dialect.'}</span><Badge>needs server</Badge></div>)}</div>
  </div>;
}

function Upload({ onDone }: { onDone: () => void }) {
  const app = useApp();
  const { ws, update } = app;
  const [file, setFile] = React.useState<{ name: string; bytes: ArrayBuffer } | null>(null);
  const [fmt, setFmt] = React.useState<'csv' | 'json' | 'excel'>('csv');
  const [sheets, setSheets] = React.useState<string[]>([]);
  const [sheet, setSheet] = React.useState('');
  const [paths, setPaths] = React.useState<{ path: string; length: number; nested: string[] }[]>([]);
  const [jsonPath, setJsonPath] = React.useState('');
  const [explode, setExplode] = React.useState('');
  const [table, setTable] = React.useState<Table | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  const [name, setName] = React.useState('');
  const [makeDs, setMakeDs] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const read = async (f: File) => {
    setErr(null); setTable(null);
    if (f.size > MAX_UPLOAD * 3) { setErr('That file is too large for the browser version. Larger files belong in a warehouse source.'); return; }
    const bytes = await f.arrayBuffer(); const k = formatFromName(f.name);
    setFile({ name: f.name, bytes }); setFmt(k); setName(f.name.replace(/\.[^.]+$/, ''));
    try {
      if (k === 'excel') { const wb = await excelSheets(bytes); setSheets(wb.names); setSheet(wb.names[0]); }
      if (k === 'json') { const data = JSON.parse(new TextDecoder().decode(bytes)); const p = jsonArrayPaths(data); setPaths(p); setJsonPath(p[0]?.path || ''); setExplode(''); }
    } catch (e) { setErr((e as Error).message); }
  };
  React.useEffect(() => {
    if (!file) return;
    parseBytes(file.bytes, fmt, { sheet, jsonPath, explode }).then(t => { setTable(t); setErr(t.rows.length ? null : 'No rows found.'); }, e => setErr((e as Error).message));
  }, [file, fmt, sheet, jsonPath, explode]);
  const add = async () => {
    if (!file || !table) return;
    setBusy(true);
    try {
      // Stored as the original text (CSV, JSON) or, for a workbook, the chosen sheet as CSV.
      const text = fmt === 'excel' ? toCSV(table) : new TextDecoder().decode(file.bytes);
      if (text.length > MAX_UPLOAD) throw new Error(`This file is ${(text.length / 1e6).toFixed(1)} MB; the browser version keeps files up to ${MAX_UPLOAD / 1e6} MB.`);
      const store = await textStore();
      const itemId = uid('up');
      await store.put('up_' + itemId, text);
      let src = ws.sources.find(s => s.kind === 'upload');
      const newSrc: Source | null = src ? null : { id: uid('src'), name: 'My uploads', kind: 'upload', description: store.kind === 'account' ? 'Files you uploaded, saved to your account for this app.' : 'Files you uploaded, saved in this browser only.' };
      src = src || newSrc!;
      const item: SourceItem = { id: itemId, sourceId: src.id, name: name || file.name, format: fmt === 'excel' ? 'csv' : fmt, localKey: 'up_' + itemId, ...(fmt === 'json' ? { jsonPath, explode: explode || undefined } : {}), ...(fmt === 'excel' ? { sheet: undefined } : {}) };
      const ds: Dataset | null = makeDs ? { id: uid('ds'), name: name || file.name, grain: 'row', feeds: [{ itemId, priority: 1 }], sequence: table.columns.find(c => c.type === 'time')?.name, description: `From ${file.name}${fmt === 'excel' ? `, sheet ${sheet}` : ''}.` } : null;
      update(w => ({ ...w, sources: newSrc ? [...w.sources, newSrc] : w.sources, items: [...w.items, item], datasets: ds ? [...w.datasets, ds] : w.datasets }));
      app.toast(store.kind === 'account' ? 'Uploaded and saved to your account' : store.kind === 'browser' ? 'Uploaded; saved in this browser only' : 'Uploaded for this session only');
      onDone();
      if (ds) app.go('datasets', ds.id);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return <div className="panel">
    <Row label="File"><input type="file" accept=".csv,.tsv,.txt,.json,.jsonl,.ndjson,.xlsx,.xls,.xlsm" onChange={e => { const f = e.target.files?.[0]; if (f) read(f); }} /></Row>
    {file && <>
      <Row label="Read as"><Sel value={fmt} onChange={setFmt} options={[['csv', 'CSV / delimited text'], ['json', 'JSON'], ['excel', 'Excel workbook']]} /></Row>
      {fmt === 'excel' && sheets.length > 0 && <Row label="Sheet"><Sel value={sheet} onChange={setSheet} options={sheets.map(s => [s, s] as [string, string])} /></Row>}
      {fmt === 'json' && <Row label="Records" hint="Which array holds one record per row; nested arrays can be exploded into one row each, with the parent's fields copied down.">
        <div className="inline"><Sel value={jsonPath} onChange={v => { setJsonPath(v); setExplode(''); }} options={paths.map(p => [p.path, `${p.path || '(root)'} · ${p.length} records`] as [string, string])} blank={paths.length ? undefined : '(root)'} />
          {(paths.find(p => p.path === jsonPath)?.nested.length || 0) > 0 && <Sel value={explode} blank="no explode" onChange={setExplode} options={paths.find(p => p.path === jsonPath)!.nested.map(n => [n, `explode ${n}[]`] as [string, string])} />}</div>
      </Row>}
      <Row label="Name"><Txt value={name} onChange={setName} /></Row>
      <Row label=""><Check checked={makeDs} onChange={setMakeDs}>also create a dataset from it (you can merge more tables into it later)</Check></Row>
      {err && <div className="warn">{err}</div>}
      {table && <TablePreview t={table} max={8} />}
      <div className="inline"><button disabled={!table || busy} onClick={add}>{busy ? 'Saving…' : 'Add table'}</button><button className="ghost" onClick={onDone}>Cancel</button></div>
    </>}
  </div>;
}

function ManualNew({ onDone }: { onDone: () => void }) {
  const { ws, update, toast } = useApp();
  const [name, setName] = React.useState('');
  const [cols, setCols] = React.useState('');
  const add = () => {
    const schema: Column[] = cols.split(',').map(s => s.trim()).filter(Boolean).map(s => { const [n, t] = s.split(':').map(x => x.trim()); return { name: n.replace(/\W+/g, '_'), type: t === 'number' ? 'number' : 'string' }; });
    if (!name || !schema.length) return;
    let src = ws.sources.find(s => s.kind === 'manual');
    const newSrc: Source | null = src ? null : { id: uid('src'), name: 'Typed in the app', kind: 'manual' };
    src = src || newSrc!;
    const item: SourceItem = { id: uid('man'), sourceId: src.id, name, format: 'csv', rows: [], schema, keyColumns: [schema[0].name] };
    update(w => ({ ...w, sources: newSrc ? [...w.sources, newSrc] : w.sources, items: [...w.items, item] }));
    toast('Table added; open it below to type rows'); onDone();
  };
  return <div className="panel">
    <Row label="Name"><Txt value={name} onChange={setName} placeholder="Targets by zone" /></Row>
    <Row label="Columns" hint="Comma separated; add :number for numbers. The first column is the key."><Txt mono value={cols} onChange={setCols} placeholder="zone, area_km2:number, rainfall_mm:number" /></Row>
    <div className="inline"><button onClick={add}>Add table</button><button className="ghost" onClick={onDone}>Cancel</button></div>
  </div>;
}

/** Rows of a typed-in table, edited as a grid. */
function ManualEdit({ item }: { item: SourceItem }) {
  const { update, items } = useApp();
  const t = items[item.id]?.table;
  const cols: Column[] = t?.columns || item.schema || [];
  const rows = item.rows || [];
  const setRows = (r: DataRow[]) => update(w => ({ ...w, items: w.items.map(i => i.id === item.id ? { ...i, rows: r } : i) }));
  const setCell = (i: number, c: Column, v: string) => setRows(rows.map((r, j) => j === i ? { ...r, [c.name]: v === '' ? null : c.type === 'number' ? Number(v) : v } : r));
  return <div>
    <div className="small muted">{rows.length} rows. Key: {(item.keyColumns || []).join(', ') || 'none'}. Changes rebuild every dataset that uses this table.</div>
    <div className="tscroll"><table className="data small"><thead><tr>{cols.map(c => <th key={c.name}>{c.name}<span className="ctype">{c.type}</span></th>)}<th /></tr></thead>
      <tbody>{rows.slice(0, 500).map((r, i) => <tr key={i + ":" + JSON.stringify(r)}>{cols.map(c => <td key={c.name}><input className="cell" defaultValue={r[c.name] == null ? '' : String(r[c.name])} onBlur={e => e.target.value !== (r[c.name] == null ? '' : String(r[c.name])) && setCell(i, c, e.target.value)} /></td>)}<td><button className="ghost icon" onClick={() => setRows(rows.filter((_, j) => j !== i))}>×</button></td></tr>)}</tbody></table></div>
    <button className="ghost" onClick={() => setRows([...rows, Object.fromEntries(cols.map(c => [c.name, null]))])}>+ row</button>
  </div>;
}

export { toTable };
