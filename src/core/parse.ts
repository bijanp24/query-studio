// File parsers for the source layer: CSV, JSON and Excel all become the same Table shape,
// with column types inferred from the values (numbers, times, text; True/False become 1/0).
import type { Column, ColumnType, Row, Table, Value } from './types';

export function parseCSVText(text: string): Record<string, string>[] {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const firstLine = text.slice(0, text.indexOf('\n') >>> 0);
  const delim = [',', ';', '\t', '|'].map(d => [d, firstLine.split(d).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  const rows: string[][] = [];
  let row: string[] = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"' && field === '') q = true;
    else if (c === delim) { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  const head = (rows.shift() || []).map((h, i) => h.trim() || `column_${i + 1}`);
  return rows.filter(r => r.length > 1 || (r.length === 1 && r[0] !== '')).map(r => {
    const o: Record<string, string> = {};
    head.forEach((h, i) => { o[h] = r[i] ?? ''; });
    return o;
  });
}

/** Flatten nested objects into a_b columns; arrays of scalars join with '; '. */
function flatten(o: unknown, prefix = '', out: Record<string, unknown> = {}): Record<string, unknown> {
  if (o && typeof o === 'object' && !Array.isArray(o)) {
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      const key = prefix ? `${prefix}_${k}` : k;
      if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out);
      else if (Array.isArray(v)) { if (v.every(x => x == null || typeof x !== 'object')) out[key] = v.join('; '); }
      else out[key] = v;
    }
  } else out[prefix || 'value'] = o;
  return out;
}

export function jsonRecords(data: unknown, jsonPath = '', explode = ''): Record<string, unknown>[] {
  let node: unknown = data;
  for (const seg of jsonPath.split('.').filter(Boolean)) node = node && typeof node === 'object' ? (node as Record<string, unknown>)[seg] : undefined;
  if (node && !Array.isArray(node) && typeof node === 'object') {
    // An object of objects keyed by id becomes rows with an "id" column.
    const vals = Object.values(node as Record<string, unknown>);
    node = vals.length && vals.every(v => v && typeof v === 'object' && !Array.isArray(v)) ? Object.entries(node as Record<string, unknown>).map(([id, v]) => ({ id, ...(v as object) })) : [node];
  }
  const arr = Array.isArray(node) ? node : node == null ? [] : [node];
  const out: Record<string, unknown>[] = [];
  for (const rec of arr) {
    const ex = explode && rec && typeof rec === 'object' ? (rec as Record<string, unknown>)[explode] : undefined;
    if (Array.isArray(ex)) {
      const parent = { ...(rec as Record<string, unknown>) }; delete parent[explode];
      const base = flatten(parent);
      for (const child of ex) out.push({ ...base, ...flatten(child) });
    } else out.push(flatten(rec));
  }
  return out;
}

/** Find candidate arrays of records inside a JSON document, for the source item picker. */
export function jsonArrayPaths(data: unknown, path = '', out: { path: string; length: number; nested: string[] }[] = [], depth = 0): typeof out {
  if (depth > 4 || data == null || typeof data !== 'object') return out;
  if (Array.isArray(data)) {
    const first = data.find(x => x && typeof x === 'object' && !Array.isArray(x)) as Record<string, unknown> | undefined;
    if (first) out.push({ path, length: data.length, nested: Object.keys(first).filter(k => Array.isArray(first[k]) && (first[k] as unknown[]).some(x => x && typeof x === 'object')) });
    return out;
  }
  for (const [k, v] of Object.entries(data as Record<string, unknown>)) jsonArrayPaths(v, path ? `${path}.${k}` : k, out, depth + 1);
  return out;
}

const TIME_RE = /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;
const NUM_RE = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

function inferType(vals: unknown[]): ColumnType {
  let n = 0, nums = 0, times = 0;
  for (const v of vals) {
    if (v == null || v === '') continue;
    n++;
    if (typeof v === 'number' || typeof v === 'boolean') { nums++; continue; }
    const s = String(v).trim();
    if (NUM_RE.test(s) || /^(true|false)$/i.test(s)) nums++;
    else if (TIME_RE.test(s)) times++;
    if (n >= 400) break;
  }
  if (!n) return 'string';
  if (nums === n) return 'number';
  if (times === n) return 'time';
  return 'string';
}

function coerce(v: unknown, t: ColumnType): Value {
  if (v == null || v === '') return null;
  if (t === 'number') {
    if (typeof v === 'number') return isFinite(v) ? v : null;
    if (typeof v === 'boolean') return v ? 1 : 0;
    const s = String(v).trim();
    if (/^true$/i.test(s)) return 1;
    if (/^false$/i.test(s)) return 0;
    const x = Number(s); return isFinite(x) ? x : null;
  }
  if (t === 'time') { const s = String(v).trim(); return s.length > 16 && s[10] === ' ' ? s.slice(0, 16) : s.replace('T', ' ').slice(0, 16); }
  return String(v);
}

export function toTable(records: Record<string, unknown>[]): Table {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const r of records.slice(0, 2000)) for (const k of Object.keys(r)) if (!seen.has(k)) { seen.add(k); names.push(k); }
  const columns: Column[] = names.map(name => ({ name, type: inferType(records.map(r => r[name])) }));
  const rows: Row[] = records.map(r => { const o: Row = {}; for (const c of columns) o[c.name] = coerce(r[c.name], c.type); return o; });
  return { columns, rows };
}

