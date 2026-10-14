// A small expression language for derived columns, calculated fields and formula measures.
// It is parsed once into an AST, then either evaluated per row in the browser or emitted as SQL,
// so a formula means the same thing in the local engine and in a warehouse. No eval/new Function.
//
//   cs_per_min - opp_cs_per_min
//   (kills + assists) / max(deaths, 1)
//   if(win = 1, 'win', 'loss')
//   decode(queue, 420, 'Ranked Solo', 440, 'Ranked Flex', 'Other')
//   split_part(account, '#', 1)
import type { Row, Value } from './types';
import type { Dialect } from './sql';

export type Node =
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | { t: 'null' }
  | { t: 'col'; name: string }
  | { t: 'un'; op: '-' | 'not'; a: Node }
  | { t: 'bin'; op: string; a: Node; b: Node }
  | { t: 'call'; fn: string; args: Node[] };

type Tok = { k: 'num' | 'str' | 'id' | 'qid' | 'op' | 'eof'; v: string; pos: number };

const OPS = ['<=', '>=', '!=', '<>', '=', '<', '>', '+', '-', '*', '/', '%', '(', ')', ','];

function lex(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      let j = i; while (j < src.length && /[0-9.eE]/.test(src[j])) j++;
      out.push({ k: 'num', v: src.slice(i, j), pos: i }); i = j; continue;
    }
    if (c === "'") {
      let j = i + 1, s = '';
      while (j < src.length) { if (src[j] === "'") { if (src[j + 1] === "'") { s += "'"; j += 2; continue; } break; } s += src[j++]; }
      if (j >= src.length) throw new ExprError('Unclosed quote', i);
      out.push({ k: 'str', v: s, pos: i }); i = j + 1; continue;
    }
    if (c === '"') {
      const j = src.indexOf('"', i + 1); if (j < 0) throw new ExprError('Unclosed "name"', i);
      out.push({ k: 'qid', v: src.slice(i + 1, j), pos: i }); i = j + 1; continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i; while (j < src.length && /[A-Za-z0-9_]/.test(src[j])) j++;
      out.push({ k: 'id', v: src.slice(i, j), pos: i }); i = j; continue;
    }
    const op = OPS.find(o => src.startsWith(o, i));
    if (!op) throw new ExprError(`Unexpected "${c}"`, i);
    out.push({ k: 'op', v: op, pos: i }); i += op.length;
  }
  out.push({ k: 'eof', v: '', pos: src.length });
  return out;
}

export class ExprError extends Error { constructor(msg: string, public pos: number) { super(msg); } }

const PREC: Record<string, number> = { or: 1, and: 2, '=': 4, '!=': 4, '<>': 4, '<': 4, '>': 4, '<=': 4, '>=': 4, '+': 5, '-': 5, '*': 6, '/': 6, '%': 6 };

export const FUNCS: Record<string, { min: number; max: number; doc: string }> = {
  abs: { min: 1, max: 1, doc: 'abs(x)' }, round: { min: 1, max: 2, doc: 'round(x, digits)' },
  floor: { min: 1, max: 1, doc: 'floor(x)' }, ceil: { min: 1, max: 1, doc: 'ceil(x)' },
  sqrt: { min: 1, max: 1, doc: 'sqrt(x)' }, ln: { min: 1, max: 1, doc: 'ln(x)' }, log: { min: 1, max: 1, doc: 'log(x), base 10' },
  exp: { min: 1, max: 1, doc: 'exp(x)' }, pow: { min: 2, max: 2, doc: 'pow(x, y)' },
  min: { min: 2, max: 9, doc: 'min(a, b, ...) of values in one row' }, max: { min: 2, max: 9, doc: 'max(a, b, ...) of values in one row' },
  coalesce: { min: 2, max: 9, doc: 'coalesce(a, b, ...) first non-empty' }, nullif: { min: 2, max: 2, doc: 'nullif(a, b)' },
  if: { min: 3, max: 3, doc: "if(condition, then, else)" },
  decode: { min: 3, max: 41, doc: "decode(x, key1, value1, ..., default)" },
  split_part: { min: 3, max: 3, doc: "split_part(text, '#', 1)" },
  lower: { min: 1, max: 1, doc: 'lower(text)' }, upper: { min: 1, max: 1, doc: 'upper(text)' },
  hour: { min: 1, max: 1, doc: 'hour(time) 0-23' }, weekday: { min: 1, max: 1, doc: "weekday(time) 'Mon'..'Sun'" },
  date: { min: 1, max: 1, doc: "date(time) 'YYYY-MM-DD'" }, month: { min: 1, max: 1, doc: "month(time) 'YYYY-MM'" },
  year: { min: 1, max: 1, doc: 'year(time)' },
};

