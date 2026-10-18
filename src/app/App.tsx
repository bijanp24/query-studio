import React from 'react';
import type { Workspace } from '../core/types';
import type { ItemState } from '../core/load';
import { lolWorkspace } from '../seeds/lol';
import { fieldTrialsWorkspace } from '../seeds/fieldtrials';
import { AppCtx, type App as AppT, type Tab } from './ctx';
import { build, loadItems, refreshManual } from './data';
import { prefs, saveFile, textStore, type TextStore } from './platform';
import { Dashboards } from './Dashboards';
import { Queries } from './Queries';
import { Vizs } from './Vizs';
import { Sources } from './Sources';
import { Datasets } from './Datasets';
import { Model } from './Model';
import { Check, Sel, Txt, uid } from './ui';

// The workspace a first visit opens: League on claude.ai, the field-trials example on static hosting,
// where the League snapshot is not published.
declare const __DEFAULT_WS__: string;
const SEEDS: Record<string, () => Workspace> = { lol: lolWorkspace, fieldtrials: fieldTrialsWorkspace };
interface RegEntry { id: string; name: string }
const TABS: [Tab, string][] = [['dashboards', 'Dashboards'], ['queries', 'Queries'], ['visualizations', 'Visualizations'], ['sources', 'Data sources'], ['datasets', 'Datasets'], ['model', 'Semantic model']];

const itemDef = (ws: Workspace, id: string) => { const it = ws.items.find(i => i.id === id); if (!it) return ''; const { rows: _r, ...rest } = it; void _r; return JSON.stringify([rest, ws.sources.find(s => s.id === it.sourceId)]); };

