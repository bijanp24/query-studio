import React from 'react';
import type { CardColumn, CardRow, SamplingNull, Visualization } from '../core/types';
import { useApp, runCached } from './ctx';
import { Viz, VIZ_TYPES, autoType, color } from './viz/charts';
import { Check, FiltersEditor, Num, Row, Sel, Txt, fieldOptions, uid } from './ui';
import { fieldsFor } from '../core/semantic';
import { TileBody } from './Tile';

export function Vizs() {
  const app = useApp();
  const { ws, update, cat } = app;
  const [sel, setSel] = React.useState<string | undefined>(ws.visualizations.some(v => v.id === app.focus) ? app.focus : ws.visualizations[0]?.id);
  React.useEffect(() => {
    if (app.focus === 'new') addNew();
    else if (app.focus && ws.visualizations.some(v => v.id === app.focus)) setSel(app.focus);
  }, [app.focus]);
  const v = ws.visualizations.find(x => x.id === sel);
  const q = v && ws.queries.find(x => x.id === v.queryId);
  const set = (p: Partial<Visualization>) => update(w => ({ ...w, visualizations: w.visualizations.map(x => x.id === sel ? { ...x, ...p } : x) }));
  function addNew() {
    const q0 = ws.queries[0]; if (!q0) { app.toast('Create a query first'); app.go('queries'); return; }
    const n: Visualization = { id: uid('v'), name: q0.name, queryId: q0.id, type: autoType(runCached(cat, q0)), color: 1, width: 3, window: 10, labels: true };
    update(w => ({ ...w, visualizations: [...w.visualizations, n] })); setSel(n.id);
  }
  const [confirm, setConfirm] = React.useState(false);
  const onDash = (id: string) => ws.dashboards.filter(d => d.tiles.some(t => t.vizId === id));
  const dash = ws.dashboards.find(d => d.id === ws.activeDashboard);
  return <div className="page split">
    <aside className="list">
      <div className="listhead"><b>Visualizations</b><span className="muted small">each draws one query</span></div>
      <div className="items">{ws.visualizations.map(x => <div key={x.id} className={'item' + (x.id === sel ? ' active' : '')} onClick={() => setSel(x.id)}>
        <span className="name"><i className="dot" style={{ background: color(x.color) }} />{x.name}</span>
        <span className="meta">{VIZ_TYPES.find(t => t.id === x.type)?.name} · {ws.queries.find(y => y.id === x.queryId)?.name || 'missing query'}</span>
      </div>)}</div>
      <button onClick={addNew}>+ New visualization</button>
    </aside>
    <section className="editor">
      {!v ? <div className="empty">Pick a visualization or create one.</div> : <div className="qe">
        <div className="qhead"><Txt className="qname" value={v.name} onChange={n => set({ name: n })} />
          <div className="actions">
            {dash && <button className="ghost" onClick={() => { update(w => ({ ...w, dashboards: w.dashboards.map(d => d.id === dash.id ? { ...d, tiles: [...d.tiles, { id: uid('t'), vizId: v.id }] } : d) })); app.toast(`Added to ${dash.name}`); }}>Add to “{dash.name}”</button>}
            <button className="ghost" onClick={() => { const n = { ...JSON.parse(JSON.stringify(v)), id: uid('v'), name: v.name + ' (copy)' }; update(w => ({ ...w, visualizations: [...w.visualizations, n] })); setSel(n.id); }}>Duplicate</button>
            {confirm ? <><button className="danger" onClick={() => { update(w => ({ ...w, visualizations: w.visualizations.filter(x => x.id !== v.id), dashboards: w.dashboards.map(d => ({ ...d, tiles: d.tiles.filter(t => t.vizId !== v.id) })) })); setConfirm(false); setSel(ws.visualizations.find(x => x.id !== v.id)?.id); }}>Delete{onDash(v.id).length ? ` and remove from ${onDash(v.id).length} dashboard${onDash(v.id).length > 1 ? 's' : ''}` : ''}</button><button className="ghost" onClick={() => setConfirm(false)}>Keep</button></> : <button className="ghost" onClick={() => setConfirm(true)}>Delete</button>}
          </div></div>
        <div className="qgrid">
          <div className="qform">
            <Row label="Query" hint={<button className="link" onClick={() => app.go('queries', v.queryId)}>Edit this query</button>}><Sel value={v.queryId} onChange={x => set({ queryId: x })} options={ws.queries.map(y => [y.id, y.name] as [string, string])} /></Row>
            <Row label="Type" hint={VIZ_TYPES.find(t => t.id === v.type)?.needs ? `Needs ${VIZ_TYPES.find(t => t.id === v.type)!.needs}.` : undefined}><div className="types">{VIZ_TYPES.map(t => <button key={t.id} className={'chip' + (v.type === t.id ? ' on' : '')} onClick={() => set({ type: t.id, ...(t.id === 'card' && !v.card ? { card: { rows: [], columns: [{ label: 'this query', kind: 'self' }] } } : {}) })}>{t.name}</button>)}</div></Row>
            <Row label="Color"><div className="swatches">{Array.from({ length: 8 }, (_, i) => <button key={i} className={'sw' + (v.color === i + 1 ? ' on' : '')} style={{ background: color(i + 1) }} aria-label={`color ${i + 1}`} onClick={() => set({ color: i + 1 })} />)}</div></Row>
            <Row label="Width"><Sel value={String(v.width)} onChange={x => set({ width: Number(x) as Visualization['width'] })} options={[['2', 'a third'], ['3', 'half'], ['4', 'two thirds'], ['6', 'full width']]} /></Row>
            {['line', 'area', 'trend', 'sparktable', 'profile', 'ribbon'].includes(v.type) && <Row label="Rolling window" hint="Rows per point when the query has no series operator of its own."><Num className="n8" value={v.window} min={2} onChange={x => set({ window: x || 10 })} /></Row>}
            {v.type === 'scatter' && q && <Row label="Horizontal axis"><Sel value={v.x || ''} blank="pick a field" onChange={x => set({ x })} options={fieldOptions(fieldsFor(ws, q.dataset, cat.tables[q.dataset]), app.showHidden, ['measure'])} /></Row>}
            {(v.type === 'distribution' || v.type === 'sampling') && <DistEditor v={v} set={set} />}
            {v.type === 'sampling' && <SamplingEditor v={v} set={set} />}
            {v.type === 'profile' && <Row label="Trend per" hint="The trend is reported as the change per this many rows."><Num className="n8" value={v.per ?? 100} min={1} onChange={x => set({ per: x || 100 })} /></Row>}
            {v.type === 'column' && <Row label="Options"><Check checked={v.stack} onChange={x => set({ stack: x })}>stack the second group</Check></Row>}
            <Row label="Labels"><Check checked={v.labels !== false} onChange={x => set({ labels: x })}>show value labels</Check></Row>
            <Row label="Note"><textarea value={v.note || ''} onChange={e => set({ note: e.target.value })} placeholder="What the reader should know about this tile" rows={2} /></Row>
            {v.type === 'card' && q && <CardEditor v={v} set={set} dataset={q.dataset} />}
          </div>
          <div className="preview"><div className="pbody">{q ? <TileBody v={v} q={q} dash={dash} /> : <div className="empty">This visualization’s query was deleted.</div>}</div></div>
        </div>
      </div>}
    </section>
  </div>;
}

