import React from 'react';
import type { Dashboard, Query, Visualization, Workspace } from '../core/types';
import type { Catalog, Result } from '../core/engine';
import { run } from '../core/engine';
import type { BuiltDataset } from '../core/ingest';
import type { ItemState } from '../core/load';

export type Tab = 'dashboards' | 'queries' | 'visualizations' | 'sources' | 'datasets' | 'model';

export interface App {
  ws: Workspace;
  update: (fn: (w: Workspace) => Workspace) => void;
  cat: Catalog;
  built: Record<string, BuiltDataset>;
  items: Record<string, ItemState>;
  loading: boolean;
  showHidden: boolean;
  live: boolean;
  setLive: (v: boolean) => void;
  reload: () => void;
  go: (tab: Tab, focus?: string) => void;
  focus?: string;
  toast: (msg: string) => void;
}

export const AppCtx = React.createContext<App>(null as unknown as App);
export const useApp = () => React.useContext(AppCtx);

// Results are cached per catalog build and query definition, so tiles and editors share work.
const cache = new WeakMap<object, Map<string, Result>>();
export function runCached(cat: Catalog, q: Query, dash?: Dashboard): Result {
  let m = cache.get(cat.tables); if (!m) { m = new Map(); cache.set(cat.tables, m); }
  const k = JSON.stringify([q, dash && q.followDashboard ? [dash.filters, dash.last] : null, cat.ws.fields.filter(f => f.dataset === q.dataset || (q.compare.kind === 'reference' && f.dataset === q.compare.dataset))]);
  let r = m.get(k);
  if (!r) { try { r = run(cat, q, dash); } catch (e) { r = { query: q, datasetId: q.dataset, grain: 'row', rows: [], n: 0, measures: [], value: null, values: [], warnings: [(e as Error).message] }; } m.set(k, r); if (m.size > 400) m.delete(m.keys().next().value!); }
  return r;
}

export const vizById = (ws: Workspace, id: string): Visualization | undefined => ws.visualizations.find(v => v.id === id);
export const queryById = (ws: Workspace, id: string): Query | undefined => ws.queries.find(q => q.id === id);
