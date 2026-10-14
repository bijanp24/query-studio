// Small form pieces shared by the editors.
import React from 'react';
import type { Field, Filter, FilterOp } from '../core/types';

export function Sel<T extends string>({ value, onChange, options, blank, className, title, disabled }: { value: T | '' | undefined; onChange: (v: T) => void; options: ([T, string] | { group: string; items: [T, string][] })[]; blank?: string; className?: string; title?: string; disabled?: boolean }) {
  return <select className={className} value={value ?? ''} title={title} disabled={disabled} onChange={e => onChange(e.target.value as T)}>
    {blank != null && <option value="">{blank}</option>}
    {options.map((o, i) => Array.isArray(o) ? <option key={o[0] + i} value={o[0]}>{o[1]}</option> : <optgroup key={o.group} label={o.group}>{o.items.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</optgroup>)}
  </select>;
}

export function Txt({ value, onChange, placeholder, className, mono, onBlur, list }: { value: string | undefined; onChange: (v: string) => void; placeholder?: string; className?: string; mono?: boolean; onBlur?: () => void; list?: string }) {
  return <input type="text" className={(className || '') + (mono ? ' mono' : '')} value={value ?? ''} placeholder={placeholder} onChange={e => onChange(e.target.value)} onBlur={onBlur} list={list} spellCheck={false} />;
}

export function Num({ value, onChange, min, max, step, placeholder, className }: { value: number | undefined | null; onChange: (v: number | undefined) => void; min?: number; max?: number; step?: number; placeholder?: string; className?: string }) {
  return <input type="number" className={className} value={value == null || Number.isNaN(value) ? '' : value} min={min} max={max} step={step} placeholder={placeholder} onChange={e => onChange(e.target.value === '' ? undefined : Number(e.target.value))} />;
}

export function Check({ checked, onChange, children }: { checked: boolean | undefined; onChange: (v: boolean) => void; children: React.ReactNode }) {
  return <label className="check"><input type="checkbox" checked={!!checked} onChange={e => onChange(e.target.checked)} /> {children}</label>;
}

export function Row({ label, children, hint }: { label: string; children: React.ReactNode; hint?: React.ReactNode }) {
  return <div className="frow"><label className="flabel">{label}</label><div className="fctl">{children}{hint ? <div className="hint">{hint}</div> : null}</div></div>;
}

export function Badge({ children, tone }: { children: React.ReactNode; tone?: 'ok' | 'warn' | 'bad' | 'info' }) { return <span className={'badge ' + (tone || '')}>{children}</span>; }

/** Fields for a picker: dimensions, measures and weights in groups; hidden fields only when asked. */
export function fieldOptions(fields: Field[], showHidden: boolean, roles: Field['role'][] = ['dimension', 'measure']) {
  const vis = fields.filter(f => roles.includes(f.role) && (showHidden || !f.hidden));
  const groups: { group: string; items: [string, string][] }[] = [];
  for (const r of roles) { const items = vis.filter(f => f.role === r).map(f => [f.id, f.label + (f.hidden ? ' (hidden)' : '')] as [string, string]); if (items.length) groups.push({ group: r === 'dimension' ? 'Dimensions' : r === 'measure' ? 'Measures' : 'Weights', items }); }
  return groups;
}

export const OPS: [FilterOp, string][] = [['=', '='], ['!=', '≠'], ['>', '>'], ['<', '<'], ['>=', '≥'], ['<=', '≤'], ['in', 'in list'], ['contains', 'contains'], ['is_null', 'is empty'], ['not_null', 'is not empty']];

export function FiltersEditor({ filters, onChange, fields, showHidden, valuesFor }: { filters: Filter[]; onChange: (f: Filter[]) => void; fields: Field[]; showHidden: boolean; valuesFor?: (field: string) => string[] }) {
  const set = (i: number, p: Partial<Filter>) => onChange(filters.map((f, j) => j === i ? { ...f, ...p } : f));
  return <div className="filters">
    {filters.map((f, i) => {
      const listId = `vals-${i}-${f.field}`;
      const vals = valuesFor ? valuesFor(f.field) : [];
      return <div key={i} className="filter">
        <Sel value={f.field} onChange={v => set(i, { field: v })} options={fieldOptions(fields, showHidden)} blank="field…" />
        <Sel value={f.op} onChange={v => set(i, { op: v })} options={OPS} />
        {f.op !== 'is_null' && f.op !== 'not_null' && <><Txt value={f.value} onChange={v => set(i, { value: v })} placeholder={f.op === 'in' ? 'a, b, c' : 'value'} list={vals.length ? listId : undefined} />{vals.length > 0 && <datalist id={listId}>{vals.slice(0, 200).map(v => <option key={v} value={v} />)}</datalist>}</>}
        <button type="button" className="ghost icon" title="Remove filter" onClick={() => onChange(filters.filter((_, j) => j !== i))}>×</button>
      </div>;
    })}
    <button type="button" className="ghost" onClick={() => onChange([...filters, { field: '', op: '=', value: '' }])}>+ filter</button>
  </div>;
}

export const uid = (p = 'x') => p + '_' + Math.random().toString(36).slice(2, 9);

export function Collapsible({ title, children, open: open0 = false, extra }: { title: React.ReactNode; children: React.ReactNode; open?: boolean; extra?: React.ReactNode }) {
  const [open, setOpen] = React.useState(open0);
  return <div className={'coll' + (open ? ' open' : '')}><div className="collh"><button type="button" className="ghost" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? '▾' : '▸'} {title}</button>{extra}</div>{open && <div className="collb">{children}</div>}</div>;
}