/** Excel through SheetJS, loaded from cdnjs the first time a workbook is opened. */
declare global { interface Window { XLSX?: any } }
let xlsxLoading: Promise<any> | null = null;
export function loadXLSX(): Promise<any> {
  if (typeof window === 'undefined') return Promise.reject(new Error('Excel parsing needs a browser'));
  if (window.XLSX) return Promise.resolve(window.XLSX);
  if (!xlsxLoading) xlsxLoading = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
    s.onload = () => window.XLSX ? res(window.XLSX) : rej(new Error('Excel library did not load'));
    s.onerror = () => { xlsxLoading = null; rej(new Error('Excel library could not be downloaded')); };
    document.head.appendChild(s);
  });
  return xlsxLoading;
}
export async function excelSheets(bytes: ArrayBuffer, XLSX?: any): Promise<{ names: string[]; read: (sheet?: string) => Record<string, unknown>[] }> {
  const X = XLSX || await loadXLSX();
  const wb = X.read(new Uint8Array(bytes), { type: 'array', cellDates: true });
  return {
    names: wb.SheetNames,
    read: (sheet?: string) => {
      const ws = wb.Sheets[sheet && wb.SheetNames.includes(sheet) ? sheet : wb.SheetNames[0]];
      const recs: Record<string, unknown>[] = X.utils.sheet_to_json(ws, { defval: null, raw: true });
      return recs.map(r => { const o: Record<string, unknown> = {}; for (const [k, v] of Object.entries(r)) o[k] = v instanceof Date ? v.toISOString().slice(0, 16).replace('T', ' ') : v; return o; });
    },
  };
}

export async function parseBytes(bytes: ArrayBuffer, format: 'csv' | 'json' | 'excel', opts: { sheet?: string; jsonPath?: string; explode?: string } = {}, XLSX?: any): Promise<Table> {
  if (format === 'excel') { const wb = await excelSheets(bytes, XLSX); return toTable(wb.read(opts.sheet)); }
  const text = new TextDecoder().decode(bytes);
  if (format === 'json') {
    const t = text.trim();
    // JSON Lines: one object per line
    const data = t.startsWith('{') && t.includes('}\n{') ? t.split('\n').filter(Boolean).map(l => JSON.parse(l)) : JSON.parse(t);
    return toTable(jsonRecords(data, opts.jsonPath, opts.explode));
  }
  return toTable(parseCSVText(text));
}

export function formatFromName(name: string): 'csv' | 'json' | 'excel' {
  const n = name.toLowerCase();
  if (n.endsWith('.json') || n.endsWith('.jsonl') || n.endsWith('.ndjson')) return 'json';
  if (n.endsWith('.xlsx') || n.endsWith('.xls') || n.endsWith('.xlsm')) return 'excel';
  return 'csv';
}
