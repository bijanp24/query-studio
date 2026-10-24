// Draws one card as a self-contained SVG at its real export size (1080x1920 for a Reel, 1080x1080 for a
// square post). Colors are written as literal attributes from the chosen look, never CSS variables, so
// the same markup can be serialized and turned into a PNG without the page around it.
import React from 'react';
import type { Card, Item, Style, Tone } from './cards';

export type Format = 'reel' | 'square';
export type LookId = 'light' | 'dark' | 'pop';
export interface Look { card: string; ink: string; ink2: string; me: string; ref: string; good: string; bad: string; grid: string; chip: string; chipInk: string }
export const LOOKS: Record<LookId, Look> = {
  light: { card: '#ffffff', ink: '#0d1117', ink2: '#5b6474', me: '#2b59ff', ref: '#c3cad6', good: '#0f9d58', bad: '#e5484d', grid: '#e6e9ef', chip: '#0d1117', chipInk: '#ffffff' },
  dark: { card: '#0d1017', ink: '#f3f5f9', ink2: '#9aa3b4', me: '#7b96ff', ref: '#3a4255', good: '#3ccf84', bad: '#ff6b6e', grid: '#222939', chip: '#f3f5f9', chipInk: '#0d1017' },
  pop: { card: '#ffdf3d', ink: '#141414', ink2: '#4d431c', me: '#f2235c', ref: '#b39720', good: '#14773f', bad: '#c40f2c', grid: '#efcd2f', chip: '#141414', chipInk: '#ffdf3d' },
};
export const SIZE: Record<Format, { w: number; h: number }> = { reel: { w: 1080, h: 1920 }, square: { w: 1080, h: 1080 } };
export const DISPLAY = "'Bricolage Grotesque', 'Arial Black', 'Helvetica Neue', Arial, sans-serif";
export const BODY = "'DM Sans', -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

// Reels: Instagram lays its caption and buttons over the bottom and right edge, so text stays inside.
const SAFE: Record<Format, { t: number; b: number; l: number; r: number }> = { reel: { t: 190, b: 300, l: 84, r: 128 }, square: { t: 68, b: 60, l: 72, r: 72 } };

function wrap(text: string, max: number, maxLines: number): string[] {
  const words = text.split(' '); const lines: string[] = []; let cur = '';
  for (const w of words) {
    if (!cur) cur = w; else if ((cur + ' ' + w).length <= max) cur += ' ' + w; else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) { const keep = lines.slice(0, maxLines); keep[maxLines - 1] = keep[maxLines - 1].replace(/\s*\S*$/, '') + '…'; return keep; }
  return lines;
}
const toneColor = (L: Look, t: Tone | undefined) => (t === 'ref' ? L.ink2 : t === 'good' ? L.good : t === 'bad' ? L.bad : L.me);
const barColor = (L: Look, t: Tone | undefined) => (t === 'ref' ? L.ref : toneColor(L, t));

interface Box { x: number; y: number; w: number; h: number }

function Rows({ c, L, b, f, compact }: { c: Card; L: Look; b: Box; f: Format; compact?: boolean }) {
  const n = c.items.length;
  const cap = compact ? (f === 'reel' ? 110 : 74) : f === 'reel' ? 190 : 112;
  const rowH = Math.min(cap, b.h / n);
  const fs = Math.min(f === 'reel' ? 34 : 26, rowH * 0.3);
  const hasRef = c.items.some(i => i.ref != null);
  const barH = rowH * (hasRef ? 0.24 : 0.32);
  const vals = c.items.flatMap(i => [i.v, i.ref ?? 0]);
  const max = Math.max(...vals, 0), min = Math.min(...vals, 0);
  const span = max - min || 1;
  const zx = b.x + b.w * (-min / span);
  const X = (v: number) => b.x + (b.w * (v - min)) / span;
  const top = b.y + (b.h - rowH * n) / 2;
  return <g>
    {c.diverging && <line x1={zx} x2={zx} y1={top} y2={top + rowH * n} stroke={L.ink2} strokeWidth={2} strokeDasharray="4 6" />}
    {c.items.map((it, i) => {
      const y = top + i * rowH, by = y + fs * 1.45;
      const x1 = Math.min(X(it.v), zx), x2 = Math.max(X(it.v), zx);
      return <g key={i}>
        <text x={b.x} y={y + fs} fontFamily={BODY} fontSize={fs} fontWeight={600} fill={L.ink}>{it.label}
          {it.refText && <tspan fill={L.ink2} fontWeight={400} fontSize={fs * 0.82}>{hasRef ? `  ${c.refName} ${it.refText}` : `  ${it.refText}`}</tspan>}
        </text>
        <text x={b.x + b.w} y={y + fs} textAnchor="end" fontFamily={DISPLAY} fontSize={fs * 1.12} fontWeight={800} fill={toneColor(L, it.tone)}>{it.text ?? it.v}</text>
        <rect x={x1} y={by} width={Math.max(x2 - x1, 4)} height={barH} rx={barH / 2} fill={barColor(L, it.tone)} />
        {it.ref != null && <rect x={X(0)} y={by + barH + 6} width={Math.max(X(it.ref) - X(0), 4)} height={barH * 0.5} rx={barH * 0.25} fill={L.ref} />}
      </g>;
    })}
  </g>;
}

