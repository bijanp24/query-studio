import React from 'react';
import type { Dashboard, Query, Visualization } from '../core/types';
import { Viz } from './viz/charts';
import { runCached, useApp } from './ctx';
import { fieldsFor } from '../core/semantic';
import { fmt } from '../core/engine';

/** One visualization drawn from its query, with what the number means spelled out underneath. */
export function TileBody({ v, q, dash }: { v: Visualization; q: Query; dash?: Dashboard }) {
  const { cat, ws } = useApp();
  const res = runCached(cat, q, dash);
  const weighted = res.measures.find(m => m.weight);
  const fields = fieldsFor(ws, q.dataset, cat.tables[q.dataset]);
  const wLabel = weighted ? (fields.find(f => f.id === q.weight)?.label || weighted.weight) : null;
  const eff = res.query;
  const extraFilters = dash && q.followDashboard ? dash.filters.filter(f => f.field && eff.filters.includes(f)) : [];
  return <>
    <Viz v={v} res={res} cat={cat} />
    {weighted && <div className="wnote">Weighted by {wLabel}{res.unweighted && !res.groups && v.type !== 'table' ? <> · unweighted {fmt(res.unweighted[0], res.measures[0].format)}</> : null}</div>}
    {res.warnings.length > 0 && <div className="warn small">{res.warnings.slice(0, 3).join(' · ')}</div>}
    {v.note && <div className="note">{v.note}</div>}
    {extraFilters.length > 0 && <div className="small muted">Dashboard filter: {extraFilters.map(f => `${f.field} ${f.op} ${f.value}`).join(', ')}</div>}
  </>;
}