function DistEditor({ v, set }: { v: Visualization; set: (p: Partial<Visualization>) => void }) {
  const { ws, cat, showHidden } = useApp();
  const d = v.dist;
  const rf = d?.dataset ? fieldsFor(ws, d.dataset, cat.tables[d.dataset]) : [];
  const setD = (p: Partial<NonNullable<Visualization['dist']>>) => { const n = { dataset: '', ...d, ...p }; set({ dist: n.dataset ? n : undefined }); };
  return <>
    <Row label="Compare with" hint="A population counted into the same bins: it needs the query's group-by field."><Sel value={d?.dataset || ''} blank="no reference" onChange={x => setD({ dataset: x })} options={ws.datasets.map(x => [x.id, x.name] as [string, string])} /></Row>
    {d?.dataset && <>
      <Row label="Count each row as" hint="An expression over the reference rows, such as the number of players in a ladder division. Empty: a measure of the same name, else 1."><Txt mono value={d.weight} onChange={x => setD({ weight: x || undefined })} placeholder="1" /></Row>
      <Row label="Reference label"><Txt value={d.label} onChange={x => setD({ label: x || undefined })} placeholder={ws.datasets.find(x => x.id === d.dataset)?.name} /></Row>
      <Row label="Reference filters"><FiltersEditor filters={d.filters || []} onChange={f => setD({ filters: f })} fields={rf} showHidden={showHidden} /></Row>
    </>}
    <Row label="Hidden share (%)" hint="What if this share of the group is shown below its median but belongs above it, such as smurfs among the players you meet. The tile shows how far the median can move. Empty: off."><Num className="n8" value={v.hidden?.share} min={0} max={50} onChange={x => set({ hidden: x == null ? undefined : { ...v.hidden, share: x } })} /></Row>
    {v.hidden && <Row label="Call them"><Txt value={v.hidden.label} onChange={x => set({ hidden: { ...v.hidden!, label: x || undefined } })} placeholder="hidden" /></Row>}
  </>;
}