export function parse(src: string): Node {
  const toks = lex(src);
  let p = 0;
  const peek = () => toks[p];
  const next = () => toks[p++];
  const expect = (v: string) => { const t = next(); if (t.v !== v) throw new ExprError(`Expected "${v}"`, t.pos); };
  function primary(): Node {
    const t = next();
    if (t.k === 'num') { const v = Number(t.v); if (!isFinite(v)) throw new ExprError('Bad number', t.pos); return { t: 'num', v }; }
    if (t.k === 'str') return { t: 'str', v: t.v };
    if (t.k === 'qid') return { t: 'col', name: t.v };
    if (t.k === 'op' && t.v === '(') { const e = expr(0); expect(')'); return e; }
    if (t.k === 'op' && t.v === '-') return { t: 'un', op: '-', a: unary() };
    if (t.k === 'id') {
      const low = t.v.toLowerCase();
      if (low === 'null') return { t: 'null' };
      if (low === 'true') return { t: 'num', v: 1 };
      if (low === 'false') return { t: 'num', v: 0 };
      if (low === 'not') return { t: 'un', op: 'not', a: unary() };
      if (peek().v === '(' && peek().k === 'op') {
        next();
        const args: Node[] = [];
        if (peek().v !== ')') { do { args.push(expr(0)); } while (peek().v === ',' && next()); }
        expect(')');
        const f = FUNCS[low];
        if (!f) throw new ExprError(`Unknown function ${t.v}()`, t.pos);
        if (args.length < f.min || args.length > f.max) throw new ExprError(`${f.doc} takes ${f.min === f.max ? f.min : f.min + '-' + f.max} arguments`, t.pos);
        return { t: 'call', fn: low, args };
      }
      return { t: 'col', name: t.v };
    }
    throw new ExprError(t.k === 'eof' ? 'Formula ends too early' : `Unexpected "${t.v}"`, t.pos);
  }
  function unary(): Node { return primary(); }
  function expr(minPrec: number): Node {
    let left = unary();
    for (;;) {
      const t = peek();
      const op = t.k === 'id' ? t.v.toLowerCase() : t.k === 'op' ? t.v : '';
      const pr = PREC[op];
      if (pr == null || pr < minPrec) break;
      next();
      const right = expr(pr + 1);
      left = { t: 'bin', op: op === '<>' ? '!=' : op, a: left, b: right };
    }
    return left;
  }
  const n = expr(0);
  if (peek().k !== 'eof') throw new ExprError(`Unexpected "${peek().v}"`, peek().pos);
  return n;
}

const cache = new Map<string, Node | ExprError>();
export function compile(src: string): Node {
  const hit = cache.get(src);
  if (hit instanceof ExprError) throw hit;
  if (hit) return hit;
  try { const n = parse(src); cache.set(src, n); return n; } catch (e) { const err = e instanceof ExprError ? e : new ExprError(String(e), 0); cache.set(src, err); throw err; }
}
export function tryCompile(src: string): { node?: Node; error?: string } {
  try { return { node: compile(src) }; } catch (e) { return { error: (e as Error).message }; }
}

export function columnsOf(n: Node, out = new Set<string>()): Set<string> {
  if (n.t === 'col') out.add(n.name);
  else if (n.t === 'un') columnsOf(n.a, out);
  else if (n.t === 'bin') { columnsOf(n.a, out); columnsOf(n.b, out); }
  else if (n.t === 'call') n.args.forEach(a => columnsOf(a, out));
  return out;
}
export const isBareColumn = (src: string) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(src.trim());

// ---------- evaluation (null-propagating like SQL) ----------
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function toTime(v: Value): Date | null {
  if (v == null || v === '') return null;
  const s = String(v);
  const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : s.replace(' ', 'T') + (s.length <= 10 ? 'T00:00:00Z' : 'Z'));
  return isNaN(d.getTime()) ? null : d;
}
const pad = (n: number) => String(n).padStart(2, '0');
const num = (v: Value): number | null => v == null || v === '' ? null : typeof v === 'number' ? v : isNaN(+v) ? null : +v;
const truthy = (v: Value) => v != null && v !== 0 && v !== '' && v !== '0';