function Bars({ c, L, b, f }: { c: Card; L: Look; b: Box; f: Format }) {
  const n = c.items.length, colW = b.w / n;
  const fs = Math.min(f === 'reel' ? 30 : 24, colW * 0.22);
  const labH = fs * 2, valH = fs * 1.8;
  const hasRef = c.items.some(i => i.ref != null);
  const max = Math.max(...c.items.flatMap(i => [i.v, i.ref ?? 0]), c.line?.v ?? 0) * 1.06;
  const ch = b.h - labH - valH, base = b.y + valH + ch;
  const Y = (v: number) => base - (ch * v) / max;
  const bw = colW * (hasRef ? 0.4 : 0.6), rw = colW * 0.22;
  return <g>
    <line x1={b.x} x2={b.x + b.w} y1={base} y2={base} stroke={L.grid} strokeWidth={3} />
    {c.items.map((it, i) => {
      const cx = b.x + colW * i + colW / 2;
      const mx = hasRef ? cx - (bw + rw + 6) / 2 : cx - bw / 2;
      return <g key={i}>
        {it.ref != null && <rect x={mx + bw + 6} y={Y(it.ref)} width={rw} height={base - Y(it.ref)} rx={Math.min(8, rw / 3)} fill={L.ref} />}
        <rect x={mx} y={Y(it.v)} width={bw} height={Math.max(base - Y(it.v), 3)} rx={Math.min(14, bw / 4)} fill={barColor(L, it.tone)} />
        <text x={mx + bw / 2} y={Y(it.v) - fs * 0.5} textAnchor="middle" fontFamily={DISPLAY} fontSize={fs} fontWeight={800} fill={toneColor(L, it.tone)}>{it.text ?? it.v}</text>
        <text x={cx} y={base + fs * 1.35} textAnchor="middle" fontFamily={BODY} fontSize={fs * 0.92} fontWeight={600} fill={it.tone === 'me' && c.items.some(x => x.tone === 'ref') ? L.me : L.ink}>{it.label}</text>
      </g>;
    })}
    {c.line && <g>
      <line x1={b.x} x2={b.x + b.w} y1={Y(c.line.v)} y2={Y(c.line.v)} stroke={L.ink} strokeWidth={3} strokeDasharray="10 8" />
      <text x={b.x} y={Y(c.line.v) - 10} fontFamily={BODY} fontSize={fs * 0.85} fontWeight={700} fill={L.ink}>{c.line.label}</text>
    </g>}
  </g>;
}

function Big({ c, L, b, f }: { c: Card; L: Look; b: Box; f: Format }) {
  const base = f === 'reel' ? 230 : 150;
  const fs = Math.min(base, b.w / (c.big.value.length * 0.6));
  const capFs = f === 'reel' ? 40 : 30;
  const cap = wrap(c.big.caption, Math.floor(b.w / (capFs * 0.5)), 3);
  const used = fs * 1.0 + 24 + cap.length * capFs * 1.3;
  const rest: Box = { x: b.x, y: b.y + used + (f === 'reel' ? 70 : 30), w: b.w, h: b.h - used - (f === 'reel' ? 70 : 30) };
  return <g>
    <text x={b.x - fs * 0.04} y={b.y + fs * 0.86} fontFamily={DISPLAY} fontSize={fs} fontWeight={800} fill={L.me} letterSpacing={-fs * 0.03}>{c.big.value}</text>
    {cap.map((l, i) => <text key={i} x={b.x} y={b.y + fs + 24 + capFs * (i + 0.95) * 1.3} fontFamily={BODY} fontSize={capFs} fontWeight={500} fill={L.ink}>{l}</text>)}
    {rest.h >= c.items.length * (f === 'reel' ? 70 : 48) && <Rows c={c} L={L} b={rest} f={f} compact />}
  </g>;
}

