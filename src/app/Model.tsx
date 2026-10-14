import React from 'react';
import type { Additivity, Agg, Field, Format, Polarity } from '../core/types';
import { useApp } from './ctx';
import { fieldsFor, inferFields, aggLabel } from '../core/semantic';
import { Badge, Check, Sel, Txt, uid } from './ui';
import { ExprHint } from './Queries';

const AGGS: Agg[] = ['avg', 'sum', 'count', 'median', 'min', 'max', 'rate', 'ratio', 'count_values', 'count_distinct'];
const FORMATS: [Format, string][] = [['number', 'auto'], ['integer', '1,234'], ['decimal1', '1.2'], ['decimal2', '1.23'], ['percent', '12.3%']];

export function Model() {
  const app = useApp();
  const { ws, update, cat } = app;
  const [dsId, setDsId] = React.useState(ws.datasets.some(d => d.id === app.focus) ? app.focus! : ws.datasets[0]?.id);
  React.useEffect(() => { if (app.focus && ws.datasets.some(d => d.id === app.focus)) setDsId(app.focus); }, [app.focus]);
  const [q, setQ] = React.useState('');
  const [open, setOpen] = React.useState<string | null>(null);
  const table = cat.tables[dsId];
  const all = fieldsFor(ws, dsId, table);
  const curated = new Set(ws.fields.filter(f => f.dataset === dsId).map(f => f.id));
  const setF = (id: string, p: Partial<Field>) => update(w => ({ ...w, fields: w.fields.map(f => f.dataset === dsId && f.id === id ? { ...f, ...p } : f) }));
  const curate = (f: Field) => { update(w => ({ ...w, fields: [...w.fields, { ...f }] })); setOpen(f.id); };
  const addField = (role: Field['role']) => { const f: Field = { id: uid(role === 'weight' ? 'w' : 'm').replace('_', ''), dataset: dsId, label: role === 'weight' ? 'New weighting' : role === 'measure' ? 'New measure' : 'New dimension', role, expr: role === 'weight' ? '1' : table?.columns[0]?.name || '', type: role === 'dimension' ? 'string' : 'number', ...(role === 'measure' ? { agg: 'avg' as Agg, additivity: 'non_additive' as Additivity, polarity: 'higher' as Polarity } : {}) }; update(w => ({ ...w, fields: [...w.fields, f] })); setOpen(f.id); };
  const shown = all.filter(f => !q || (f.id + ' ' + f.label).toLowerCase().includes(q.toLowerCase()));
  const groups: [Field['role'], string][] = [['measure', 'Measures'], ['weight', 'Weighting schemes'], ['dimension', 'Dimensions']];
  return <div className="page">
    <div className="pagehead"><h2>Semantic model</h2><p className="muted">Dimensions slice, measures aggregate, weights decide how much each row counts. Fields nobody has described yet are inferred from the columns, so a new file is queryable the moment it loads; curate one to give it a label, a default aggregation, a polarity or a default weight.</p>
      <div className="inline"><Sel value={dsId} onChange={setDsId} options={ws.datasets.map(d => [d.id, d.name] as [string, string])} /><Txt value={q} onChange={setQ} placeholder="Search fields" /><button className="ghost" onClick={() => addField('measure')}>+ measure</button><button className="ghost" onClick={() => addField('dimension')}>+ dimension</button><button className="ghost" onClick={() => addField('weight')}>+ weighting scheme</button></div></div>
    {groups.map(([role, title]) => { const fs = shown.filter(f => f.role === role); if (!fs.length) return null; return <div key={role} className="fgroup">
      <h4>{title} <span className="muted small">{fs.length}</span></h4>
      <table className="data fields"><thead><tr><th>field</th><th>expression</th>{role === 'measure' && <><th>aggregation</th><th>additivity</th><th>weight / ÷</th><th>better</th></>}<th /></tr></thead>
        <tbody>{fs.map(f => { const isC = curated.has(f.id); return <React.Fragment key={f.id}><tr className={(f.hidden ? 'dim ' : '') + (open === f.id ? 'sel' : '')}>
          <td><button className="link" onClick={() => setOpen(open === f.id ? null : f.id)}>{f.label}</button> <span className="mono small muted">{f.id}</span> {!isC && <Badge>inferred</Badge>}{f.hidden && <Badge tone="warn">hidden</Badge>}</td>
          <td className="mono small">{f.expr}</td>
          {role === 'measure' && <><td>{f.agg ? aggLabel(f.agg) : ''}</td><td>{f.additivity ? <Badge tone={f.additivity === 'additive' ? 'ok' : undefined}>{f.additivity.replace('_', '-')}</Badge> : ''}</td><td className="mono small">{f.weight || (f.denominator ? '÷ ' + f.denominator : '')}</td><td>{f.polarity === 'lower' ? 'lower' : f.polarity === 'neutral' ? '—' : 'higher'}</td></>}
          <td>{!isC ? <button className="ghost" onClick={() => curate(f)}>Curate</button> : <button className="ghost icon" title="Remove the curated definition (the column stays)" onClick={() => update(w => ({ ...w, fields: w.fields.filter(x => !(x.dataset === dsId && x.id === f.id)) }))}>×</button>}</td>
        </tr>
          {open === f.id && isC && <tr className="detail"><td colSpan={7}><FieldForm f={f} set={p => setF(f.id, p)} /></td></tr>}
          {open === f.id && !isC && <tr className="detail"><td colSpan={7} className="muted small">Inferred from column {f.expr} ({f.type}). Curate it to edit.</td></tr>}
        </React.Fragment>; })}</tbody></table>
    </div>; })}
    {!table && <div className="warn">This dataset is not built, so inferred fields are missing.</div>}
    <p className="small muted">Inferred: {inferFields(dsId, table).filter(f => !curated.has(f.id)).length} · curated: {curated.size}. Hidden fields stay out of pickers and Ask unless “show hidden fields” is on.</p>
  </div>;
}