export function App() {
  const [store, setStore] = React.useState<TextStore | null>(null);
  const [registry, setRegistry] = React.useState<RegEntry[]>([]);
  const [ws, setWs] = React.useState<Workspace>(() => (SEEDS[prefs.get('ws', __DEFAULT_WS__)] || lolWorkspace)());
  const [saved, setSaved] = React.useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [tab, setTab] = React.useState<Tab>((prefs.get('tab', 'dashboards') as Tab) || 'dashboards');
  const [focus, setFocus] = React.useState<string | undefined>();
  const [live, setLiveRaw] = React.useState(prefs.get('live') === '1');
  const [showHidden, setShowHidden] = React.useState(false);
  const [items, setItems] = React.useState<Record<string, ItemState>>({});
  const [loading, setLoading] = React.useState(true);
  const [toastMsg, setToast] = React.useState<string | null>(null);
  const [newer, setNewer] = React.useState(false);
  const [menu, setMenu] = React.useState<'new' | 'import' | 'delete' | null>(null);
  const [newName, setNewName] = React.useState('');
  const [reloadTick, setReloadTick] = React.useState(0);
  const [gen, setGen] = React.useState(0);
  const toast = React.useCallback((m: string) => { setToast(m); window.setTimeout(() => setToast(t => t === m ? null : t), 3200); }, []);

  // ---------- persistence ----------
  React.useEffect(() => { textStore().then(async s => {
    setStore(s);
    const reg = await s.get('registry').then(t => t ? JSON.parse(t) as RegEntry[] : []).catch(() => []);
    setRegistry(reg);
    const id = prefs.get('ws', __DEFAULT_WS__);
    await openWs(id, s);
  }); }, []);
  async function openWs(id: string, s = store) {
    let w: Workspace | null = null;
    const txt = s ? await s.get('ws_' + id).catch(() => null) : null;
    if (txt) { try { w = JSON.parse(txt); } catch { w = null; } }
    const seed = SEEDS[id]?.();
    if (!w) w = seed || lolWorkspace();
    setNewer(!!seed && (w.seedVersion || 0) < (seed.seedVersion || 0));
    prefs.set('ws', w.id); setItems({}); defsRef.current = {}; setWs(w); setGen(g => g + 1); setSaved('idle');
  }
  const saveTimer = React.useRef<number | undefined>();
  const latest = React.useRef(ws); latest.current = ws;
  const update = React.useCallback((fn: (w: Workspace) => Workspace) => {
    setWs(w => ({ ...fn(w), updatedAt: new Date().toISOString() }));
    setSaved('saving');
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(async () => {
      const s = await textStore(); const w = latest.current;
      try {
        await s.put('ws_' + w.id, JSON.stringify(w));
        if (!SEEDS[w.id]) setRegistry(r => { const n = r.some(x => x.id === w.id) ? r.map(x => x.id === w.id ? { id: w.id, name: w.name } : x) : [...r, { id: w.id, name: w.name }]; s.put('registry', JSON.stringify(n)).catch(() => undefined); return n; });
        setSaved('saved');
      } catch { setSaved('error'); }
    }, 1200);
  }, []);

  // ---------- data ----------
  const defsRef = React.useRef<Record<string, string>>({});
  const defsKey = ws.items.map(i => itemDef(ws, i.id)).join('|');
  React.useEffect(() => {
    const changed = new Set(ws.items.filter(i => defsRef.current[i.id] !== itemDef(ws, i.id) + live + reloadTick).map(i => i.id));
    if (!changed.size) return;
    let alive = true; setLoading(true);
    loadItems(ws, { live }, changed, items).then(st => {
      if (!alive) return;
      for (const id of changed) defsRef.current[id] = itemDef(ws, id) + live + reloadTick;
      setItems(st); setLoading(false);
      const failedLive = ws.sources.some(s => s.kind === 'project') && live && ws.items.some(i => ws.sources.find(s => s.id === i.sourceId)?.kind === 'project' && st[i.id]?.error);
      if (failedLive) toast('Live project files could not be read here; showing the published snapshot.');
    });
    return () => { alive = false; };
  }, [ws.id, defsKey, live, reloadTick, gen]);
  const manualKey = JSON.stringify(ws.items.filter(i => i.rows).map(i => [i.id, i.rows]));
  const firstManual = React.useRef(true);
  React.useEffect(() => { if (firstManual.current) { firstManual.current = false; return; } refreshManual(ws, items).then(setItems); }, [manualKey]);
  const datasetsKey = JSON.stringify(ws.datasets);
  const built = React.useMemo(() => build(ws, items), [items, datasetsKey]);
  const tables = React.useMemo(() => Object.fromEntries(Object.entries(built).map(([k, b]) => [k, b.table])), [built]);
  const cat = { ws, tables };

  const setLive = (v: boolean) => { prefs.set('live', v ? '1' : '0'); setLiveRaw(v); };
  const go = (t: Tab, f?: string) => { setTab(t); prefs.set('tab', t); setFocus(f); window.scrollTo?.(0, 0); };
  const app: AppT = { ws, update, cat, built, items, loading, showHidden, live, setLive, reload: () => { defsRef.current = {}; setReloadTick(t => t + 1); }, go, focus, toast };

  const projectSrc = ws.sources.find(s => s.kind === 'project');
  const liveItems = ws.items.filter(i => i.sourceId === projectSrc?.id);
  const liveOk = liveItems.length > 0 && liveItems.every(i => items[i.id]?.table);
  const dataLine = loading && !Object.keys(items).length ? 'Loading data…' : projectSrc ? (liveOk ? 'Live project files' : live ? 'Published snapshot (live files not readable here)' : 'Published snapshot') : `${ws.items.length} source tables`;

  const exportWs = async () => { const r = await saveFile(`${ws.id}-workspace.json`, JSON.stringify(ws, null, 2)); toast(r === 'saved' ? 'Workspace exported' : r === 'unavailable' ? 'Downloads are not available in this view' : 'Export cancelled'); };
  const importWs = async (f: File) => {
    try {
      const w = JSON.parse(await f.text()) as Workspace;
      if (!w || !Array.isArray(w.datasets) || !Array.isArray(w.queries) || !Array.isArray(w.sources)) throw new Error('not a workspace file');
      const id = SEEDS[w.id] || registry.some(r => r.id === w.id) ? uid('ws') : w.id;
      const nw = { ...w, id, name: w.name + (id !== w.id ? ' (imported)' : '') };
      setItems({}); defsRef.current = {}; setGen(g => g + 1); setWs(nw); prefs.set('ws', id); update(x => x); setMenu(null); toast('Workspace imported');
    } catch (e) { toast('Could not import: ' + (e as Error).message); }
  };
  const newWs = () => {
    const w: Workspace = { id: uid('ws'), name: newName || 'New workspace', description: '', sources: [], items: [], datasets: [], fields: [], queries: [], visualizations: [], dashboards: [{ id: uid('d'), name: 'Overview', filters: [], tiles: [] }], seedVersion: 0 };
    w.activeDashboard = w.dashboards[0].id;
    setItems({}); defsRef.current = {}; setGen(g => g + 1); setWs(w); prefs.set('ws', w.id); update(x => x); setMenu(null); setNewName(''); go('sources');
  };
  const resetSeed = () => { const s = SEEDS[ws.id]; if (!s) return; setItems({}); defsRef.current = {}; setGen(g => g + 1); const w = s(); setWs(w); update(x => x); setNewer(false); toast('Reset to the example'); };
  const deleteWs = async () => { const s = await textStore(); await s.del('ws_' + ws.id).catch(() => undefined); const r = registry.filter(x => x.id !== ws.id); setRegistry(r); s.put('registry', JSON.stringify(r)).catch(() => undefined); setMenu(null); openWs('lol', s); };

  const wsOptions: [string, string][] = [['lol', 'League of Legends'], ['fieldtrials', 'Field trials (example)'], ...registry.filter(r => !SEEDS[r.id]).map(r => [r.id, r.name] as [string, string])];
  if (!wsOptions.some(o => o[0] === ws.id)) wsOptions.push([ws.id, ws.name]);

  return <AppCtx.Provider value={app}>
    <header className="top">
      <div className="brand"><span className="logo" aria-hidden><svg viewBox="0 0 24 24"><rect width="24" height="24" rx="6" fill="currentColor" /><rect x="5.5" y="12" width="3" height="6.5" rx="1" fill="#101319" /><rect x="10.5" y="8.5" width="3" height="10" rx="1" fill="#101319" /><rect x="15.5" y="5.5" width="3" height="13" rx="1" fill="#101319" /></svg></span><span>Query Studio</span></div>
      <Sel className="wssel" value={ws.id} onChange={v => v === '__new' ? setMenu('new') : v === '__import' ? setMenu('import') : openWs(v)} options={[...wsOptions, ['__new', '+ New workspace…'], ['__import', 'Import a workspace file…']]} />
      <span className="status small" title={ws.description}>{dataLine}{projectSrc && <button className="link" onClick={() => setLive(!live)}>{live ? 'use snapshot' : 'read live files'}</button>}</span>
      <span className="grow" />
      <Check checked={showHidden} onChange={setShowHidden}>show hidden fields</Check>
      <span className={'saved small ' + saved}>{saved === 'saving' ? 'Saving…' : saved === 'saved' ? (store?.kind === 'account' ? 'Saved to your account' : store?.kind === 'browser' ? 'Saved in this browser' : 'Not saved') : saved === 'error' ? 'Could not save' : ''}</span>
      <button className="ghost" onClick={exportWs}>Export</button>
      {SEEDS[ws.id] ? <button className="ghost" onClick={resetSeed} title="Discard your changes to this example">Reset</button> : <button className="ghost" onClick={() => setMenu(menu === 'delete' ? null : 'delete')}>Delete</button>}
    </header>
    {menu === 'new' && <div className="banner"><span>Name</span><Txt value={newName} onChange={setNewName} placeholder="Rainfall by region" /><button onClick={newWs}>Create workspace</button><button className="ghost" onClick={() => setMenu(null)}>Cancel</button></div>}
    {menu === 'import' && <div className="banner"><span>Workspace file (.json, from Export)</span><input type="file" accept=".json,application/json" onChange={e => { const f = e.target.files?.[0]; if (f) importWs(f); }} /><button className="ghost" onClick={() => setMenu(null)}>Cancel</button></div>}
    {menu === 'delete' && <div className="banner"><span>Delete “{ws.name}” and its saved queries, visualizations and dashboards?</span><button className="danger" onClick={deleteWs}>Delete workspace</button><button className="ghost" onClick={() => setMenu(null)}>Keep</button></div>}
    {newer && <div className="banner"><span>A newer version of this example exists.</span><button onClick={resetSeed}>Reset to it</button><button className="ghost" onClick={() => setNewer(false)}>Keep mine</button></div>}
    {ws.example && <div className="banner info small">Example data: synthetic crop trials built to show the same system working outside League. Nothing here is a real farm.</div>}
    <nav className="tabs main" role="tablist">{TABS.map(([t, n]) => <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => go(t)}>{n}</button>)}</nav>
    <main>
      {tab === 'dashboards' && <Dashboards />}
      {tab === 'queries' && <Queries />}
      {tab === 'visualizations' && <Vizs />}
      {tab === 'sources' && <Sources />}
      {tab === 'datasets' && <Datasets />}
      {tab === 'model' && <Model />}
    </main>
    {toastMsg && <div className="toast" role="status">{toastMsg}</div>}
  </AppCtx.Provider>;
}