export function CardSvg({ card, style, format, look, width }: { card: Card; style: Style; format: Format; look: LookId; width?: string }) {
  const L = LOOKS[look], { w: W, h: H } = SIZE[format], s = SAFE[format];
  const reel = format === 'reel';
  const cw = W - s.l - s.r;
  let y = s.t;
  const brandFs = reel ? 26 : 22;
  const brand = <g key="brand">
    <rect x={s.l} y={y} width={brandFs * 1.4} height={brandFs * 1.4} rx={brandFs * 0.35} fill={L.chip} />
    {[[0.22, 0.62, 0.3], [0.5, 0.42, 0.5], [0.78, 0.24, 0.68]].map(([fx, fy, fh], i) => <rect key={i} x={s.l + brandFs * 1.4 * fx - brandFs * 0.09} y={y + brandFs * 1.4 * fy - brandFs * 0.1} width={brandFs * 0.18} height={brandFs * 1.4 * (0.86 - fy)} rx={brandFs * 0.06} fill={L.chipInk} />)}
    <text x={s.l + brandFs * 1.9} y={y + brandFs * 1.02} fontFamily={DISPLAY} fontSize={brandFs} fontWeight={800} letterSpacing={brandFs * 0.08} fill={L.ink}>QUERY STUDIO</text>
  </g>;
  y += brandFs * 1.4 + (reel ? 64 : 34);
  const kFs = reel ? 30 : 23;
  const kW = card.kicker.length * kFs * 0.66 + kFs * 1.6;
  const kicker = <g key="kicker">
    <rect x={s.l} y={y} width={kW} height={kFs * 1.8} rx={kFs * 0.9} fill={L.me} />
    <text x={s.l + kFs * 0.8} y={y + kFs * 1.22} fontFamily={BODY} fontSize={kFs} fontWeight={700} letterSpacing={kFs * 0.06} fill={L.card}>{card.kicker.toUpperCase()}</text>
  </g>;
  y += kFs * 1.8 + (reel ? 40 : 24);
  const tFs = reel ? 90 : 62;
  const tLines = wrap(card.title, Math.floor(cw / (tFs * 0.49)), reel ? 4 : 3);
  const title = tLines.map((l, i) => <text key={'t' + i} x={s.l - 3} y={y + tFs * (0.86 + i * 1.02)} fontFamily={DISPLAY} fontSize={tFs} fontWeight={800} letterSpacing={-tFs * 0.025} fill={L.ink}>{l}</text>);
  y += tFs * 1.02 * tLines.length + (reel ? 30 : 16);
  const sFs = reel ? 36 : 27;
  const sLines = wrap(card.sub, Math.floor(cw / (sFs * 0.47)), 3);
  const sub = sLines.map((l, i) => <text key={'s' + i} x={s.l} y={y + sFs * (0.95 + i * 1.3)} fontFamily={BODY} fontSize={sFs} fill={L.ink2}>{l}</text>);
  y += sFs * 1.3 * sLines.length + (reel ? 56 : 28);
  let legend: React.ReactNode = null;
  if (card.refName && style !== 'big') {
    const lFs = reel ? 28 : 22;
    const meLabel = card.items.some(i => i.tone === 'good') ? L.good : card.items.some(i => i.tone === 'bad') && !card.items.some(i => i.tone === 'me') ? L.bad : L.me;
    const x2 = s.l + lFs * 1.4 + card.vName.length * lFs * 0.52 + lFs * 1.6;
    legend = <g key="legend">
      <rect x={s.l} y={y} width={lFs} height={lFs} rx={lFs * 0.25} fill={meLabel} />
      <text x={s.l + lFs * 1.4} y={y + lFs * 0.85} fontFamily={BODY} fontSize={lFs} fontWeight={600} fill={L.ink}>{card.vName}</text>
      <rect x={x2} y={y} width={lFs} height={lFs} rx={lFs * 0.25} fill={L.ref} />
      <text x={x2 + lFs * 1.4} y={y + lFs * 0.85} fontFamily={BODY} fontSize={lFs} fontWeight={600} fill={L.ink}>{card.refName}</text>
    </g>;
    y += lFs + (reel ? 44 : 22);
  }
  const fFs = reel ? 24 : 19;
  const fLines = wrap(card.foot, Math.floor(cw / (fFs * 0.48)), 2);
  const footH = fFs * (1.9 + 1.5 * fLines.length);
  const chart: Box = { x: s.l, y, w: cw, h: H - s.b - footH - y - (reel ? 30 : 16) };
  const fy = H - s.b - footH + fFs;
  return <svg xmlns="http://www.w3.org/2000/svg" viewBox={`0 0 ${W} ${H}`} width={width ?? '100%'} role="img" aria-label={`${card.title}. ${card.sub}`} style={{ display: 'block' }}>
    <rect width={W} height={H} fill={L.card} />
    {brand}{kicker}{title}{sub}{legend}
    {style === 'rows' && <Rows c={card} L={L} b={chart} f={format} />}
    {style === 'bars' && <Bars c={card} L={L} b={chart} f={format} />}
    {style === 'big' && <Big c={card} L={L} b={chart} f={format} />}
    <line x1={s.l} x2={W - s.r} y1={fy - fFs * 1.3} y2={fy - fFs * 1.3} stroke={L.grid} strokeWidth={2} />
    {fLines.map((l, i) => <text key={'f' + i} x={s.l} y={fy + fFs * 1.5 * i} fontFamily={BODY} fontSize={fFs} fill={L.ink2}>{l}</text>)}
    <text x={s.l} y={fy + fFs * 1.5 * fLines.length} fontFamily={BODY} fontSize={fFs} fontWeight={700} fill={L.ink2}>Sample data · bijanp24.github.io/query-studio</text>
  </svg>;
}

export type { Item };