function FieldForm({ f, set }: { f: Field; set: (p: Partial<Field>) => void }) {
  const { cat } = useApp();
  const table = cat.tables[f.dataset];
  return <div className="fieldform">
    <label>Label <Txt value={f.label} onChange={v => set({ label: v })} /></label>
    <label>Role <Sel value={f.role} onChange={v => set({ role: v })} options={[['dimension', 'dimension'], ['measure', 'measure'], ['weight', 'weighting scheme']]} /></label>
    <label className="wide">Expression <Txt mono value={f.expr} onChange={v => set({ expr: v })} /><span className="hint"><ExprHint expr={f.expr} table={table} /></span></label>
    <label>Type <Sel value={f.type} onChange={v => set({ type: v })} options={[['number', 'number'], ['string', 'text'], ['time', 'time']]} /></label>
    {f.role === 'measure' && <>
      <label>Aggregation <Sel value={f.agg || 'avg'} onChange={v => set({ agg: v })} options={AGGS.map(a => [a, aggLabel(a)] as [Agg, string])} /></label>
      {f.agg === 'ratio' && <label className="wide">Denominator <Txt mono value={f.denominator} onChange={v => set({ denominator: v })} placeholder="duration_min" /></label>}
      <label>Additivity <Sel value={f.additivity || 'non_additive'} onChange={v => set({ additivity: v })} options={[['additive', 'additive (sums anywhere)'], ['semi_additive', 'semi-additive (not across time)'], ['non_additive', 'non-additive (average or ratio)']]} /></label>
      <label className="wide">Default weight <Txt mono value={f.weight} onChange={v => set({ weight: v || undefined })} placeholder="area_ha, duration_min (empty: every row counts once)" /></label>
      <label>Format <Sel value={f.format || 'number'} onChange={v => set({ format: v })} options={FORMATS} /></label>
      <label>Better when <Sel value={f.polarity || 'higher'} onChange={v => set({ polarity: v })} options={[['higher', 'higher'], ['lower', 'lower'], ['neutral', 'neither']]} /></label>
    </>}
    <label className="wide">Description <Txt value={f.description} onChange={v => set({ description: v })} placeholder="What it means; Ask reads this" /></label>
    <Check checked={f.hidden} onChange={v => set({ hidden: v || undefined })}>hidden by default</Check>
  </div>;
}
