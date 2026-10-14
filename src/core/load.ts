// Loading source items into tables. The bytes come from whatever the runtime offers for that
// source kind (a fetch, the project files capability, the asset store, a warehouse driver); this
// module only turns bytes or manual rows into Tables.
import type { Source, SourceItem, Table, Workspace } from './types';
import { parseBytes, toTable } from './parse';

export type BytesProvider = (source: Source, item: SourceItem) => Promise<ArrayBuffer>;

export interface ItemState { table?: Table; error?: string; loadedAt?: string; bytes?: number; origin?: string }

export async function loadItem(ws: Workspace, item: SourceItem, provider: BytesProvider, XLSX?: any): Promise<ItemState> {
  const source = ws.sources.find(s => s.id === item.sourceId);
  if (!source) return { error: 'This table points at a source that no longer exists.' };
  try {
    if (source.kind === 'manual') {
      const table = toTable((item.rows || []) as Record<string, unknown>[]);
      for (const c of item.schema || []) {
        const have = table.columns.find(x => x.name === c.name);
        if (!have) { table.columns.push({ ...c }); for (const r of table.rows) r[c.name] = null; }
        else if (have.type !== c.type && c.type === 'number') { have.type = 'number'; for (const r of table.rows) r[c.name] = r[c.name] == null || r[c.name] === '' ? null : Number(r[c.name]); }
      }
      return { table, loadedAt: new Date().toISOString(), origin: 'typed in the app' };
    }
    if (['postgres', 'redshift', 'snowflake', 'bigquery', 'duckdb'].includes(source.kind)) return { error: 'Warehouse sources run on the query server, which is not deployed yet. The SQL tab shows what it would run.' };
    const bytes = await provider(source, item);
    const table = await parseBytes(bytes, item.format, { sheet: item.sheet, jsonPath: item.jsonPath, explode: item.explode }, XLSX);
    // Manual key columns for empty manual-like tables keep their shape.
    return { table, loadedAt: new Date().toISOString(), bytes: bytes.byteLength };
  } catch (e) {
    const err = e as { code?: string; message?: string };
    return { error: err.code === 'not_found' ? 'Not reachable from this view.' : err.code === 'not_granted' ? 'Access to the project files was declined.' : (err.message || String(e)) };
  }
}

/** Empty manual tables still need their key columns so lookups and the row editor work. */
export function manualColumns(item: SourceItem): string[] {
  const cols = new Set<string>(item.keyColumns || []);
  for (const r of item.rows || []) Object.keys(r).forEach(k => cols.add(k));
  return [...cols];
}
