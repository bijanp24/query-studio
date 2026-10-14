import React from 'react';
import type { Dashboard, Tile, Visualization } from '../core/types';
import { useApp, vizById, queryById } from './ctx';
import { TileBody } from './Tile';
import { FiltersEditor, Num, Sel, Txt, uid } from './ui';
import { fieldsFor } from '../core/semantic';
import { Ask } from './Ask';
import { VIZ_TYPES } from './viz/charts';

const WIDTHS: [string, string][] = [['2', '⅓'], ['3', '½'], ['4', '⅔'], ['6', 'full']];

export function Dashboards() {
  const app = useApp();
  const { ws, update } = app;
  const dash = ws.dashboards.find(d => d.id === ws.activeDashboard) || ws.dashboards[0];
  const [drag, setDrag] = React.useState<{ tile?: string; viz?: string } | null>(null);
  const [over, setOver] = React.useState<string | null>(null);
  const [adding, setAdding] = React.useState(false);
  const [renaming, setRenaming] = React.useState(false);
  const [confirmDel, setConfirmDel] = React.useState(false);

  const setDash = (fn: (d: Dashboard) => Dashboard) => update(w => ({ ...w, dashboards: w.dashboards.map(d => d.id === dash.id ? fn(d) : d) }));
  const newDash = () => { const d: Dashboard = { id: uid('d'), name: 'New dashboard', filters: [], tiles: [] }; update(w => ({ ...w, dashboards: [...w.dashboards, d], activeDashboard: d.id })); setRenaming(true); setAdding(true); };

  if (!dash) return <div className="page"><div className="empty">No dashboards yet. <button onClick={newDash}>Create one</button></div></div>;

  // Fields a dashboard filter can use: those on any dataset its tiles read.
  const dsIds = [...new Set(dash.tiles.map(t => { const v = vizById(ws, t.vizId); return v ? queryById(ws, v.queryId)?.dataset : undefined; }).filter(Boolean) as string[])];
  const fieldMap = new Map<string, ReturnType<typeof fieldsFor>[number]>();
  for (const id of dsIds) for (const f of fieldsFor(ws, id, app.cat.tables[id])) if (f.role === 'dimension' && !fieldMap.has(f.id)) fieldMap.set(f.id, f);
  const dimFields = [...fieldMap.values()];
  const valuesFor = (field: string) => { const s = new Set<string>(); for (const id of dsIds) { const t = app.cat.tables[id]; if (!t || !t.columns.some(c => c.name === field)) continue; for (const r of t.rows) { const v = r[field]; if (v != null) s.add(String(v)); if (s.size > 300) break; } } return [...s].sort(); };

  const moveTile = (fromId: string, beforeId: string | null) => setDash(d => {
    const tiles = [...d.tiles]; const i = tiles.findIndex(t => t.id === fromId); if (i < 0) return d;
    const [t] = tiles.splice(i, 1); const j = beforeId ? tiles.findIndex(x => x.id === beforeId) : tiles.length;
    tiles.splice(j < 0 ? tiles.length : j, 0, t); return { ...d, tiles };
  });
  const addViz = (vizId: string, beforeId: string | null = null) => setDash(d => {
    const tiles = [...d.tiles]; const t: Tile = { id: uid('t'), vizId }; const j = beforeId ? tiles.findIndex(x => x.id === beforeId) : tiles.length;
    tiles.splice(j < 0 ? tiles.length : j, 0, t); return { ...d, tiles };
  });
  const drop = (beforeId: string | null) => { if (drag?.tile) moveTile(drag.tile, beforeId); else if (drag?.viz) addViz(drag.viz, beforeId); setDrag(null); setOver(null); };

  return <div className="page">
    <div className="dashbar">
      {renaming
        ? <Txt className="dname" value={dash.name} onChange={v => setDash(d => ({ ...d, name: v }))} onBlur={() => setRenaming(false)} />
        : <Sel className="dsel" value={dash.id} onChange={v => update(w => ({ ...w, activeDashboard: v }))} options={ws.dashboards.map(d => [d.id, d.name] as [string, string])} />}
      <button className="ghost" onClick={() => setRenaming(!renaming)}>{renaming ? 'Done' : 'Rename'}</button>
      <button className="ghost" onClick={newDash}>+ Dashboard</button>
      <button className={adding ? '' : 'ghost'} onClick={() => setAdding(!adding)}>{adding ? 'Close tiles' : '+ Tile'}</button>
      {confirmDel
        ? <><button className="danger" onClick={() => { update(w => { const ds = w.dashboards.filter(d => d.id !== dash.id); return { ...w, dashboards: ds, activeDashboard: ds[0]?.id }; }); setConfirmDel(false); }}>Delete “{dash.name}”</button><button className="ghost" onClick={() => setConfirmDel(false)}>Keep</button></>
        : <button className="ghost" onClick={() => setConfirmDel(true)}>Delete</button>}
    </div>
    <div className="dfilters">
      <span className="flabel">Dashboard filters</span>
      <FiltersEditor filters={dash.filters} onChange={f => setDash(d => ({ ...d, filters: f }))} fields={dimFields} showHidden={app.showHidden} valuesFor={valuesFor} />
      <label className="inline">last <Num value={dash.last} onChange={v => setDash(d => ({ ...d, last: v }))} min={0} placeholder="each query's own" className="n8" /> rows</label>
    </div>
    <Ask dash={dash} onAdded={vizId => addViz(vizId)} />
    {adding && <div className="drawer">
      <div className="small muted">Drag a visualization onto the grid, or click to add it at the end.</div>
      <div className="vlist">{ws.visualizations.map(v => <button key={v.id} className="vchip" draggable onDragStart={e => { setDrag({ viz: v.id }); e.dataTransfer.effectAllowed = 'copy'; e.dataTransfer.setData('text/plain', v.id); }} onDragEnd={() => setDrag(null)} onClick={() => addViz(v.id)} title={queryById(ws, v.queryId)?.name}><span className="vt">{VIZ_TYPES.find(t => t.id === v.type)?.name}</span>{v.name}</button>)}
        <button className="vchip new" onClick={() => app.go('visualizations', 'new')}>+ New visualization</button></div>
    </div>}
    <div className={'grid' + (drag ? ' dragging' : '')} onDragOver={e => { if (drag) { e.preventDefault(); } }} onDrop={e => { e.preventDefault(); drop(null); }}>
      {!dash.tiles.length && <div className="empty span6">This dashboard is empty. Add tiles with “+ Tile”, or ask for one above.</div>}
      {dash.tiles.map(t => {
        const v = vizById(ws, t.vizId); const q = v && queryById(ws, v.queryId);
        if (!v || !q) return <div key={t.id} className="tile w2"><div className="empty">This tile’s visualization was deleted. <button className="ghost" onClick={() => setDash(d => ({ ...d, tiles: d.tiles.filter(x => x.id !== t.id) }))}>Remove</button></div></div>;
        const w = t.width || v.width || 3;
        return <div key={t.id} className={`tile w${w}` + (over === t.id ? ' over' : '') + (drag?.tile === t.id ? ' lifted' : '')}
          onDragOver={e => { if (drag) { e.preventDefault(); e.stopPropagation(); setOver(t.id); } }}
          onDragLeave={() => setOver(o => o === t.id ? null : o)}
          onDrop={e => { e.preventDefault(); e.stopPropagation(); drop(t.id); }}>
          <div className="th" draggable onDragStart={e => { setDrag({ tile: t.id }); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', t.id); }} onDragEnd={() => { setDrag(null); setOver(null); }}>
            <span className="grip" aria-hidden>⠿</span>
            <h3 title={q.name}>{v.name}</h3>
            <span className="tools">
              <Sel className="mini" value={String(w)} onChange={x => setDash(d => ({ ...d, tiles: d.tiles.map(y => y.id === t.id ? { ...y, width: Number(x) as Tile['width'] } : y) }))} options={WIDTHS} title="Tile width" />
              <TileMove dash={dash} tile={t} setDash={setDash} />
              <button className="ghost icon" title="Edit visualization" onClick={() => app.go('visualizations', v.id)}>✎</button>
              <button className="ghost icon" title="Edit query" onClick={() => app.go('queries', q.id)}>ƒ</button>
              <button className="ghost icon" title="Remove from dashboard" onClick={() => setDash(d => ({ ...d, tiles: d.tiles.filter(x => x.id !== t.id) }))}>×</button>
            </span>
          </div>
          <div className="tb"><TileBody v={v} q={q} dash={dash} /></div>
        </div>;
      })}
      {drag && <div className={'tile w6 dropend' + (over === '__end' ? ' over' : '')} onDragOver={e => { e.preventDefault(); setOver('__end'); }} onDrop={e => { e.preventDefault(); e.stopPropagation(); drop(null); }}>Drop here to place at the end</div>}
    </div>
  </div>;
}

/** Keyboard and touch friendly reordering, next to drag and drop. */
function TileMove({ dash, tile, setDash }: { dash: Dashboard; tile: Tile; setDash: (fn: (d: Dashboard) => Dashboard) => void }) {
  const i = dash.tiles.findIndex(t => t.id === tile.id);
  const mv = (d: number) => setDash(x => { const tiles = [...x.tiles]; const j = i + d; if (j < 0 || j >= tiles.length) return x; [tiles[i], tiles[j]] = [tiles[j], tiles[i]]; return { ...x, tiles }; });
  return <><button className="ghost icon" title="Move earlier" disabled={i === 0} onClick={() => mv(-1)}>←</button><button className="ghost icon" title="Move later" disabled={i === dash.tiles.length - 1} onClick={() => mv(1)}>→</button></>;
}

export type { Visualization };