function SamplingEditor({ v, set }: { v: Visualization; set: (p: Partial<Visualization>) => void }) {
  const s = v.sampling || {};
  const setS = (p: Partial<NonNullable<Visualization['sampling']>>) => set({ sampling: { ...s, ...p } });
  const nulls = s.nulls || [];
  const setN = (i: number, p: Partial<SamplingNull>) => setS({ nulls: nulls.map((n, j) => j === i ? { ...n, ...p } : n) });
  const num = (x: SamplingNull['center']) => typeof x === 'number' ? x : undefined;
  return <>
    <Row label="Null populations" hint="Random members of the reference, or members matched near a center (in bins: 0 = bottom of the first bin), with a spread in bins. Leave center or spread empty to fit it to the sample.">
      {nulls.map((n, i) => <div key={i} className="inline">
        <Txt value={n.label} onChange={x => setN(i, { label: x })} placeholder="label" />
        <Sel value={n.kind} onChange={x => setN(i, { kind: x })} options={[['population', 'random members'], ['matched', 'matched near a center']]} />
        {n.kind === 'matched' && <>{typeof n.center === 'object' ? <span className="hint">center from {n.center.dataset}</span> : <Num className="n8" placeholder="center" value={num(n.center)} onChange={x => setN(i, { center: x == null ? 'fit' : x })} />}
          <Num className="n8" placeholder="spread" value={num(n.spread as SamplingNull['center'])} onChange={x => setN(i, { spread: x == null ? 'fit' : x })} /></>}
        <button className="ghost icon" onClick={() => setS({ nulls: nulls.filter((_, j) => j !== i) })}>×</button>
      </div>)}
      <button className="ghost" onClick={() => setS({ nulls: [...nulls, { label: nulls.length ? 'matched sample' : 'random sample', kind: nulls.length ? 'matched' : 'population', ...(nulls.length ? { center: 'fit', spread: 'fit' } : {}) }] })}>+ null</button>
    </Row>
    <Row label="Simulated samples"><Num className="n8" value={s.sims ?? 1000} min={50} onChange={x => setS({ sims: x || 1000 })} /></Row>
    <Row label="Design effect" hint="When rows come in clusters (players met in the same game), samples are drawn at n ÷ this. 1 = independent rows."><Num className="n8" value={s.designEffect ?? 1} min={1} onChange={x => setS({ designEffect: x || 1 })} /></Row>
  </>;
}