function cmp(a: Value, b: Value): number | null {
  if (a == null || b == null) return null;
  const na = num(a), nb = num(b);
  if (na != null && nb != null && (typeof a === 'number' || typeof b === 'number')) return na - nb;
  const sa = String(a), sb = String(b);
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

export function evaluate(n: Node, r: Row): Value {
  switch (n.t) {
    case 'num': return n.v;
    case 'str': return n.v;
    case 'null': return null;
    case 'col': { const v = r[n.name]; return v === undefined || v === '' ? null : v; }
    case 'un': {
      const a = evaluate(n.a, r);
      if (n.op === '-') { const x = num(a); return x == null ? null : -x; }
      return a == null ? null : truthy(a) ? 0 : 1;
    }
    case 'bin': {
      if (n.op === 'and') { const a = evaluate(n.a, r), b = evaluate(n.b, r); if ((a != null && !truthy(a)) || (b != null && !truthy(b))) return 0; return a == null || b == null ? null : 1; }
      if (n.op === 'or') { const a = evaluate(n.a, r), b = evaluate(n.b, r); if (truthy(a) || truthy(b)) return 1; return a == null || b == null ? null : 0; }
      const a = evaluate(n.a, r), b = evaluate(n.b, r);
      if (['=', '!=', '<', '>', '<=', '>='].includes(n.op)) {
        const c = cmp(a, b); if (c == null) return null;
        switch (n.op) { case '=': return c === 0 ? 1 : 0; case '!=': return c !== 0 ? 1 : 0; case '<': return c < 0 ? 1 : 0; case '>': return c > 0 ? 1 : 0; case '<=': return c <= 0 ? 1 : 0; default: return c >= 0 ? 1 : 0; }
      }
      const x = num(a), y = num(b);
      if (x == null || y == null) return null;
      switch (n.op) {
        case '+': return x + y; case '-': return x - y; case '*': return x * y;
        case '/': return y === 0 ? null : x / y;
        case '%': return y === 0 ? null : x % y;
      }
      return null;
    }
    case 'call': return call(n.fn, n.args, r);
  }
}

function call(fn: string, args: Node[], r: Row): Value {
  if (fn === 'if') { const c = evaluate(args[0], r); return evaluate(truthy(c) ? args[1] : args[2], r); }
  if (fn === 'coalesce') { for (const a of args) { const v = evaluate(a, r); if (v != null) return v; } return null; }
  if (fn === 'decode') {
    const x = evaluate(args[0], r);
    let i = 1;
    for (; i + 1 < args.length; i += 2) { const k = evaluate(args[i], r); if (x != null && k != null && cmp(x, k) === 0) return evaluate(args[i + 1], r); }
    return i < args.length ? evaluate(args[i], r) : null;
  }
  const v = args.map(a => evaluate(a, r));
  const n0 = num(v[0]);
  switch (fn) {
    case 'abs': return n0 == null ? null : Math.abs(n0);
    case 'round': { if (n0 == null) return null; const d = num(v[1] ?? 0) ?? 0; const m = 10 ** d; return Math.round(n0 * m) / m; }
    case 'floor': return n0 == null ? null : Math.floor(n0);
    case 'ceil': return n0 == null ? null : Math.ceil(n0);
    case 'sqrt': return n0 == null || n0 < 0 ? null : Math.sqrt(n0);
    case 'ln': return n0 == null || n0 <= 0 ? null : Math.log(n0);
    case 'log': return n0 == null || n0 <= 0 ? null : Math.log10(n0);
    case 'exp': return n0 == null ? null : Math.exp(n0);
    case 'pow': { const y = num(v[1]); return n0 == null || y == null ? null : n0 ** y; }
    case 'min': case 'max': { const xs = v.map(num); if (xs.some(x => x == null)) return null; return fn === 'min' ? Math.min(...xs as number[]) : Math.max(...xs as number[]); }
    case 'nullif': return v[0] != null && v[1] != null && cmp(v[0], v[1]) === 0 ? null : v[0];
    case 'split_part': { if (v[0] == null) return null; const parts = String(v[0]).split(String(v[1])); const k = (num(v[2]) ?? 1) - 1; return parts[k] ?? ''; }
    case 'lower': return v[0] == null ? null : String(v[0]).toLowerCase();
    case 'upper': return v[0] == null ? null : String(v[0]).toUpperCase();
    case 'hour': { const d = toTime(v[0]); return d ? d.getUTCHours() : null; }
    case 'weekday': { const d = toTime(v[0]); return d ? WD[d.getUTCDay()] : null; }
    case 'date': { const d = toTime(v[0]); return d ? `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` : null; }
    case 'month': { const d = toTime(v[0]); return d ? `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}` : null; }
    case 'year': { const d = toTime(v[0]); return d ? d.getUTCFullYear() : null; }
  }
  return null;
}

export const evalSrc = (src: string, r: Row) => evaluate(compile(src), r);

// ---------- SQL emission ----------
export function quoteIdent(name: string) { return /^[a-z_][a-z0-9_]*$/.test(name) ? name : '"' + name.replace(/"/g, '""') + '"'; }
const sqlStr = (s: string) => "'" + s.replace(/'/g, "''") + "'";

export function toSQL(n: Node, d: Dialect): string {
  const S = (x: Node) => toSQL(x, d);
  switch (n.t) {
    case 'num': return String(n.v);
    case 'str': return sqlStr(n.v);
    case 'null': return 'NULL';
    case 'col': return quoteIdent(n.name);
    case 'un': return n.op === '-' ? `(-${S(n.a)})` : `(CASE WHEN ${bool(n.a, d)} THEN 0 ELSE 1 END)`;
    case 'bin': {
      if (n.op === 'and' || n.op === 'or') return `(CASE WHEN ${bool(n.a, d)} ${n.op.toUpperCase()} ${bool(n.b, d)} THEN 1 ELSE 0 END)`;
      if (['=', '!=', '<', '>', '<=', '>='].includes(n.op)) return `(CASE WHEN ${S(n.a)} ${n.op === '!=' ? '<>' : n.op} ${S(n.b)} THEN 1 WHEN ${S(n.a)} IS NULL OR ${S(n.b)} IS NULL THEN NULL ELSE 0 END)`;
      if (n.op === '/') return `(CAST(${S(n.a)} AS DOUBLE PRECISION) / NULLIF(${S(n.b)}, 0))`;
      if (n.op === '%') return `(${S(n.a)} % NULLIF(${S(n.b)}, 0))`;
      return `(${S(n.a)} ${n.op} ${S(n.b)})`;
    }
    case 'call': {
      const a = n.args.map(S);
      const ts = (x: string) => d === 'bigquery' ? `TIMESTAMP(${x})` : `CAST(${x} AS TIMESTAMP)`;
      switch (n.fn) {
        case 'if': return `(CASE WHEN ${bool(n.args[0], d)} THEN ${a[1]} ELSE ${a[2]} END)`;
        case 'decode': {
          let s = `(CASE ${a[0]}`; let i = 1;
          for (; i + 1 < a.length; i += 2) s += ` WHEN ${a[i]} THEN ${a[i + 1]}`;
          return s + (i < a.length ? ` ELSE ${a[i]}` : '') + ' END)';
        }
        case 'min': return `LEAST(${a.join(', ')})`;
        case 'max': return `GREATEST(${a.join(', ')})`;
        case 'ln': return `LN(${a[0]})`;
        case 'log': return d === 'bigquery' ? `LOG10(${a[0]})` : `LOG(${a[0]})`;
        case 'pow': return `POWER(${a[0]}, ${a[1]})`;
        case 'round': return `ROUND(${a[0]}${a[1] ? ', ' + a[1] : ''})`;
        case 'split_part': return d === 'bigquery' ? `SPLIT(${a[0]}, ${a[1]})[SAFE_ORDINAL(${a[2]})]` : `SPLIT_PART(${a[0]}, ${a[1]}, ${a[2]})`;
        case 'hour': return `EXTRACT(HOUR FROM ${ts(a[0])})`;
        case 'year': return `EXTRACT(YEAR FROM ${ts(a[0])})`;
        case 'weekday':
          if (d === 'duckdb') return `STRFTIME(${ts(a[0])}, '%a')`;
          if (d === 'bigquery') return `FORMAT_TIMESTAMP('%a', ${ts(a[0])})`;
          return `TO_CHAR(${ts(a[0])}, 'Dy')`;
        case 'date':
          if (d === 'duckdb') return `STRFTIME(${ts(a[0])}, '%Y-%m-%d')`;
          if (d === 'bigquery') return `FORMAT_TIMESTAMP('%Y-%m-%d', ${ts(a[0])})`;
          return `TO_CHAR(${ts(a[0])}, 'YYYY-MM-DD')`;
        case 'month':
          if (d === 'duckdb') return `STRFTIME(${ts(a[0])}, '%Y-%m')`;
          if (d === 'bigquery') return `FORMAT_TIMESTAMP('%Y-%m', ${ts(a[0])})`;
          return `TO_CHAR(${ts(a[0])}, 'YYYY-MM')`;
        default: return `${n.fn.toUpperCase()}(${a.join(', ')})`;
      }
    }
  }
}
function bool(n: Node, d: Dialect) {
  if (n.t === 'bin' && ['=', '!=', '<', '>', '<=', '>='].includes(n.op)) return `${toSQL(n.a, d)} ${n.op === '!=' ? '<>' : n.op} ${toSQL(n.b, d)}`;
  return `COALESCE(${toSQL(n, d)}, 0) <> 0`;
}
export const srcToSQL = (src: string, d: Dialect) => toSQL(compile(src), d);
export { toTime, num as toNum };
