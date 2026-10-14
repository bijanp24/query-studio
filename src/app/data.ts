// Loads a workspace's source items for this view and builds the processed layer from them.
import type { Source, SourceItem, Table, Workspace } from '../core/types';
import { loadItem, type ItemState } from '../core/load';
import { buildAll, type BuiltDataset } from '../core/ingest';
import { loadXLSX } from '../core/parse';
import { fetchBytes, projectBytes, textStore } from './platform';

export interface LoadOptions { live: boolean }

const enc = new TextEncoder();

/** Bytes for one item, by source kind. Warehouse kinds never reach here (load.ts answers for them). */
async function bytesFor(source: Source, item: SourceItem, opts: LoadOptions): Promise<ArrayBuffer> {
  const path = (source.base || '') + (item.path || '');
  switch (source.kind) {
    case 'bundled': {
      // Binary files the host will not serve as-is (Excel) are published as base64 text next to the page.
      if (/\.(xlsx|xls|xlsm)$/i.test(path)) {
        const t = new TextDecoder().decode(await fetchBytes(path + '.b64.txt'));
        const bin = atob(t.trim()); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
        return out.buffer;
      }
      return fetchBytes(path);
    }
    case 'url': return fetchBytes(path);
    case 'project':
      if (!opts.live) throw Object.assign(new Error('Live project data is off.'), { code: 'off' });
      return projectBytes(path);
    case 'upload': {
      const store = await textStore();
      const t = await store.get(item.localKey || 'up_' + item.id);
      if (t == null) throw Object.assign(new Error('The uploaded file is not saved for this account or browser. Upload it again.'), { code: 'missing' });
      return enc.encode(t).buffer as ArrayBuffer;
    }
    default: throw new Error(`No reader for ${source.kind} sources in the browser.`);
  }
}

let xlsx: Promise<unknown> | null = null;
export async function loadItems(ws: Workspace, opts: LoadOptions, only?: Set<string>, prev: Record<string, ItemState> = {}): Promise<Record<string, ItemState>> {
  const out: Record<string, ItemState> = { ...prev };
  await Promise.all(ws.items.map(async it => {
    if (only && !only.has(it.id)) return;
    const src = ws.sources.find(s => s.id === it.sourceId);
    let XLSX: unknown;
    if (it.format === 'excel') { xlsx ||= loadXLSX(); XLSX = await xlsx.catch(() => undefined); }
    const st = await loadItem(ws, it, (s, i) => bytesFor(s, i, opts), XLSX);
    if (st.error && src?.kind === 'project' && !opts.live) st.error = 'Live project data is off; the published snapshot is used instead.';
    out[it.id] = { ...st, origin: st.origin || describeOrigin(src, it) };
  }));
  for (const k of Object.keys(out)) if (!ws.items.some(i => i.id === k)) delete out[k];
  return out;
}

function describeOrigin(src: Source | undefined, it: SourceItem) {
  if (!src) return '';
  if (src.kind === 'project') return `project file ${(src.base || '') + (it.path || '')}`;
  if (src.kind === 'bundled') return `published with the app: ${(src.base || '') + (it.path || '')}`;
  if (src.kind === 'upload') return 'uploaded file';
  return src.kind;
}

/** Manual items are cheap to rebuild from the workspace itself, so edits show at once. */
export async function refreshManual(ws: Workspace, prev: Record<string, ItemState>) {
  const manual = new Set(ws.items.filter(i => ws.sources.find(s => s.id === i.sourceId)?.kind === 'manual').map(i => i.id));
  return loadItems(ws, { live: false }, manual, prev);
}

export function build(ws: Workspace, states: Record<string, ItemState>): Record<string, BuiltDataset> {
  const tables: Record<string, Table | undefined> = {};
  for (const [k, v] of Object.entries(states)) tables[k] = v.table;
  return buildAll(ws, tables);
}