function CardEditor({ v, set, dataset }: { v: Visualization; set: (p: Partial<Visualization>) => void; dataset: string }) {
  const { ws, cat, showHidden } = useApp();
  const card = v.card || { rows: [], columns: [] };
  const fields = fieldsFor(ws, dataset, cat.tables[dataset]);
  const setCard = (p: Partial<typeof card>) => set({ card: { ...card, ...p } });
  const setRow = (i: number, p: Partial<CardRow>) => setCard({ rows: card.rows.map((r, j) => j === i ? { ...r, ...p } : r) });
  const setCol = (i: number, p: Partial<CardColumn>) => setCard({ columns: card.columns.map((c, j) => j === i ? { ...c, ...p } : c) });
  return <>
    <Row label="Card rows" hint="Each row is a measure; each column computes it for a different group.">
      {card.rows.map((r, i) => <div key={i} className="inline">
        <Txt value={r.label} onChange={x => setRow(i, { label: x })} placeholder="label" />
        <Sel value={r.field} onChange={x => setRow(i, { field: x })} options={fieldOptions(fields, showHidden, ['measure'])} />
        <Txt value={r.alias} onChange={x => setRow(i, { alias: x || undefined })} placeholder="alias for {alias}" className="n8" />
        <button className="ghost icon" onClick={() => setCard({ rows: card.rows.filter((_, j) => j !== i) })}>×</button>
      </div>)}
      <button className="ghost" onClick={() => { const f = fields.find(x => x.role === 'measure' && !x.hidden); if (f) setCard({ rows: [...card.rows, { label: f.label, field: f.id }] }); }}>+ row</button>
    </Row>
    <Row label="Card columns">
      {card.columns.map((c, i) => { const rf = c.dataset ? fieldsFor(ws, c.dataset, cat.tables[c.dataset]) : []; return <div key={i} className="cardcol">
        <div className="inline"><Txt value={c.label} onChange={x => setCol(i, { label: x })} placeholder="column label" />
          <Sel value={c.kind} onChange={x => setCol(i, { kind: x, ...(x === 'reference' && !c.dataset ? { dataset: ws.datasets.find(d => d.id !== dataset)?.id } : {}) })} options={[['self', 'this query’s rows'], ['paired', 'paired column, same rows'], ['reference', 'reference dataset']]} />
          <Check checked={c.signed} onChange={x => setCol(i, { signed: x })}>signed</Check>
          <button className="ghost icon" onClick={() => setCard({ columns: card.columns.filter((_, j) => j !== i) })}>×</button></div>
        {c.kind === 'paired' && <div className="inline"><Txt mono value={c.pattern} onChange={x => setCol(i, { pattern: x })} placeholder="opp_{f}" /><span className="hint">{'{f}'} is the row’s field, {'{alias}'} its alias</span></div>}
        {c.kind === 'reference' && <><Sel value={c.dataset || ''} onChange={x => setCol(i, { dataset: x })} options={ws.datasets.map(d => [d.id, d.name] as [string, string])} />
          <FiltersEditor filters={c.filters || []} onChange={f => setCol(i, { filters: f })} fields={rf} showHidden={showHidden} />
          <div className="chips">weighted by this query’s mix of: {rf.filter(f => f.role === 'dimension' && fields.some(x => x.id === f.id)).map(f => { const on = (c.weightBy || []).includes(f.id); return <button key={f.id} className={'chip' + (on ? ' on' : '')} onClick={() => setCol(i, { weightBy: on ? c.weightBy!.filter(x => x !== f.id) : [...(c.weightBy || []), f.id] })}>{f.label}</button>; })}</div></>}
      </div>; })}
      <button className="ghost" onClick={() => setCard({ columns: [...card.columns, { label: 'new column', kind: 'paired', pattern: 'opp_{f}' }] })}>+ column</button>
    </Row>
  </>;
}

export { Viz };
